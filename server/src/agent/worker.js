'use strict';
const { TextConversation } = require('./conversation-provider');
const { withTransaction } = require('../persistence/transaction');
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const jobs = require('../persistence/agent-jobs');
const { createControl } = require('./job-control');
const budget = require('./budget');
const fault = (code) => Object.assign(new Error(code), { code });
const OWNER = randomUUID();
const active = new Map();
require('../runtime').onClose(async () => {
  for (const control of active.values()) await control.stop('TURN_CANCELLED');
  await Promise.all([...active.values()].map((control) => control.done));
});
const AUTHORIZATION_PATH = path.resolve(
  __dirname,
  '../../../docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json',
);
function connectionOptions() {
  if (!process.env.PFC_CODEX_BINARY) return null;
  const auth = JSON.parse(readFileSync(AUTHORIZATION_PATH, 'utf8'));
  return {
    binary: process.env.PFC_CODEX_BINARY,
    expectedSha256: process.env.PFC_CODEX_BINARY_SHA256,
    cwd: process.env.PFC_CODEX_PREFLIGHT_CWD,
    expectedConnectionFingerprint: process.env.PFC_CODEX_CONNECTION_SHA256,
    approvedInstructionSources:
      auth.status === 'USER_CONFIRMED' && auth.source ? [auth.source] : [],
    enabledSkills: [],
  };
}
function buildTextPrompt(job) {
  const input = job.input || {};
  const parts = [String(input.content || '').trim()];
  for (const c of input.context?.blocks || [])
    parts.push('【服务端来源 ' + c.stage + '】\n' + c.text);
  for (const c of input.stageContext || [])
    parts.push('【用户提供的补充，未经确认 ' + c.stage + '】\n' + c.text);
  if (input.refs?.length)
    parts.push('引用标识（正文未在此处展开）：' + JSON.stringify(input.refs));
  const text = parts.filter(Boolean).join('\n\n');
  if (!text) throw fault('EMPTY_TEXT_JOB');
  if (text.length > 200000) throw fault('AGENT_CONTEXT_LIMIT');
  return text;
}
async function writeMessage(db, ctx, reqPublicId, job, text) {
  await withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'message.agentWrite',
    );
    const req = await require('../persistence/requirements').lock(
      client,
      db,
      ctx,
      reqPublicId,
    );
    const live = await jobs.owned(client, db, job.id, OWNER);
    if (live.result?.cancelRequested) throw fault('TURN_CANCELLED');
    const result = await client.query(
      'UPDATE "' +
        db.schema +
        '".messages SET content=$1,metadata=metadata || $2::jsonb,revision=revision+1 WHERE tenant_id=$3 AND req_id=$4 AND id=$5 AND status=$6 RETURNING id',
      [
        text,
        JSON.stringify({ real: true }),
        ctx.tenantId,
        job.req_id,
        job.input.aiMessageId,
        'generating',
      ],
    );
    if (!result.rows.length) throw fault('TURN_CANCELLED');
    await require('../persistence/events').append(
      client,
      db,
      ctx,
      'message.updated',
      reqPublicId,
      req.revision,
      { reqId: reqPublicId, messageId: job.input.aiMessageId, agent: true },
    );
  });
  require('../domain/events').kick();
}
async function completeJob(db, ctx, reqPublicId, job, result) {
  await withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'message.agentComplete',
    );
    const req = await require('../persistence/requirements').lock(
      client,
      db,
      ctx,
      reqPublicId,
    );
    if (job.input.contextHash) {
      const current = await require('./context-service').stageSnapshot(
        client,
        db,
        ctx,
        req,
        job.input.stage,
      );
      if (current.hash !== job.input.contextHash)
        throw fault('AGENT_CONTEXT_CHANGED');
    }
    const live = await jobs.owned(client, db, job.id, OWNER);
    if (live.result?.cancelRequested) throw fault('TURN_CANCELLED');
    if (job.kind === 'EXECUTE') {
      const unverified = await client.query(
        `SELECT id FROM "${db.schema}".tool_executions WHERE job_id=$1 AND state<>'SUCCEEDED' LIMIT 1`,
        [job.id],
      );
      if (unverified.rowCount) throw fault('TOOL_EFFECT_UNCONFIRMED');
      if (result.fileDiff?.violates) throw fault('TOOL_EFFECT_UNCONFIRMED');
    }
    const updated = await client.query(
      'UPDATE "' +
        db.schema +
        '".messages SET content=$1,status=$2,metadata=metadata || $3::jsonb,revision=revision+1 WHERE tenant_id=$4 AND req_id=$5 AND id=$6 AND status=$7 RETURNING id',
      [
        result.text,
        'ok',
        JSON.stringify({
          real: true,
          full: result.text,
          usage: result.usage ?? null,
        }),
        ctx.tenantId,
        job.req_id,
        job.input.aiMessageId,
        'generating',
      ],
    );
    if (!updated.rows.length) throw fault('TURN_CANCELLED');
    await jobs.finish(client, db, job.id, OWNER, 'SUCCEEDED', result, null);
    await require('../persistence/events').append(
      client,
      db,
      ctx,
      'message.completed',
      reqPublicId,
      req.revision,
      { reqId: reqPublicId, messageId: job.input.aiMessageId },
    );
  });
  require('../domain/events').kick();
}
async function failJob(db, ctx, reqPublicId, job, state, code) {
  await withTransaction(db, async (client) => {
    const req = await require('../persistence/requirements').lock(
      client,
      db,
      ctx,
      reqPublicId,
    );
    const live = await jobs.find(client, db, ctx, job.req_id, job.id);
    if (
      !live ||
      !['RUNNING', 'WAITING_APPROVAL'].includes(live.state) ||
      live.owner_id !== OWNER
    )
      return;
    if (new Date(live.lease_until).getTime() <= Date.now()) {
      state = 'UNKNOWN';
      await jobs.forceFinish(client, db, job.id, state, null, code, OWNER);
    } else await jobs.finish(client, db, job.id, OWNER, state, null, code);
    const updated = await client.query(
      'UPDATE "' +
        db.schema +
        '".messages SET status=$1,metadata=metadata || $2::jsonb,revision=revision+1 WHERE tenant_id=$3 AND req_id=$4 AND id=$5 AND status=$6 RETURNING id',
      [
        state === 'CANCELLED' ? 'stopped' : 'failed',
        JSON.stringify({ real: true, error: code, agentState: state }),
        ctx.tenantId,
        job.req_id,
        job.input.aiMessageId,
        'generating',
      ],
    );
    if (updated.rows.length)
      await require('../persistence/events').append(
        client,
        db,
        ctx,
        'message.failed',
        reqPublicId,
        req.revision,
        {
          reqId: reqPublicId,
          messageId: job.input.aiMessageId,
          error: code,
          agentState: state,
        },
      );
  });
  require('../domain/events').kick();
}
async function runJob({ db, ctx, reqPublicId, jobId }, kind) {
  if (active.has(jobId)) return { skipped: true };
  const control = createControl();
  active.set(jobId, control);
  let job, session, heartbeat, timer, reservation, startedAt, writeError;
  let hostScope;
  const jobBudget = kind === 'EXECUTE' ? budget.hostBudget() : budget;
  let writeChain = Promise.resolve(),
    outcome;
  try {
    job = await withTransaction(db, async (client) => {
      await require('../domain/membership-policy').authorizeCommand(
        client,
        db,
        ctx,
        'message.agentStart',
      );
      return jobs.claimById(client, db, jobId, OWNER);
    });
    control.check();
    if (kind === 'EXECUTE') {
      require('./exec-control').validatePlan(job.input);
      require('./execution-policy').requireCapability();
    }
    const options = connectionOptions();
    if (!options) throw fault('CONNECTION_UNAVAILABLE');
    if (job.input.contextHash)
      await withTransaction(db, async (client) => {
        const req = await require('../persistence/requirements').lock(
          client,
          db,
          ctx,
          reqPublicId,
        );
        const current = await require('./context-service').stageSnapshot(
          client,
          db,
          ctx,
          req,
          job.input.stage,
        );
        if (current.hash !== job.input.contextHash)
          throw fault('AGENT_CONTEXT_CHANGED');
      });
    timer = setTimeout(() => {
      void control.stop('TURN_TIMED_OUT');
    }, 300000);
    heartbeat = setInterval(() => {
      withTransaction(db, async (client) => {
        await require('../domain/membership-policy').authorizeCommand(
          client,
          db,
          ctx,
          'message.agentHeartbeat',
        );
        const live = await jobs.owned(client, db, jobId, OWNER);
        if (live.result?.cancelRequested) throw fault('TURN_CANCELLED');
        await jobs.heartbeat(client, db, jobId, OWNER);
      }).catch((e) => {
        void control.stop(
          e.code === 'TURN_CANCELLED' ? e.code : 'AGENT_LEASE_LOST',
        );
      });
    }, 10000);
    if (kind === 'EXECUTE') {
      hostScope = require('./scope-policy').createScope(
        job.input.workspace,
        job.input.control,
      );
      options.mode = 'host';
      options.cwd = job.input.workspace;
      options.onToolCall = require('./approval-service').createHostDispatcher({
        db,
        ctx,
        reqPublicId,
        jobId,
        ownerId: OWNER,
        scope: hostScope,
        control,
      });
    }
    session = await TextConversation.open(options);
    control.attach(session);
    control.check();
    const guide = require('./stage-capabilities').forStage(
      job.input.stage || 'idea',
    );
    const text =
      (guide ? '【本阶段】' + guide.goal + '\n' + guide.guide + '\n' : '') +
      buildTextPrompt(job);
    let accumulated = '';
    const result = await session.runText({
      text,
      reserveTurn: async () => {
        control.check();
        reservation = await jobBudget.reserveTurn();
        startedAt = Date.now();
        control.check();
        await withTransaction(db, (client) =>
          jobs.dispatch(client, db, jobId, OWNER),
        );
      },
      onDelta: (delta) => {
        accumulated += delta;
        if (accumulated.length > 200000) {
          void control.stop('MODEL_OUTPUT_LIMIT');
          return;
        }
        const chunk = accumulated;
        writeChain = writeChain
          .then(() => {
            control.check();
            return writeMessage(db, ctx, reqPublicId, job, chunk);
          })
          .catch((e) => {
            writeError = e;
            void control.stop(e.code || 'MESSAGE_WRITE_FAILED');
          });
      },
    });
    await writeChain;
    if (writeError) throw writeError;
    control.check();
    const exit = await session.close();
    if (exit?.childExited !== true) throw fault('PROCESS_EXIT_UNCONFIRMED');
    if (hostScope) result.fileDiff = hostScope.diff();
    await completeJob(db, ctx, reqPublicId, job, result);
    outcome = {
      status: 'SUCCEEDED',
      jobId,
      inputHash: createHash('sha256').update(text).digest('hex'),
    };
  } catch (e) {
    const code =
      control.reason ||
      (/^[A-Z][A-Z0-9_]{0,99}$/.test(e.code || '') ? e.code : 'TURN_FAILED');
    if (session) await control.stop(code);
    const state = control.terminalState(code);
    if (job) {
      try {
        await failJob(db, ctx, reqPublicId, job, state, code);
      } catch (dbError) {
        outcome = {
          status: 'UNKNOWN',
          code: 'RESULT_PERSISTENCE_UNCONFIRMED',
          cause: dbError.code || 'DB_FAILED',
        };
      }
    }
    outcome ??= { status: job ? state : 'SKIPPED', code };
  } finally {
    hostScope?.stop();
    clearInterval(heartbeat);
    clearTimeout(timer);
    await writeChain;
    if (session) {
      try {
        await session.close();
      } catch {
        outcome = {
          ...outcome,
          status: 'UNKNOWN',
          code: 'PROCESS_EXIT_UNCONFIRMED',
        };
      }
    }
    if (reservation) {
      try {
        await jobBudget.settleTurn(
          Math.ceil((Date.now() - startedAt) / 1000),
          outcome.status === 'SKIPPED' ? 'FAILED' : outcome.status,
          { inputHash: outcome.inputHash },
          reservation.attemptId,
        );
      } catch {
        outcome = { ...outcome, budget: 'SETTLEMENT_UNCONFIRMED' };
      }
    }
    control.complete(outcome);
    active.delete(jobId);
  }
  return outcome;
}
async function cancel(jobId, scope) {
  const control = active.get(jobId);
  if (control) {
    await control.stop('TURN_CANCELLED');
    let timer;
    const result = await Promise.race([
      control.done,
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ status: 'UNKNOWN', code: 'CANCEL_ACK_TIMEOUT' }),
          10000,
        );
      }),
    ]);
    clearTimeout(timer);
    return { state: result.status, confirmed: result.status === 'CANCELLED' };
  }
  if (scope?.db && scope.reqId) {
    const row = await withTransaction(scope.db, (client) =>
      jobs.find(client, scope.db, scope.ctx, scope.reqId, jobId),
    );
    return {
      state: row?.state || 'UNKNOWN',
      confirmed: row?.state === 'CANCELLED',
    };
  }
  return { state: 'UNKNOWN', confirmed: false };
}
module.exports = {
  runTextJob: (args) => runJob(args, 'TEXT'),
  runExecJob: (args) => runJob(args, 'EXECUTE'),
  cancel,
  connectionOptions,
  OWNER,
  buildTextPrompt,
};
