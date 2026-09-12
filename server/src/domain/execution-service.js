'use strict';
const { S, seedFromState, pushAudit, pushNotice, nextId } = require('./store');
const sm = require('./state-machine');
const wsBridge = require('../ws');
// Existing memory demonstration adapter; no PG caller may enter this block.
async function getRun(id) {
  await seedFromState();
  const run = S.runs.get(id);
  if (!run) return null;
  return {
    run,
    plan: S.runPlans.get(id + '-plan') || null,
    lines: S.lines.get(id) || [],
    replay: S.replays.get(id) || [],
    qualityGates: S.qualityGates.get(id) || [],
    lease: S.leases.get(id) || null,
  };
}

async function listRuns(reqId) {
  await seedFromState();
  return {
    items: await Promise.all(
      [...S.runs.values()]
        .filter((r) => !reqId || r.reqId === reqId)
        .map((r) => getRun(r.id)),
    ),
  };
}

/* ---------------- 执行域（M1 模拟执行，M2b 接 Bridge） ---------------- */

async function createRun({ reqId, plan, commandId, parentId }) {
  await seedFromState();
  const req = S.reqs.get(reqId);
  if (!req) return { error: 'NOT_FOUND' };
  if (commandId && S.commands.has(commandId)) {
    const prior = S.commands.get(commandId);
    if (prior.reqId !== reqId || prior.plan !== plan)
      return { error: 'COMMAND_CONFLICT' };
    return getRun(prior.runId);
  }
  const id = 'R-' + ++S.seq.run;
  S.runs.set(id, {
    id,
    reqId,
    parentId: parentId || null,
    status: 'WAITING_APPROVAL',
    revision: 0,
    step: 0,
    pct: 0,
    controller: 'web',
    budget: 8000,
    spent: 0,
    exitCode: null,
    operation: '开发实现',
    createdAt: new Date().toISOString(),
  });
  S.runPlans.set(id + '-plan', {
    id: id + '-plan',
    runId: id,
    plan:
      plan ||
      '拆解：1) 读取项目结构与目标文件 2) 按方案实现改动并运行测试 3) 格式化、构建并汇总差异供验收',
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
  });
  if (commandId) S.commands.set(commandId, { reqId, runId: id, plan });
  return { run: S.runs.get(id), plan: S.runPlans.get(id + '-plan') };
}

async function planApprove(id, by) {
  await seedFromState();
  const run = S.runs.get(id);
  if (!run) return { error: 'NOT_FOUND' };
  const plan = S.runPlans.get(id + '-plan');
  if (run.status !== 'WAITING_APPROVAL' || plan?.rejectedReason)
    return { error: 'INVALID_RUN_STATE' };
  if (plan?.approvedAt) return { run };
  if (plan) {
    plan.approvedBy = by || '陈立';
    plan.approvedAt = new Date().toISOString();
    plan.rejectedReason = null;
  }
  pushAudit(by || '陈立', '批准计划', id);
  return { run };
}

async function planReject(id, reason) {
  await seedFromState();
  const run = S.runs.get(id);
  if (!run) return { error: 'NOT_FOUND' };
  if (typeof reason !== 'string' || !reason.trim())
    return { error: 'REASON_REQUIRED' };
  reason = reason.trim();
  const plan = S.runPlans.get(id + '-plan');
  if (plan?.rejectedReason === reason && run.status === 'FAILED')
    return {
      run,
      audit: S.audit.findLast((a) => a.detail === id + '：' + reason),
    };
  if (run.status !== 'WAITING_APPROVAL') return { error: 'INVALID_RUN_STATE' };
  if (plan) {
    plan.approvedBy = null;
    plan.approvedAt = null;
    plan.rejectedReason = reason;
  }
  run.status = 'FAILED';
  run.revision++;
  pushAudit('陈立', '拒绝计划', id + '：' + reason);
  const notice = pushNotice('作业计划被拒绝：' + id, 'warn', run.reqId);
  wsBridge.broadcast('notice', notice);
  return { run, audit: S.audit[S.audit.length - 1] };
}

/* 启动执行：有在线 Bridge → 派发 job.start（真实驱动，M2b）；无 Bridge → 回退模拟推进（诚实标注） */

async function startRun(id) {
  await seedFromState();
  const run = S.runs.get(id);
  if (!run) return { error: 'NOT_FOUND' };
  const plan = S.runPlans.get(id + '-plan');
  if (!plan || !plan.approvedAt) return { error: 'PLAN_NOT_APPROVED' };
  if (run.startedAt) return { run }; // Retrying a response must never dispatch twice.
  if (run.status !== 'WAITING_APPROVAL') return { error: 'INVALID_RUN_STATE' };
  run.startedAt = new Date().toISOString();
  run.status = 'RUNNING';
  run.revision++;
  const dispatched = wsBridge.dispatchJob(id, run, plan.plan);
  if (dispatched) {
    pushAudit('陈立', '启动执行', id + ' → 已派发 Bridge（实时对话流）');
    return { run };
  }
  /* 回退：模拟推进（无 Bridge 连接时） */
  run.executionMode = 'server-simulation';
  const lines = [
    {
      cls: 'cmd',
      text: 'codex> 已连接工作区（模拟执行，未检测到在线 Bridge）',
    },
    { cls: 'info', text: 'codex> 读取需求与现有接口…' },
    { cls: 'cmd', text: 'codex> 创建变更文件（模拟）' },
    { cls: 'ok', text: 'codex> 单元测试 3 passed（模拟）' },
  ];
  S.replays.set(
    id,
    lines.map((l, i) => ({
      stepNo: i + 1,
      label: l.cls + ' ' + l.text,
      snapshotRef: 'sim://run/' + id + '/step' + (i + 1),
    })),
  );
  S.lines.set(id, lines);
  run.step = 4;
  run.pct = 100;
  run.exitCode = 0;
  run.status = 'SUCCEEDED';
  run.revision++;
  pushAudit('陈立', '启动执行', id + ' → SUCCEEDED（模拟）');
  return { run };
}

async function cancelRun(id) {
  await seedFromState();
  const run = S.runs.get(id);
  if (!run) return { error: 'NOT_FOUND' };
  if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'CANCELLING'].includes(run.status))
    return { run };
  if (run.bridgeId)
    run.status = wsBridge.cancelJob(run) ? 'CANCELLING' : 'UNKNOWN';
  else run.status = 'CANCELLED';
  run.revision++;
  pushAudit('陈立', '取消作业', id);
  return { run };
}

async function verifyRun(id) {
  await seedFromState();
  const run = S.runs.get(id);
  if (!run) return { error: 'NOT_FOUND' };
  return { run };
}

async function runQualityGates(id, gates) {
  await seedFromState();
  const run = S.runs.get(id);
  if (!run) return { error: 'NOT_FOUND' };
  const existing = S.qualityGates.get(id) || [];
  const map = new Map(existing.map((g) => [g.gateId, g]));
  for (const g of gates || []) {
    map.set(g.gateId, {
      gateId: g.gateId,
      name: g.name,
      status:
        g.status === 'pass' ? 'pass' : g.status === 'fail' ? 'fail' : 'pending',
      evidenceRef: g.evidenceRef || null,
    });
  }
  const updated = [...map.values()];
  S.qualityGates.set(id, updated);
  if (updated.some((g) => g.status === 'fail')) {
    pushNotice('质量门未通过：' + id, 'warn', run.reqId);
  }
  return { gates: updated };
}

async function replayRun(id) {
  await seedFromState();
  const steps = S.replays.get(id) || [];
  return { steps };
}

/* ---------------- 租约（控制端切换，原子冲突） ---------------- */

async function acquireLease({ runId, controller, bridgeId }) {
  await seedFromState();
  const cur = S.leases.get(runId);
  if (cur && cur.controller !== controller) {
    return { error: 'LEASE_HELD', lease: cur };
  }
  const lease = {
    runId,
    controller,
    deviceId: bridgeId || null,
    deviceName: controller === 'web' ? '浏览器工作台' : '本地 Bridge',
    state: 'active',
    acquiredAt: new Date().toISOString(),
  };
  S.leases.set(runId, lease);
  return { lease };
}

async function handoffLease({ runId, to }) {
  await seedFromState();
  const lease = {
    runId,
    controller: to,
    deviceId: null,
    deviceName:
      to === 'web'
        ? '浏览器工作台'
        : to === 'zed'
          ? 'Zed 会话镜像'
          : '本地 Bridge',
    state: 'active',
    acquiredAt: new Date().toISOString(),
  };
  S.leases.set(runId, lease);
  return { lease };
}
const memory = {
  getRun,
  listRuns,
  createRun,
  planApprove,
  planReject,
  startRun,
  cancelRun,
  verifyRun,
  runQualityGates,
  replayRun,
  acquireLease,
  handoffLease,
};
module.exports = { memory };

const runtime = require('../runtime'),
  access = require('../access'),
  repo = require('../persistence/runs'),
  reqRepo = require('../persistence/requirements'),
  dto = require('./dto');
const output = require('../persistence/run-output'),
  leases = require('../persistence/leases'),
  notices = require('../persistence/notices'),
  events = require('../persistence/events');
const { withTransaction } = require('../persistence/transaction'),
  { command } = require('../persistence/commands'),
  { randomUUID } = require('node:crypto');
async function readBundle(client, db, ctx, run) {
  const req = (
    await client.query(
      'SELECT * FROM "' + db.schema + '".reqs WHERE tenant_id=$1 AND id=$2',
      [ctx.tenantId, run.req_id],
    )
  ).rows[0];
  const p = await repo.plan(client, db, ctx, run.id);
  const parent = run.parent_id
    ? (
        await client.query(
          'SELECT public_id FROM "' +
            db.schema +
            '".runs WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, run.parent_id],
        )
      ).rows[0]?.public_id
    : null;
  return {
    run: dto.run(run, req.public_id, parent),
    plan: p
      ? {
          id: p.public_id,
          runId: run.public_id,
          plan: p.plan,
          approvedBy: p.approved_by,
          approvedAt: dto.iso(p.approved_at),
          rejectedReason: p.rejected_reason,
          baseline: p.baseline,
        }
      : null,
    lines: await output.lines(client, db, ctx, run),
    replay: await output.replay(client, db, ctx, run),
    qualityGates: await output.gates(client, db, ctx, run),
    lease: leases.dto(await leases.get(client, db, ctx, run.id), run.public_id),
  };
}
async function lockedRun(client, db, ctx, id) {
  const found = await repo.find(client, db, ctx, id);
  if (!found) access.fail('NOT_FOUND', 404);
  const req = (
    await client.query(
      'SELECT * FROM "' +
        db.schema +
        '".reqs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [ctx.tenantId, found.req_id],
    )
  ).rows[0];
  const run = await repo.find(client, db, ctx, id, true);
  return { req, run };
}
async function changed(client, db, ctx, req, run, action) {
  const updated = (
    await client.query(
      'UPDATE "' +
        db.schema +
        '".runs SET revision=revision+1 WHERE tenant_id=$1 AND id=$2 RETURNING *',
      [ctx.tenantId, run.id],
    )
  ).rows[0];
  await reqRepo.audit(client, db, ctx, req.id, action);
  await events.append(
    client,
    db,
    ctx,
    'run.status',
    run.public_id,
    updated.revision,
    {
      runId: run.public_id,
      reqId: req.public_id,
      ...dto.run(updated, req.public_id),
    },
  );
  return updated;
}
async function runCommand(id, input, operation, work) {
  const ctx = access.current(true),
    db = runtime.db();
  return command(db, ctx, operation + ':' + id, input, async (client) => {
    const { req, run } = await lockedRun(client, db, ctx, id);
    access.revision(run, input.expectedRevision);
    await work(client, db, ctx, req, run);
    const updated = await changed(client, db, ctx, req, run, operation);
    return readBundle(client, db, ctx, updated);
  });
}
module.exports.getRun = async (id) => {
  const ctx = access.current(),
    db = runtime.db();
  return withTransaction(db, async (client) => {
    await client.query(
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
    );
    const run = await repo.find(client, db, ctx, id);
    return run ? readBundle(client, db, ctx, run) : null;
  });
};
module.exports.listRuns = async (reqId) => {
  const ctx = access.current(),
    db = runtime.db();
  return withTransaction(db, async (client) => {
    await client.query(
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
    );
    const rows = (
      await client.query(
        'SELECT r.* FROM "' +
          db.schema +
          '".runs r JOIN "' +
          db.schema +
          '".reqs q ON q.tenant_id=r.tenant_id AND q.id=r.req_id WHERE r.tenant_id=$1 AND ($2::text IS NULL OR q.public_id=$2) ORDER BY r.created_at DESC LIMIT 100',
        [ctx.tenantId, reqId || null],
      )
    ).rows;
    const items = [];
    for (const row of rows) items.push(await readBundle(client, db, ctx, row));
    return { items };
  });
};
module.exports.createRun = async (input) => {
  const ctx = access.current(true),
    db = runtime.db();
  access.text(input.plan || '', 16000);
  return command(db, ctx, 'run.create', input, async (client) => {
    const req = await reqRepo.lock(client, db, ctx, input.reqId);
    access.revision(req, input.expectedRevision);
    const design = require('./requirement-service').latest(
      await reqRepo.versions(client, db, ctx, req.id),
      'design',
    );
    if (req.stage !== 'dev' || !design?.confirmed_at || design.stale)
      access.fail('STAGE_BLOCKED', 409, '请先确认设计并进入开发阶段');
    const parent = input.parentId
      ? await repo.find(client, db, ctx, input.parentId)
      : null;
    if (input.parentId && (!parent || parent.req_id !== req.id))
      access.fail('INVALID_PARENT', 400);
    const run = await repo.create(client, db, ctx, req, input, parent);
    await reqRepo.audit(client, db, ctx, req.id, 'run.created');
    await events.append(
      client,
      db,
      ctx,
      'run.status',
      run.public_id,
      run.revision,
      { runId: run.public_id, reqId: req.public_id, status: run.status },
    );
    return readBundle(client, db, ctx, run);
  });
};
async function validPlan(client, db, ctx, req, run) {
  const p = await repo.plan(client, db, ctx, run.id);
  if (!p || p.baseline !== (await repo.baseline(client, db, ctx, req)))
    access.fail('STALE_PLAN', 409, '计划基线已变化，请重新发起计划');
  return p;
}
module.exports.planApprove = (id, by, input = {}) =>
  runCommand(id, input, 'run.approved', async (client, db, ctx, req, run) => {
    if (run.status !== 'WAITING_APPROVAL') access.fail('INVALID_RUN_STATE');
    await validPlan(client, db, ctx, req, run);
    await client.query(
      'UPDATE "' +
        db.schema +
        '".run_plans SET approved_by=$1,approved_at=coalesce(approved_at,now()) WHERE tenant_id=$2 AND run_id=$3 AND rejected_reason IS NULL',
      [ctx.actor, ctx.tenantId, run.id],
    );
  });
module.exports.planReject = (id, reason, input = {}) =>
  runCommand(id, input, 'run.rejected', async (client, db, ctx, req, run) => {
    access.text(reason, 4000, true);
    if (run.status !== 'WAITING_APPROVAL') access.fail('INVALID_RUN_STATE');
    await client.query(
      'UPDATE "' +
        db.schema +
        '".run_plans SET approved_by=NULL,approved_at=NULL,rejected_reason=$1 WHERE tenant_id=$2 AND run_id=$3',
      [reason, ctx.tenantId, run.id],
    );
    await client.query(
      'UPDATE "' +
        db.schema +
        '".runs SET status=$1 WHERE tenant_id=$2 AND id=$3',
      ['FAILED', ctx.tenantId, run.id],
    );
    await notices.append(
      client,
      db,
      ctx,
      req,
      '模拟作业计划已拒绝：' + id,
      'warn',
    );
  });
module.exports.startRun = async (id, input = {}) => {
  const ctx = access.current(true),
    db = runtime.db();
  const result = await runCommand(
    id,
    input,
    'run.started',
    async (client, db, ctx, req, run) => {
      const p = await validPlan(client, db, ctx, req, run);
      if (!p.approved_at) access.fail('PLAN_NOT_APPROVED');
      if (run.status !== 'WAITING_APPROVAL' || run.started_at)
        access.fail('INVALID_RUN_STATE');
      const bridge = require('../ws').selectBridge(ctx.tenantId);
      await client.query(
        'UPDATE "' +
          db.schema +
          '".runs SET status=$1,started_at=now(),bridge_id=$2,bridge_name=$3,execution_mode=$4,dispatch_id=$5,dispatch_state=$6 WHERE tenant_id=$7 AND id=$8',
        [
          'RUNNING',
          bridge?.id || 'server-simulation',
          bridge?.name || '服务端模拟',
          bridge ? 'bridge-simulation' : 'server-simulation',
          randomUUID(),
          'dispatching',
          ctx.tenantId,
          run.id,
        ],
      );
    },
  );
  // Conditional claim prevents retrying a committed response from dispatching twice.
  const claimed = (
    await db.pool.query(
      'UPDATE "' +
        db.schema +
        '".runs SET dispatch_state=$1 WHERE tenant_id=$2 AND public_id=$3 AND dispatch_id=$4 AND dispatch_state=$5 AND status=$6 RETURNING *',
      [
        'sent',
        ctx.tenantId,
        id,
        result.run.dispatchId,
        'dispatching',
        'RUNNING',
      ],
    )
  ).rows[0];
  if (claimed) {
    if (claimed.bridge_id === 'server-simulation') simulate(ctx, result);
    else if (
      !require('../ws').sendJob(claimed.bridge_id, {
        type: 'job.start',
        runId: id,
        reqId: result.run.reqId,
        operation: '模拟开发实现',
        plan: result.plan.plan,
        dispatchId: claimed.dispatch_id,
      })
    )
      await disconnected(ctx.tenantId, claimed.bridge_id);
  }
  return result;
};
module.exports.cancelRun = async (id, input = {}) => {
  const ctx = access.current(true);
  const result = await runCommand(
    id,
    input,
    'run.cancelled',
    async (client, db, ctx, req, run) => {
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status)) return;
      const state =
        run.bridge_id && run.bridge_id !== 'server-simulation'
          ? 'CANCELLING'
          : 'CANCELLED';
      await client.query(
        'UPDATE "' +
          db.schema +
          '".runs SET status=$1 WHERE tenant_id=$2 AND id=$3',
        [state, ctx.tenantId, run.id],
      );
      if (state === 'CANCELLED') await leases.lose(client, db, ctx, run.id);
    },
  );
  if (
    result.run.status === 'CANCELLING' &&
    !require('../ws').sendJob(result.run.bridgeId, {
      type: 'job.cancel',
      runId: id,
      dispatchId: result.run.dispatchId,
    })
  )
    await disconnected(ctx.tenantId, result.run.bridgeId);
  return result;
};
module.exports.verifyRun = async (id) => {
  const result = await module.exports.getRun(id);
  if (!result) access.fail('NOT_FOUND', 404);
  return result;
};
module.exports.runQualityGates = (id, gates, input = {}) =>
  runCommand(id, input, 'run.quality', async (client, db, ctx, req, run) => {
    if (!Array.isArray(gates) || gates.length > 20)
      access.fail('INVALID_GATES', 400);
    for (const g of gates) {
      access.text(g.gateId, 120, true);
      access.text(g.name, 240, true);
      if (!['pass', 'fail', 'pending'].includes(g.status))
        access.fail('INVALID_GATES', 400);
      await output.saveGate(client, db, ctx, run, {
        ...g,
        evidenceRef: g.evidenceRef
          ? 'sim://' + String(g.evidenceRef).slice(0, 1000)
          : null,
      });
    }
    if (gates.some((g) => g.status === 'fail'))
      await notices.append(
        client,
        db,
        ctx,
        req,
        '模拟质量门未通过：' + id,
        'warn',
      );
  }).then((result) => ({ ...result, gates: result.qualityGates }));
module.exports.replayRun = async (id, query = {}) => {
  const ctx = access.current(),
    db = runtime.db(),
    run = await repo.find(db.pool, db, ctx, id);
  if (!run) access.fail('NOT_FOUND', 404);
  return {
    steps: await output.replay(
      db.pool,
      db,
      ctx,
      run,
      query.offset,
      query.limit,
    ),
  };
};
module.exports.runLines = async (id, query = {}) => {
  const ctx = access.current(),
    db = runtime.db(),
    run = await repo.find(db.pool, db, ctx, id);
  if (!run) access.fail('NOT_FOUND', 404);
  return {
    items: await output.lines(
      db.pool,
      db,
      ctx,
      run,
      query.afterSeq,
      query.limit,
    ),
    revision: run.revision,
  };
};
module.exports.acquireLease = (input) =>
  runCommand(
    input.runId,
    input,
    'lease.acquired',
    async (client, db, ctx, req, run) => {
      if (!['web', 'bridge', 'zed'].includes(input.controller))
        access.fail('INVALID_CONTROLLER', 400);
      const old = await leases.get(client, db, ctx, run.id);
      if (
        old?.state === 'active' &&
        (old.actor !== ctx.actor ||
          old.controller !== input.controller ||
          old.device_id !== (input.bridgeId || null))
      )
        access.fail('LEASE_HELD');
      await leases.save(client, db, ctx, run, input);
    },
  );
module.exports.handoffLease = (input) =>
  runCommand(
    input.runId,
    input,
    'lease.handoff',
    async (client, db, ctx, req, run) => {
      const old = await leases.get(client, db, ctx, run.id);
      if (!old || old.state !== 'active' || old.actor !== ctx.actor)
        access.fail('LEASE_HELD');
      if (!['web', 'bridge', 'zed'].includes(input.to))
        access.fail('INVALID_CONTROLLER', 400);
      await leases.save(client, db, ctx, run, { controller: input.to });
    },
  );
async function receive(bridge, m) {
  const ctx = {
      tenantId: bridge.tenantId,
      actor: 'Bridge:' + bridge.id,
      role: 'bridge',
    },
    db = runtime.db();
  if (
    !bridge.simulated ||
    ![
      'job.line',
      'job.snapshot',
      'job.done',
      'job.error',
      'job.cancelled',
    ].includes(m.type) ||
    !m.eventId ||
    String(m.eventId).length > 160 ||
    !Number.isInteger(m.seq) ||
    m.seq < 1 ||
    Buffer.byteLength(JSON.stringify(m)) > 65536
  )
    access.fail('INVALID_BRIDGE_EVENT', 400);
  await command(
    db,
    ctx,
    'bridge.event:' + m.dispatchId,
    { ...m, commandId: m.eventId },
    async (client) => {
      const { req, run } = await lockedRun(client, db, ctx, m.runId);
      if (run.bridge_id !== bridge.id || run.dispatch_id !== m.dispatchId)
        access.fail('DISPATCH_MISMATCH', 403);
      if (!['RUNNING', 'CANCELLING'].includes(run.status))
        return { ignored: true };
      if (m.seq <= run.last_bridge_seq) return { duplicate: true };
      if (m.seq !== run.last_bridge_seq + 1) access.fail('EVENT_SEQUENCE_GAP');
      if (run.status === 'CANCELLING' && m.type !== 'job.cancelled') {
        await client.query(
          'UPDATE "' +
            db.schema +
            '".runs SET last_bridge_seq=$1 WHERE tenant_id=$2 AND id=$3',
          [m.seq, ctx.tenantId, run.id],
        );
        return { ignored: true };
      }
      if (m.type === 'job.line') {
        access.text(m.text, 16000);
        if (!['info', 'cmd', 'ok', 'warn', 'error'].includes(m.cls))
          access.fail('INVALID_LINE', 400);
        const seq = await output.appendLine(client, db, ctx, run, m);
        await events.append(
          client,
          db,
          ctx,
          'job.line',
          run.public_id,
          run.revision,
          {
            runId: run.public_id,
            reqId: req.public_id,
            lineSeq: seq,
            cls: m.cls,
            text: m.text,
            source: 'simulation',
            dispatchId: run.dispatch_id,
          },
        );
      } else if (m.type === 'job.snapshot') {
        if (
          !Number.isInteger(m.stepNo) ||
          m.stepNo < 1 ||
          m.stepNo > 1000 ||
          !String(m.snapshotRef).startsWith('sim://')
        )
          access.fail('INVALID_SNAPSHOT', 400);
        access.text(m.label, 4000);
        await output.snapshot(client, db, ctx, run, m);
      } else {
        if (m.type === 'job.cancelled' && run.status !== 'CANCELLING')
          return { ignored: true };
        if (m.type === 'job.done' && !Number.isInteger(m.exitCode))
          access.fail('INVALID_EXIT_CODE', 400);
        const status =
          m.type === 'job.cancelled'
            ? 'CANCELLED'
            : m.type === 'job.done' && m.exitCode === 0
              ? 'SUCCEEDED'
              : 'FAILED';
        await client.query(
          'UPDATE "' +
            db.schema +
            '".runs SET status=$1,exit_code=$2,pct=100,step=(SELECT count(*) FROM "' +
            db.schema +
            '".replays WHERE run_id=$3) WHERE tenant_id=$4 AND id=$3',
          [
            status,
            m.type === 'job.done' ? m.exitCode : null,
            run.id,
            ctx.tenantId,
          ],
        );
        await leases.lose(client, db, ctx, run.id);
        await notices.append(
          client,
          db,
          ctx,
          req,
          '模拟作业 ' + run.public_id + '：' + status,
          status === 'SUCCEEDED' ? 'info' : 'warn',
        );
        await changed(client, db, ctx, req, run, 'run.' + status.toLowerCase());
      }
      await client.query(
        'UPDATE "' +
          db.schema +
          '".runs SET last_bridge_seq=$1 WHERE tenant_id=$2 AND id=$3',
        [m.seq, ctx.tenantId, run.id],
      );
      return { ok: true };
    },
  );
  require('./events').kick();
}
async function disconnected(tenantId, bridgeId) {
  const db = runtime.db(),
    ctx = { tenantId, actor: 'server-recovery', role: 'owner' };
  const rows = (
    await db.pool.query(
      'SELECT public_id FROM "' +
        db.schema +
        '".runs WHERE tenant_id=$1 AND bridge_id=$2 AND status=ANY($3::text[])',
      [tenantId, bridgeId, ['RUNNING', 'CANCELLING']],
    )
  ).rows;
  for (const row of rows)
    await withTransaction(db, async (client) => {
      const { req, run } = await lockedRun(client, db, ctx, row.public_id);
      if (!['RUNNING', 'CANCELLING'].includes(run.status)) return;
      await client.query(
        'UPDATE "' +
          db.schema +
          '".runs SET status=$1,dispatch_state=$2 WHERE tenant_id=$3 AND id=$4',
        ['UNKNOWN', 'unknown', tenantId, run.id],
      );
      await leases.lose(client, db, ctx, run.id);
      await changed(client, db, ctx, req, run, 'run.unknown');
    });
  require('./events').kick();
}
module.exports.recover = async () => {
  const db = runtime.db();
  const pairs = (
    await db.pool.query(
      'SELECT DISTINCT tenant_id,bridge_id FROM "' +
        db.schema +
        '".runs WHERE status=ANY($1::text[])',
      [['RUNNING', 'CANCELLING']],
    )
  ).rows;
  for (const p of pairs) await disconnected(p.tenant_id, p.bridge_id);
};
const simulations = new Set();
function simulate(ctx, bundle) {
  const timer = setTimeout(async () => {
    simulations.delete(timer);
    const bridge = {
        id: 'server-simulation',
        tenantId: ctx.tenantId,
        simulated: true,
      },
      base = { runId: bundle.run.id, dispatchId: bundle.run.dispatchId };
    try {
      await receive(bridge, {
        ...base,
        type: 'job.line',
        seq: 1,
        eventId: randomUUID(),
        cls: 'info',
        text: '[服务端模拟] 已读取需求，未执行真实 Shell 或测试',
      });
      await receive(bridge, {
        ...base,
        type: 'job.snapshot',
        seq: 2,
        eventId: randomUUID(),
        stepNo: 1,
        label: '模拟结果',
        snapshotRef: 'sim://run/' + bundle.run.id,
      });
      await receive(bridge, {
        ...base,
        type: 'job.done',
        seq: 3,
        eventId: randomUUID(),
        exitCode: 0,
      });
    } catch {}
  }, 180);
  simulations.add(timer);
  timer.unref();
}
runtime.onClose(() => {
  for (const timer of simulations) clearTimeout(timer);
  simulations.clear();
});
module.exports.receive = receive;
module.exports.disconnected = disconnected;

memory.receive = async (bridge, m) => {
  const bridgeId = bridge.id,
    name = bridge.name;
  const assigned = S.runs.get(m.runId);
  if (
    !assigned ||
    assigned.bridgeId !== bridgeId ||
    !['RUNNING', 'CANCELLING'].includes(assigned.status)
  )
    return;
  if (m.type === 'job.cancelled' && assigned.status === 'CANCELLING') {
    assigned.status = 'CANCELLED';
    assigned.revision++;
    wsBridge.broadcast('run.status', {
      runId: assigned.id,
      reqId: assigned.reqId,
      status: assigned.status,
      revision: assigned.revision,
    });
    return;
  }
  if (assigned.status === 'CANCELLING') return;
  if (m.type === 'job.line') {
    const list = S.lines.get(m.runId) || [];
    const line = {
      seq: list.length + 1,
      cls: ['info', 'cmd', 'ok', 'warn', 'error'].includes(m.cls)
        ? m.cls
        : 'info',
      text: String(m.text || '').slice(0, 16000),
      at: new Date().toISOString(),
    };
    list.push(line);
    S.lines.set(m.runId, list);
    wsBridge.broadcast('job.line', {
      runId: m.runId,
      reqId: assigned.reqId,
      ...line,
    });
    return;
  }
  if (m.type === 'job.snapshot') {
    const steps = S.replays.get(m.runId) || [];
    steps.push({
      stepNo: m.stepNo || steps.length + 1,
      label: m.label || '',
      snapshotRef: m.snapshotRef || '',
    });
    S.replays.set(m.runId, steps);
    return;
  }
  if (m.type === 'job.done') {
    const run = S.runs.get(m.runId);
    if (run) {
      run.exitCode = m.exitCode;
      run.status = m.exitCode === 0 ? 'SUCCEEDED' : 'FAILED';
      run.pct = 100;
      run.step = (S.replays.get(m.runId) || []).length;
      run.revision++;
      pushAudit('Bridge:' + name, '作业完成', m.runId + ' exit=' + m.exitCode);
    }
    wsBridge.broadcast('run.status', {
      runId: m.runId,
      reqId: run.reqId,
      status: run.status,
      pct: 100,
      step: run.step,
      exitCode: run.exitCode,
      revision: run.revision,
    });
    return;
  }
  if (m.type === 'job.error') {
    const run = S.runs.get(m.runId);
    if (run) {
      run.status = 'FAILED';
      run.revision++;
      pushAudit(
        'Bridge:' + name,
        '作业失败',
        m.runId + '：' + (m.message || ''),
      );
    }
    wsBridge.broadcast('run.status', {
      runId: m.runId,
      reqId: run.reqId,
      status: 'FAILED',
      revision: run.revision,
    });
  }
};
memory.disconnected = async (tenantId, bridgeId) => {
  for (const run of S.runs.values()) {
    if (
      run.bridgeId !== bridgeId ||
      !['RUNNING', 'CANCELLING'].includes(run.status)
    )
      continue;
    run.status = 'UNKNOWN';
    run.revision++;
    wsBridge.broadcast('run.status', {
      runId: run.id,
      reqId: run.reqId,
      status: 'UNKNOWN',
      revision: run.revision,
    });
  }
};
memory.attachDispatch = (run, b) => {
  run.bridgeId = b.id;
  run.bridgeName = b.name;
  run.executionMode = b.simulated ? 'bridge-simulation' : 'bridge-unverified';
};
