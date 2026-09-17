'use strict';
const { fingerprint } = require('../persistence/commands');
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const validId = (v) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 200 &&
  !Array.from(v).some((c) => c.charCodeAt(0) < 32);
// Each dispatch must match an independently observed item on the same live turn.
// The installed protocol uses callId as the dynamic item id; mismatch stays closed.
class DynamicBindings {
  constructor() {
    this.items = new Map();
    this.calls = new Map();
    this.stopped = false;
  }
  start(threadId, turnId) {
    if (this.stopped || !validId(threadId) || !validId(turnId))
      fail('TOOL_IDENTITY_MISMATCH');
    this.threadId = threadId;
    this.turnId = turnId;
    this.items.clear();
    this.calls.clear();
  }
  observe(event) {
    const p = event.params;
    if (event.method !== 'item/started' || p?.item?.type !== 'dynamicToolCall')
      return;
    if (
      p.threadId !== this.threadId ||
      p.turnId !== this.turnId ||
      !validId(p.item.id)
    )
      fail('TOOL_IDENTITY_MISMATCH');
    if (this.items.size >= 100) fail('TOOL_LIMIT');
    const f = fingerprint({
      tool: p.item.tool,
      arguments: p.item.arguments,
      namespace: p.item.namespace ?? null,
    });
    if (this.items.has(p.item.id) && this.items.get(p.item.id) !== f)
      fail('TOOL_ITEM_UNVERIFIED');
    this.items.set(p.item.id, f);
  }
  bind(message) {
    if (this.stopped) fail('TURN_CANCELLED');
    const p = message.params;
    if (
      !p ||
      p.threadId !== this.threadId ||
      p.turnId !== this.turnId ||
      !validId(p.callId) ||
      !(
        validId(message.id) ||
        (Number.isSafeInteger(message.id) && message.id >= 0)
      )
    )
      fail('TOOL_IDENTITY_MISMATCH');
    const f = fingerprint({
      tool: p.tool,
      arguments: p.arguments,
      namespace: p.namespace ?? null,
    });
    if (this.items.get(p.callId) !== f) fail('TOOL_ITEM_UNVERIFIED');
    const requestId = String(message.id),
      prior = this.calls.get(p.callId);
    if (prior && prior !== requestId) fail('TOOL_CALL_REUSED');
    this.calls.set(p.callId, requestId);
    return {
      requestId,
      threadId: p.threadId,
      turnId: p.turnId,
      callId: p.callId,
      itemId: p.callId,
      tool: p.tool,
      arguments: p.arguments,
    };
  }
  stop() {
    this.stopped = true;
  }
}
function toolResponse(success, data) {
  return {
    success,
    contentItems: [{ type: 'inputText', text: JSON.stringify(data) }],
  };
}
function createHostDispatcher({
  db,
  ctx,
  reqPublicId,
  jobId,
  ownerId,
  scope,
  control,
}) {
  const { withTransaction } = require('../persistence/transaction');
  const jobs = require('../persistence/agent-jobs'),
    approvals = require('../persistence/agent-approvals'),
    tools = require('../persistence/tool-executions');
  const results = new Map(),
    requests = new Map();
  const planHash = (p) =>
    fingerprint(
      Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'frozenAt')),
    );
  async function live(client) {
    control.check();
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'message.agentTool',
    );
    if (ctx.role !== 'owner') fail('FORBIDDEN');
    const req = await require('../persistence/requirements').lock(
      client,
      db,
      ctx,
      reqPublicId,
    );
    const job = await jobs.owned(client, db, jobId, ownerId);
    if (
      job.kind !== 'EXECUTE' ||
      job.tenant_id !== ctx.tenantId ||
      job.created_by !== ctx.memberId ||
      job.req_id !== req.id ||
      req.stage !== 'dev' ||
      job.input.stage !== 'dev'
    )
      fail('TOOL_IDENTITY_MISMATCH');
    if (job.result?.cancelRequested) fail('TURN_CANCELLED');
    if (!job.dispatched_at) fail('AGENT_NOT_DISPATCHED');
    const snapshot = await require('./context-service').stageSnapshot(
      client,
      db,
      ctx,
      req,
      'dev',
    );
    if (
      snapshot.hash !== job.input.contextHash ||
      scope.plan.contextHash !== snapshot.hash ||
      scope.plan.approvedBy !== ctx.memberId ||
      scope.plan.tenantId !== ctx.tenantId ||
      scope.plan.reqId !== req.id
    )
      fail('AGENT_CONTEXT_CHANGED');
    if (planHash(job.input.control) !== planHash(scope.plan))
      fail('PLAN_SCOPE_CHANGED');
    scope.check();
    return { job, snapshot };
  }
  async function dispatch(bound) {
    let begun;
    const isFile = ['pfc_read_file', 'pfc_write_file'].includes(bound.tool);
    const prepared = await withTransaction(db, async (client) => {
      const { job, snapshot } = await live(client);
      await jobs.bindToolTurn(client, db, job, bound.threadId, bound.turnId);
      const prior = requests.get(bound.requestId);
      if (prior) {
        if (prior.hash !== fingerprint(bound)) fail('TOOL_CALL_REUSED');
        return { response: prior.response };
      }
      if (
        !isFile &&
        !['pfc_run_checks', 'pfc_git_status', 'pfc_git_diff'].includes(
          bound.tool,
        )
      )
        fail('TOOL_NOT_ALLOWED');
      let rejection;
      try {
        if (isFile) scope.inspect(bound.tool, bound.arguments);
        else {
          require('./scope-policy').exactArgs(bound.arguments, []);
          fail('HOST_COMMAND_SANDBOX_UNVERIFIED');
        }
      } catch (e) {
        rejection = e.code || 'TOOL_ARGUMENTS_INVALID';
      }
      // Content is bound by digest and byte length, not copied into the audit row.
      const safeArgs =
        bound.tool === 'pfc_write_file'
          ? {
              path: bound.arguments?.path,
              expectedHash: bound.arguments?.expectedHash,
              contentHash: fingerprint(bound.arguments?.content ?? null),
              bytes: Buffer.byteLength(String(bound.arguments?.content ?? '')),
            }
          : bound.arguments;
      const request = {
        ...bound,
        arguments: safeArgs,
        kind:
          bound.tool === 'pfc_read_file'
            ? 'fileRead'
            : isFile
              ? 'fileChange'
              : 'command',
        contextHash: snapshot.hash,
      };
      const approval = await approvals.create(
        client,
        db,
        ctx,
        jobId,
        ownerId,
        request,
      );
      if (rejection) {
        const pending = rejection === 'TOOL_OUT_OF_SCOPE';
        if (!pending)
          await client.query(
            `UPDATE "${db.schema}".agent_approvals SET state='DENIED',decided_by=$1,decided_at=now() WHERE id=$2 AND state='PENDING'`,
            [ctx.memberId, approval.id],
          );
        await require('../persistence/agent-events').append(
          client,
          db,
          job,
          'approval',
          {
            approvalId: approval.id,
            scopeHash: approval.scope_hash,
            code: rejection,
            state: pending ? 'PENDING' : 'DENIED',
          },
        );
        return {
          response: toolResponse(false, {
            code: rejection,
            approvalId: approval.id,
            requiresNewPlan: pending,
          }),
        };
      }
      if (approval.state === 'PENDING') {
        const updated = await client.query(
          `UPDATE "${db.schema}".agent_approvals SET state='APPROVED',decided_by=$1,decided_at=now() WHERE id=$2 AND state='PENDING' RETURNING *`,
          [ctx.memberId, approval.id],
        );
        Object.assign(approval, updated.rows[0]);
      }
      if (approval.state !== 'APPROVED') fail('TOOL_APPROVAL_DENIED');
      begun = await tools.begin(client, db, job, approval, bound);
      return { approval, begun };
    });
    if (prepared.response) return prepared.response;
    if (begun.replay) {
      const cached = results.get(begun.row.id);
      if (!cached) fail('TOOL_REPLAY_UNVERIFIED');
      return cached;
    }
    // RUNNING is durable before the effect; a crash is never replayed as success.
    try {
      const response = await withTransaction(db, async (client) => {
        const { job, snapshot } = await live(client);
        const approval = (
          await client.query(
            'SELECT * FROM "' +
              db.schema +
              '".agent_approvals WHERE id=$1 FOR UPDATE',
            [prepared.approval.id],
          )
        ).rows[0];
        if (
          approval?.state !== 'APPROVED' ||
          new Date(approval.expires_at).getTime() <= Date.now()
        )
          fail('TOOL_APPROVAL_INVALID');
        control.check();
        scope.check();
        const started = Date.now();
        const data =
          bound.tool === 'pfc_read_file'
            ? scope.read(bound.arguments)
            : scope.write(bound.arguments);
        const evidence = {
          tool: bound.tool,
          path: data.path,
          sha256: data.sha256,
          bytes: data.bytes ?? Buffer.byteLength(data.content),
          scopeHash: approval.scope_hash,
          contextHash: snapshot.hash,
        };
        await tools.finish(
          client,
          db,
          begun.row,
          'SUCCEEDED',
          evidence,
          Date.now() - started,
        );
        await require('../persistence/agent-events').append(
          client,
          db,
          job,
          'tool',
          { toolExecutionId: begun.row.id, ...evidence },
        );
        return toolResponse(true, data);
      });
      results.set(begun.row.id, response);
      requests.set(bound.requestId, { hash: fingerprint(bound), response });
      return response;
    } catch (e) {
      await withTransaction(db, (c) =>
        tools.finish(
          c,
          db,
          begun.row,
          'UNKNOWN',
          { code: 'TOOL_EFFECT_UNCONFIRMED' },
          0,
        ),
      ).catch(() => {});
      throw e;
    }
  }
  return async (bound) => {
    try {
      return await dispatch(bound);
    } catch (e) {
      return toolResponse(false, {
        code: /^[A-Z_]{3,80}$/.test(e.code || '')
          ? e.code
          : 'TOOL_EXECUTION_UNKNOWN',
      });
    }
  };
}
module.exports = { DynamicBindings, createHostDispatcher, toolResponse };
