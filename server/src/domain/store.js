'use strict';
/* =====================================================================
 * 领域存储（M2a）：结构对齐 m1-schema.sql 正式表
 *   - 内存态实现（Map，验证/演示路径）；首次启动从状态树种子导入（前端工厂数据连续性）
 *   - PG 落表适配为 M2b：领域逻辑与存储解耦，store 是唯一出入口
 * 诚实标注：本层为内存态领域存储（重启丢失）；PG 适配后自动升级为正式表。
 * ===================================================================== */
const db = require('../db');

const S = {
  reqs: new Map(),
  versions: new Map(), // {id, reqId, stage, version, content, confirmedBy, confirmedAt, stale}
  materials: new Map(), // {id, reqId, name, content, cls, type, status, createdAt}
  questions: new Map(), // {id, reqId, q, answer, answeredBy}
  messages: new Map(), // {id, reqId, stage, turnId, role, content, attachments, status, createdAt}
  runs: new Map(), // {id, reqId, status, step, pct, controller, budget, spent, exitCode, operation, createdAt}
  commands: new Map(), // process-local request idempotency
  runPlans: new Map(), // {id, runId, plan, approvedBy, approvedAt, rejectedReason}
  qualityGates: new Map(), // runId -> [{gateId, name, status, evidenceRef}]
  replays: new Map(), // runId -> [{stepNo, label, snapshotRef}]
  lines: new Map(), // runId -> [{cls, text, at}]（Bridge 实时对话流）
  releases: new Map(), // {id, reqId, target, scope, rollback, hours, status, actor, createdAt, startedAt}
  knowledge: [], // {id, title, type, content, tags, sourceReq, at}
  notices: [], // {id, title, kind, req, read, at}
  audit: [], // {id, actor, action, detail, at}
  leases: new Map(), // runId -> {controller, deviceId, deviceName, state, acquiredAt}
  seq: { req: 1040, ver: 1, mat: 1, q: 1, msg: 1, run: 100, rel: 1, n: 100, a: 100 },
  seeded: false,
};

function nextId(prefix) {
  const n = prefix === 'R' ? ++S.seq.req : 0;
  return prefix + '-' + n;
}

/* 从状态树种子导入（M1 前端工厂数据 → 领域模型），保证数据连续 */
async function seedFromState() {
  if (S.seeded) return;
  const state = await db.getState();
  if (S.seeded) return;
  if (!state || !state.reqs) return;
  S.seeded = true;
  S.seq.req = Math.max(S.seq.req, Number(state.seq) || 0);
  for (const [id, r] of Object.entries(state.reqs)) {
    S.seq.req = Math.max(S.seq.req, Number(id.replace(/^R-/, '')) || 0);
    for (const run of r.runs || [])
      S.seq.run = Math.max(S.seq.run, Number(run.id.replace(/^R-/, '')) || 0);
    if (S.reqs.has(id)) continue;
    S.reqs.set(id, {
      id,
      name: r.name,
      goal: r.goal || '',
      scope: r.scope || '',
      owner: r.owner || '陈立',
      stage: r.stage || 'idea',
      projectId: r.projectId || null,
      closed: !!r.closed,
      createdAt: new Date().toISOString(),
    });
    for (const [stage, arts] of Object.entries(r.artifacts || {})) {
      for (const a of arts) {
        S.versions.set('SV-' + S.seq.ver, {
          id: 'SV-' + S.seq.ver++,
          reqId: id,
          stage,
          version: a.version || 1,
          content: a,
          confirmedBy: a.confirmed ? r.owner || '陈立' : null,
          confirmedAt: a.confirmed ? a.createdAt : null,
          stale: !!a.stale,
        });
      }
    }
    for (const m of r.materials || []) {
      S.materials.set('SM-' + S.seq.mat, {
        id: 'SM-' + S.seq.mat++,
        reqId: id,
        name: m.name,
        content: m.content,
        cls: m.classification || '内部',
        type: m.type,
        status: m.status || '未纳入',
        createdAt: r.createdAt,
      });
    }
    for (const q of r.questions || []) {
      S.questions.set('SQ-' + S.seq.q, {
        id: 'SQ-' + S.seq.q++,
        reqId: id,
        q: q.text,
        answer: q.answer || null,
        answeredBy: q.answer ? r.owner : null,
      });
    }
    for (const m of r.messages || []) {
      S.messages.set('SMSG-' + S.seq.msg, {
        id: 'SMSG-' + S.seq.msg++,
        reqId: id,
        stage: m.stage,
        turnId: m.turnId,
        role: m.role,
        content: m.content,
        attachments: m.attachments || [],
        status: m.status || 'ok',
        createdAt: new Date().toISOString(),
      });
    }
  }
  for (const run of state.runs || []) {
    S.runs.set(run.id, {
      id: run.id,
      reqId: run.reqId || 'R-1042',
      status: run.status === 'SUCCEEDED' ? 'SUCCEEDED' : run.status === 'RUNNING' ? 'RUNNING' : 'QUEUED',
      step: run.step || 0,
      pct: run.pct || 0,
      controller: run.controller || 'web',
      budget: run.budget || 8000,
      spent: 0,
      exitCode: run.exitCode,
      operation: run.operation || '开发实现',
      createdAt: new Date().toISOString(),
    });
    if (run.planApproved) {
      S.runPlans.set(run.id + '-plan', {
        id: run.id + '-plan',
        runId: run.id,
        plan: run.planApproved.plan,
        approvedBy: run.planApproved.by,
        approvedAt: run.planApproved.at,
        rejectedReason: null,
      });
    }
    if (run.qualityGates) {
      S.qualityGates.set(run.id, run.qualityGates.map((g) => ({
        gateId: g.id,
        name: g.name,
        status: g.status === '通过' ? 'pass' : g.status === '待执行' ? 'pending' : 'pending',
        evidenceRef: null,
      })));
    }
  }
  for (const n of state.notices || []) S.notices.push({ ...n });
  for (const k of state.knowledge || []) S.knowledge.push({ ...k });
}

function pushAudit(actor, action, detail) {
  S.audit.push({
    id: 'A-' + (++S.seq.a),
    actor,
    action,
    detail,
    at: new Date().toISOString(),
  });
}

function pushNotice(title, kind, req) {
  S.notices.unshift({
    id: 'NT-' + (++S.seq.n),
    title,
    kind,
    req: req || null,
    read: false,
    at: new Date().toISOString(),
  });
  return S.notices[0];
}

module.exports = { S, seedFromState, pushAudit, pushNotice, nextId };
