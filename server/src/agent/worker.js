'use strict';
// 真实对话 worker：按 jobId 领取 TEXT 作业，经 Codex App Server 执行，
// delta 增量按序回写 ai 消息与 message.updated 事件，终态写回 job 与消息。
// 连接参数来自运行时环境（PFC_CODEX_*），授权来源为已确认的全局 AGENTS.md 例外；
// 未配置连接或调用失败时明确落 FAILED，不回退为模拟成功。
const { TextConversation } = require('./conversation-provider');
const { withTransaction } = require('../persistence/transaction');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const jobs = require('../persistence/agent-jobs');
const { reserveTurn, settleTurn, release } = require('./budget');
const fail = (code) => Object.assign(new Error(code), { code });

// 本机 worker 的固定运行身份（合法 uuid，用于 agent_jobs.owner_id 租约）。
const OWNER = '00000000-0000-4000-8000-00000000a111';
const active = new Map();
const AUTHORIZATION_PATH = path.resolve(
  'docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json',
);

function connectionOptions() {
  const binary = process.env.PFC_CODEX_BINARY;
  if (!binary) return null;
  const approved = [];
  try {
    const auth = JSON.parse(readFileSync(AUTHORIZATION_PATH, 'utf8'));
    if (auth?.status === 'USER_CONFIRMED' && auth?.source)
      approved.push(auth.source);
  } catch {
    /* 无已确认指令源时不注入全局 AGENTS.md */
  }
  return {
    binary,
    expectedSha256: process.env.PFC_CODEX_BINARY_SHA256 || undefined,
    cwd: process.env.PFC_CODEX_PREFLIGHT_CWD || undefined,
    expectedConnectionFingerprint:
      process.env.PFC_CODEX_CONNECTION_SHA256 || undefined,
    approvedInstructionSources: approved,
  };
}

function buildTextPrompt(job) {
  const input = job.input || {};
  const parts = [String(input.content || '').trim()];
  const refs = Array.isArray(input.refs) ? input.refs : [];
  if (refs.length) {
    parts.push('（附 ' + refs.length + ' 项已确认版本引用：' + refs.map((r) => r.name || r.kind || '引用').join('、') + '）');
  }
  const text = parts.filter(Boolean).join('\n');
  if (!text) fail('EMPTY_TEXT_JOB');
  return text;
}

// 事务内更新 ai 消息 + 追加域事件 + 唤醒 WS 推送。
async function writeMessage(db, ctx, reqPublicId, reqId, aiMessageId, text, opts = {}) {
  const final = !!opts.final;
  await withTransaction(db, async (client) => {
    const reqRepo = require('../persistence/requirements');
    const req = await reqRepo.lock(client, db, ctx, reqPublicId);
    const meta = final
      ? { full: text, usage: opts.usage || null, real: true }
      : { real: true };
    await client.query(
      `UPDATE "${db.schema}".messages SET content=$1,status=$2,metadata=$3,revision=revision+1 WHERE tenant_id=$4 AND id=$5`,
      [text, final ? 'ok' : 'generating', JSON.stringify(meta), ctx.tenantId, aiMessageId],
    );
    await require('../persistence/events').append(
      client,
      db,
      ctx,
      final ? 'message.completed' : 'message.updated',
      reqPublicId,
      req.revision,
      final
        ? { reqId: reqPublicId, messageId: aiMessageId, usage: opts.usage || null }
        : { reqId: reqPublicId, messageId: aiMessageId, agent: true },
    );
  });
  require('../domain/events').kick();
}

async function finishJob(db, ctx, jobId, state, result, code) {
  await withTransaction(db, async (client) => {
    await jobs.finish(client, db, jobId, OWNER, state, result, code);
  });
}

async function failMessage(db, ctx, reqPublicId, aiMessageId, code) {
  if (!aiMessageId) return;
  await withTransaction(db, async (client) => {
    const reqRepo = require('../persistence/requirements');
    const req = await reqRepo.lock(client, db, ctx, reqPublicId);
    await client.query(
      `UPDATE "${db.schema}".messages SET status=$1,metadata=$2,revision=revision+1 WHERE tenant_id=$3 AND id=$4`,
      ['failed', JSON.stringify({ real: true, error: code }), ctx.tenantId, aiMessageId],
    );
    await require('../persistence/events').append(
      client,
      db,
      ctx,
      'message.failed',
      reqPublicId,
      req.revision,
      { reqId: reqPublicId, messageId: aiMessageId, error: code },
    );
  });
  require('../domain/events').kick();
}

// 执行一个 TEXT 作业。幂等：同一 jobId 已在运行或已终态则跳过。
async function runTextJob({ db, ctx, reqPublicId, jobId }) {
  if (active.has(jobId)) return { skipped: true };
  const options = connectionOptions();
  let session = null;
  let writeChain = Promise.resolve();
  let aiMessageId = null;
  let startedAt = Date.now();
  let budgetActive = false;
  active.set(jobId, { cancel: () => session?.close?.() });
  try {
    const job = await withTransaction(db, async (client) => {
      const claimed = await jobs.claimById(client, db, jobId, OWNER);
      await jobs.dispatch(client, db, jobId, OWNER);
      return claimed;
    });
    aiMessageId = job.input?.aiMessageId ?? null;
    if (!options) throw fail('CONNECTION_UNAVAILABLE');
    const text = buildTextPrompt(job);
    session = await TextConversation.open(options);
    let accumulated = '';
    const result = await session.runText({
      text,
      reserveTurn: () => {
        reserveTurn();
        budgetActive = true;
        startedAt = Date.now();
      },
      onDelta: (delta) => {
        accumulated += delta;
        if (accumulated.length > 200000) {
          session.close().catch(() => {});
          throw fail('MODEL_OUTPUT_LIMIT');
        }
        writeChain = writeChain
          .then(() =>
            writeMessage(db, ctx, reqPublicId, job.req_id, aiMessageId, accumulated),
          )
          .catch(() => {});
      },
    });
    await writeChain;
    await writeMessage(db, ctx, reqPublicId, job.req_id, aiMessageId, result.text, {
      final: true,
      usage: result.usage || undefined,
    });
    await finishJob(db, ctx, jobId, 'SUCCEEDED', {
      text: result.text,
      usage: result.usage || null,
      threadId: result.threadId,
      turnId: result.turnId,
    }, null);
    if (budgetActive)
      settleTurn(Math.ceil((Date.now() - startedAt) / 1000), 'SUCCEEDED', {
        inputHash: createHash('sha256').update(text).digest('hex'),
      });
    return { status: 'SUCCEEDED', jobId };
  } catch (e) {
    const code = e.code || 'TURN_FAILED';
    const state =
      code === 'TURN_CANCELLED'
        ? 'CANCELLED'
        : code === 'TURN_TIMED_OUT'
          ? 'TIMED_OUT'
          : 'FAILED';
    if (aiMessageId)
      await failMessage(db, ctx, reqPublicId, aiMessageId, code).catch(() => {});
    await finishJob(db, ctx, jobId, state, null, code).catch(() => {});
    if (budgetActive) {
      try {
        settleTurn(Math.ceil((Date.now() - startedAt) / 1000), state);
      } catch {
        release();
      }
    }
    return { status: state, code };
  } finally {
    active.delete(jobId);
  }
}

async function cancel(jobId) {
  const entry = active.get(jobId);
  if (entry) await entry.cancel();
  return !!entry;
}

module.exports = { runTextJob, cancel, connectionOptions, OWNER };
