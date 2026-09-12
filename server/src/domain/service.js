'use strict';
/* =====================================================================
 * 领域服务（M2a）：reqs / runs / leases 写语义
 * 对齐《13-M1接口清单》第二节（需求域）与第三节（执行域）：
 * 状态机门控（state-machine）、审计留痕、事件通知（13 号第八节触发点）。
 * 执行仍为模拟推进（Bridge 驱动在 M2b，诚实标注）。
 * ===================================================================== */
const { S, seedFromState, pushAudit, pushNotice, nextId } = require('./store');
const sm = require('./state-machine');
const wsBridge = require('../ws'); // 只使用 dispatchJob（无环依赖：ws.js 不 import service）

/* ---------------- 需求域 ---------------- */
async function listReqs(stage, q) {
  await seedFromState();
  const items = [...S.reqs.values()]
    .filter(
      (r) =>
        (!stage || r.stage === stage) &&
        (!q || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)),
    )
    .map((r) => ({ id: r.id, name: r.name, stage: r.stage, owner: r.owner, goal: r.goal, closed: r.closed }));
  return { items, total: items.length };
}

async function getReq(id) {
  await seedFromState();
  const req = S.reqs.get(id);
  if (!req) return null;
  return {
    ...req,
    versions: [...S.versions.values()].filter((v) => v.reqId === id),
    materials: [...S.materials.values()].filter((m) => m.reqId === id),
    questions: [...S.questions.values()].filter((q) => q.reqId === id),
    caps: [],
    units: [],
  };
}

/* 创建需求：服务端做知识库自动检索（keyword 顶替向量检索，13 号第十节） */
async function createReq({ name, goal, scope, owner, projectId }) {
  await seedFromState();
  const id = nextId('R');
  S.reqs.set(id, {
    id,
    name: name || '未命名需求',
    goal: goal || '',
    scope: scope || '',
    owner: owner || '陈立',
    stage: 'idea',
    projectId: projectId || null,
    closed: false,
    createdAt: new Date().toISOString(),
  });
  const content = { id: id + '-idea-v1', version: 1, title: '需求草案', fields: [
    { name: '需求名称', value: name },
    { name: '目标', value: goal },
    { name: '范围', value: scope },
  ], confirmed: false, review: '待评审', comments: [], createdAt: new Date().toISOString() };
  S.versions.set('SV-' + S.seq.ver, {
    id: 'SV-' + S.seq.ver++,
    reqId: id,
    stage: 'idea',
    version: 1,
    content,
    confirmedBy: null,
    confirmedAt: null,
    stale: false,
  });
  /* 知识库 keyword 检索（模拟）：匹配目标词返回条目 */
  const knowledgeRefs = [...S.knowledge || []].filter((k) =>
    [name, goal, scope].some((t) => t && k.title.includes(t) || t && k.tags.some((tag) => (t || '').includes(tag))),
  ).slice(0, 3).map((k) => ({ id: k.id, title: k.title }));
  pushAudit(owner || '陈立', '需求登记', name || id);
  return { req: await getReq(id), knowledgeRefs };
}

/* 阶段推进：服务端校验全部阻塞条件（状态机门控） */
async function advanceStage(id, to) {
  await seedFromState();
  const req = S.reqs.get(id);
  if (!req) return { error: 'NOT_FOUND' };
  const bl = sm.blockers(S, req, to);
  if (bl.length) return { req: await getReq(id), blockers: bl };
  req.stage = to;
  pushAudit('陈立', '阶段推进', id + ' → ' + to);
  return { req: await getReq(id), blockers: [] };
}

/* 确认版本：使下游评审过期（stale） */
async function confirmVersion(id, vid) {
  await seedFromState();
  const v = S.versions.get(vid);
  if (!v || v.reqId !== id) return { error: 'NOT_FOUND' };
  const latest = [...S.versions.values()].filter(x => x.reqId === id && x.stage === v.stage)
    .sort((a, b) => b.version - a.version)[0];
  if (latest?.id !== vid) return { error: 'STALE_VERSION' };
  v.confirmedBy = '陈立';
  v.confirmedAt = new Date().toISOString();
  v.stale = false;
  for (const other of S.versions.values()) {
    if (other.reqId === id && other.stage !== v.stage && other.version > v.version) other.stale = true;
  }
  pushAudit('陈立', '确认版本', id + ' ' + v.stage + ' v' + v.version);
  return { version: v };
}

async function addMaterial(id, { name, content, cls }) {
  await seedFromState();
  const req = S.reqs.get(id);
  if (!req) return { error: 'NOT_FOUND' };
  const m = {
    id: 'SM-' + S.seq.mat,
    reqId: id,
    name: name || '材料' + S.seq.mat,
    content: content || '',
    cls: cls || '内部',
    type: '文本',
    status: '已纳入',
    createdAt: new Date().toISOString(),
  };
  S.seq.mat++;
  S.materials.set(m.id, m);
  pushAudit('陈立', '登记材料', id + ' ' + m.name);
  return { material: m, quota: { used: S.materials.size, limit: 100 } };
}

async function answerQuestion(id, qid, { answer }) {
  await seedFromState();
  const q = S.questions.get(qid);
  if (!q || q.reqId !== id) return { error: 'NOT_FOUND' };
  q.answer = answer;
  q.answeredBy = '陈立';
  pushAudit('陈立', '回答澄清', id + ' ' + q.q);
  return { question: q };
}

async function sendMessage(id, { content, attachments }) {
  await seedFromState();
  const req = S.reqs.get(id);
  if (!req) return { error: 'NOT_FOUND' };
  const m = {
    id: 'SMSG-' + S.seq.msg,
    reqId: id,
    stage: req.stage,
    turnId: 'T-' + S.seq.msg,
    role: 'user',
    content: content || '',
    attachments: attachments || [],
    status: 'ok',
    createdAt: new Date().toISOString(),
  };
  S.seq.msg++;
  S.messages.set(m.id, m);
  return { message: m, actions: [] }; // Agent 响应动作在 M2b 接 Bridge 后回填
}

async function getMessages(id, stage, offset, limit) {
  await seedFromState();
  const all = [...S.messages.values()]
    .filter((m) => m.reqId === id && (!stage || m.stage === stage))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { items: all.slice(offset, offset + limit), total: all.length };
}

async function getVersions(id, stage) {
  await seedFromState();
  const all = [...S.versions.values()]
    .filter((v) => v.reqId === id && (!stage || v.stage === stage))
    .sort((a, b) => b.version - a.version);
  return { versions: all };
}

// Explicit draft registration: UI templates are not confirmations or test evidence.
async function saveVersion(id, { stage, content }) {
  await seedFromState();
  if (!S.reqs.has(id)) return { error: 'NOT_FOUND' };
  if (!['idea', 'req', 'design', 'dev'].includes(stage) || !content?.id ||
      !Number.isInteger(content.version) || content.version < 1 ||
      !Array.isArray(content.fields) || !content.fields.length ||
      content.fields.some(f => typeof f.name !== 'string' || typeof f.value !== 'string' || !f.value.trim()))
    return { error: 'INVALID_VERSION' };
  const versions = [...S.versions.values()].filter(v => v.reqId === id && v.stage === stage);
  if (versions.some(v => v.version > content.version)) return { error: 'STALE_VERSION' };
  const existing = versions.find(v => v.version === content.version);
  if (existing?.confirmedAt) {
    if (JSON.stringify(existing.content.fields) !== JSON.stringify(content.fields)) return { error: 'STALE_VERSION' };
    return { version: existing };
  }
  const vid = existing?.id || 'SV-' + S.seq.ver++;
  const version = { id: vid, reqId: id, stage, version: content.version,
    content: { ...content, confirmed: false }, confirmedBy: null, confirmedAt: null, stale: false };
  S.versions.set(vid, version);
  return { version };
}

async function getRun(id) {
  await seedFromState();
  const run = S.runs.get(id);
  if (!run) return null;
  return { run, plan: S.runPlans.get(id + '-plan') || null,
    lines: S.lines.get(id) || [], replay: S.replays.get(id) || [],
    qualityGates: S.qualityGates.get(id) || [], lease: S.leases.get(id) || null };
}
async function listRuns(reqId) {
  await seedFromState();
  return { items: await Promise.all([...S.runs.values()].filter(r => !reqId || r.reqId === reqId).map(r => getRun(r.id))) };
}

/* ---------------- 执行域（M1 模拟执行，M2b 接 Bridge） ---------------- */
async function createRun({ reqId, plan, commandId, parentId }) {
  await seedFromState();
  const req = S.reqs.get(reqId);
  if (!req) return { error: 'NOT_FOUND' };
  if (commandId && S.commands.has(commandId)) {
    const prior = S.commands.get(commandId);
    if (prior.reqId !== reqId || prior.plan !== plan) return { error: 'COMMAND_CONFLICT' };
    return getRun(prior.runId);
  }
  const id = 'R-' + (++S.seq.run);
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
    plan: plan || '拆解：1) 读取项目结构与目标文件 2) 按方案实现改动并运行测试 3) 格式化、构建并汇总差异供验收',
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
  if (run.status !== 'WAITING_APPROVAL' || plan?.rejectedReason) return { error: 'INVALID_RUN_STATE' };
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
  if (typeof reason !== 'string' || !reason.trim()) return { error: 'REASON_REQUIRED' };
  reason = reason.trim();
  const plan = S.runPlans.get(id + '-plan');
  if (plan?.rejectedReason === reason && run.status === 'FAILED') return { run, audit: S.audit.findLast(a => a.detail === id + '：' + reason) };
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
    { cls: 'cmd', text: 'codex> 已连接工作区（模拟执行，未检测到在线 Bridge）' },
    { cls: 'info', text: 'codex> 读取需求与现有接口…' },
    { cls: 'cmd', text: 'codex> 创建变更文件（模拟）' },
    { cls: 'ok', text: 'codex> 单元测试 3 passed（模拟）' },
  ];
  S.replays.set(id, lines.map((l, i) => ({ stepNo: i + 1, label: l.cls + ' ' + l.text, snapshotRef: 'sim://run/' + id + '/step' + (i + 1) })));
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
  if (['SUCCEEDED','FAILED','CANCELLED','CANCELLING'].includes(run.status)) return { run };
  if (run.bridgeId) run.status = wsBridge.cancelJob(run) ? 'CANCELLING' : 'UNKNOWN';
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
      status: g.status === 'pass' ? 'pass' : g.status === 'fail' ? 'fail' : 'pending',
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
    deviceName: to === 'web' ? '浏览器工作台' : to === 'zed' ? 'Zed 会话镜像' : '本地 Bridge',
    state: 'active',
    acquiredAt: new Date().toISOString(),
  };
  S.leases.set(runId, lease);
  return { lease };
}

module.exports = {
  getRun, listRuns, saveVersion,
  listReqs, getReq, createReq, advanceStage, confirmVersion,
  addMaterial, answerQuestion, sendMessage, getMessages, getVersions,
  createRun, planApprove, planReject, startRun, cancelRun, verifyRun,
  runQualityGates, replayRun, acquireLease, handoffLease,
};
