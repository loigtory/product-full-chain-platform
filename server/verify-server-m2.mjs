import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* PFC Server · M2a 领域写 API 验证（verify-server-m2.mjs）
 * 覆盖：reqs 写端点真实实现 + 状态机门控（advance blockers）+
 * runs 计划审批硬门 + 质量门/回放/租约 + 事件通知（13 号第八节）。
 * 运行：node verify-server-m2.mjs */
const root = dirname(fileURLToPath(import.meta.url));
const PORT = 5192;
const BASE = 'http://127.0.0.1:' + PORT;
const results = [];
let failed = false;
function check(name, ok, extra = '') {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', note: extra });
  if (!ok) failed = true;
  console.log(JSON.stringify({ check: name, status: ok ? 'PASS' : 'FAIL', note: extra }));
}
async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json };
}

await mkdtemp(join(tmpdir(), 'pfc-m2-'));
const srv = spawn(process.execPath, ['src/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), PFC_DB: 'memory', JWT_SECRET: 'm2-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('服务启动超时')), 10000);
  srv.stdout.on('data', (d) => {
    if (String(d).includes('[pfc-server]')) {
      clearTimeout(timer);
      resolve();
    }
  });
  srv.on('exit', (c) => reject(new Error('服务提前退出 code=' + c)));
});

/* 登录 */
const login = await api('POST', '/api/auth/dev-login', { name: '陈立' });
const token = login.json?.token;
check('m2-login', typeof token === 'string' && token.split('.').length === 3);

/* 种子（工厂小种子：1 req + idea 版本未确认 + 问题 + 通知 + 知识） */
const seed = {
  schema: 1,
  seq: 1200,
  reqs: {
    'R-1042': {
      id: 'R-1042', name: '会员积分过期提醒', goal: '积分过期无提醒，客诉占比 8%',
      owner: '陈立', stage: 'idea', closed: false, artifacts: {
        idea: [{ id: 'R-1042-idea-v1', version: 1, title: '需求草案', fields: [{ name: '目标', value: '提醒' }], confirmed: false }],
      },
      questions: [{ id: 'q1', text: '覆盖范围？', answer: null }],
      materials: [{ name: '原始想法', content: '积分过期提醒', classification: '内部', status: '已纳入' }],
      messages: [{ id: 'M1', stage: 'idea', role: 'user', content: '想法' }],
    },
  },
  knowledge: [
    { id: 'KN-01', title: '提醒设置页前端规范', type: '组件规范', content: '复用组件库', tags: ['前端', '提醒'] },
    { id: 'KN-04', title: '上线检查清单', type: 'Playbook', content: '检查回滚方案', tags: ['上线', '发布'] },
  ],
  notices: [{ id: 'NT-1', title: '发布审批待处理', kind: 'info', req: 'R-1042', read: false, at: '2026-09-10T00:00:00Z' }],
};
await api('PUT', '/api/state', { state: seed, revision: 1 }, token);

/* 1 领域 store 从种子导入：list 读到 R-1042 */
const list = await api('GET', '/api/reqs', null, token);
check('m2-seed-import', list.status === 200 && list.json?.total === 1 && list.json.items[0].id === 'R-1042');

/* 2 创建需求：201 + idea 阶段 + 知识检索命中（KN-01/04） */
const created = await api('POST', '/api/reqs', { name: '新需求A', goal: '提醒类优化', scope: '测试范围' }, token);
const nid = created.json?.req?.id;
check('m2-create-req', created.status === 201 && created.json?.req?.stage === 'idea');
check('m2-create-knowledge-refs', Array.isArray(created.json?.knowledgeRefs) && created.json.knowledgeRefs.length >= 1);

/* 3 阶段门控：idea→req 但 idea 版本未确认 → 409 blockers */
const gate = await api('PATCH', '/api/reqs/' + nid + '/stage', { to: 'req' }, token);
check('m2-gate-blocked', gate.status === 409 && gate.json?.error?.code === 'STAGE_BLOCKED' && gate.json?.blockers?.length > 0);

/* 4 确认 idea 版本后推进成功 */
const versions = await api('GET', '/api/reqs/' + nid + '/versions', null, token);
const vid = versions.json?.versions?.find((v) => v.stage === 'idea')?.id;
await api('POST', '/api/reqs/' + nid + '/versions/' + vid + '/confirm', {}, token);
const adv = await api('PATCH', '/api/reqs/' + nid + '/stage', { to: 'req' }, token);
check('m2-gate-passed', adv.status === 200 && adv.json?.req?.stage === 'req' && adv.json?.blockers?.length === 0);

/* 5 材料 / 澄清 / 消息 */
const mat = await api('POST', '/api/reqs/' + nid + '/materials', { name: '访谈纪要', content: '用户反馈' }, token);
check('m2-material', mat.status === 201 && mat.json?.material?.status === '已纳入' && mat.json?.quota?.limit === 100);
const detail = await api('GET', '/api/reqs/R-1042', null, token);
const qid = detail.json?.req?.questions?.[0]?.id;
const q = await api('POST', '/api/reqs/R-1042/questions/' + qid + '/answer', { answer: '全体会员' }, token);
check('m2-answer', q.status === 200 && q.json?.question?.answer === '全体会员');
const msg = await api('POST', '/api/reqs/' + nid + '/messages', { content: '开始设计' }, token);
check('m2-message', msg.status === 201 && msg.json?.message?.role === 'user' && Array.isArray(msg.json?.actions));

/* 6 runs：创建 → WAITING_APPROVAL + plan */
const run = await api('POST', '/api/runs', { reqId: nid, plan: '测试计划：1) 实现 2) 测试' }, token);
const runId = run.json?.run?.id;
check('m2-run-created', run.status === 201 && run.json?.run?.status === 'WAITING_APPROVAL' && run.json?.plan?.plan?.includes('测试计划'));

/* 7 审批硬门：未批准 start → 409 */
const startBlocked = await api('POST', '/api/runs/' + runId + '/start', {}, token);
check('m2-approval-hard-gate', startBlocked.status === 409 && startBlocked.json?.error?.code === 'PLAN_NOT_APPROVED');

/* 8 拒绝（原因必填 + 通知 warn） */
const rejectNoReason = await api('POST', '/api/runs/' + runId + '/plan-reject', {}, token);
check('m2-reject-reason-required', rejectNoReason.status === 400);
const run2 = await api('POST', '/api/runs', { reqId: nid }, token);
const runId2 = run2.json?.run?.id;
const rejected = await api('POST', '/api/runs/' + runId2 + '/plan-reject', { reason: '方案需补充数据设计' }, token);
check('m2-reject-audit', rejected.status === 200 && rejected.json?.run?.status === 'FAILED' && !!rejected.json?.audit?.id);

/* 9 批准 → 启动 → SUCCEEDED + 回放 */
const run3 = await api('POST', '/api/runs', { reqId: nid }, token);
const runId3 = run3.json?.run?.id;
await api('POST', '/api/runs/' + runId3 + '/plan-approve', { by: '陈立' }, token);
const started = await api('POST', '/api/runs/' + runId3 + '/start', {}, token);
check('m2-run-succeeded', started.status === 200 && started.json?.run?.status === 'SUCCEEDED' && started.json?.run?.pct === 100);
const replay = await api('GET', '/api/runs/' + runId3 + '/replay', null, token);
check('m2-replay-steps', replay.status === 200 && replay.json?.steps?.length >= 3);

/* 10 质量门：fail 触发通知 */
const gates = await api('POST', '/api/runs/' + runId3 + '/quality-gates', {
  gates: [
    { gateId: 'lint', name: 'Lint / 静态检查', status: 'pass' },
    { gateId: 'unit', name: '单元测试', status: 'fail' },
  ],
}, token);
check('m2-gates-recorded', gates.status === 200 && gates.json?.gates?.length === 2 && gates.json.gates.some((g) => g.status === 'fail'));

/* 11 租约：acquire → handoff → 冲突 409 */
await api('POST', '/api/leases/acquire', { runId: runId3, controller: 'web' }, token);
const held = await api('POST', '/api/leases/acquire', { runId: runId3, controller: 'zed' }, token);
check('m2-lease-conflict', held.status === 409 && held.json?.error?.code === 'LEASE_HELD' && held.json?.lease?.deviceName === '浏览器工作台');
const handoff = await api('POST', '/api/leases/handoff', { runId: runId3, to: 'zed' }, token);
check('m2-lease-handoff', handoff.status === 200 && handoff.json?.lease?.deviceName === 'Zed 会话镜像');

/* 12 通知：种子 1 + 拒绝 warn + 质量门 warn = unread ≥ 3 */
const noti = await api('GET', '/api/notices', null, token);
check('m2-notices-events', noti.status === 200 && noti.json?.unread >= 3 && noti.json.items.some((n) => n.kind === 'warn'));

srv.kill();
console.log(JSON.stringify({ status: failed ? 'FAIL' : 'PASS', checks: results.length, results }));
process.exitCode = failed ? 1 : 0;
