'use strict';
// 67 号验收：dev→test 真实 EXEC 证据门禁
// 场景 A：需求推进到 dev（未跑任何 dev EXEC）→ POST delivery-baselines → 409 DEV_EXEC_EVIDENCE_REQUIRED
// 场景 B：同需求跑真实 EXEC dev 作业（codex 真实写码+测试）→ agent_jobs SUCCEEDED 落库核对
//         → dev 版本实质化（消息 diff 采纳）→ 关联项目 → 测试套件 READY → 证据材料 → handoff 放行 stage=test
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const REPO = 'D:\\项目管理\\product-full-chain-platform';
const NODE = path.join(REPO, '.tools', 'node-v24.20.0-win-x64', 'node.exe');
const PG = 'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local';
const sha = (b) => createHash('sha256').update(b).digest('hex');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loginOnce() {
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  for (let i = 0; i < 5; i++) {
    const login = await fetch(BASE + '/api/auth/local-session', { method: 'POST', headers: H, body: JSON.stringify({ key }) });
    if (login.status === 200) return { ...H, cookie: (login.headers.get('set-cookie') || '').split(';')[0] };
    await sleep(15000);
  }
  throw new Error('LOGIN_RATE_LIMITED');
}

const ART = {
  design: '# 方案设计\n\n## 背景与目标\n\n迭代现有系统，补齐 AI 作业能力。\n\n## 总体架构\n\n前端 + 服务端 + 数据库三层。\n\n## 数据模型\n\n见接口定义。',
  sequence: '```sequenceDiagram\nsequenceDiagram\n    PM->>Platform: 提交想法\n    Platform->>Agent: 指派作业\n```',
  flow: '```flowchart\nflowchart TD\n    A[提交想法] --> B[需求澄清]\n    B --> C[确认方案]\n```',
  prototype: '<!doctype html><html><head></head><body><input id="q" placeholder="提问" /><button onclick="alert(1)">提交</button></body></html>',
};

async function toDev(auth, getDetail, suffix) {
  // 创建→项目关联（确认前设置 project_id，避免后续作废业务方案回退 stage）→澄清→req→business→design（人工补录四产物）→confirm-design→dev
  const stamp = Date.now().toString().slice(-6);
  const reqName = 'CODEx_TEST_67_' + suffix + '_' + stamp;
  const cr = await fetch(BASE + '/api/reqs', { method: 'POST', headers: auth, body: JSON.stringify({ name: reqName, goal: '67 端到端：dev→test 真实 EXEC 证据门禁（' + suffix + '）。', scope: '67 e2e gate', commandId: '67-create-' + Date.now().toString(36) }) });
  const crj = await cr.json();
  if (cr.status !== 201) throw new Error('CREATE_FAILED ' + JSON.stringify(crj).slice(0, 200));
  const reqId = crj.req.id;
  const pj = await fetch(BASE + '/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ name: '67-e2e-project-' + Date.now().toString().slice(-6), path: 'D:\\67-e2e', source: 'existing', tech: ['node'], commandId: '67-proj-' + Date.now().toString(36) }) });
  const pjj = await pj.json();
  const projId = pjj.project?.id || pjj.project?.public_id || pjj.public_id || pjj.id;
  const pa0 = await fetch(BASE + '/api/reqs/' + reqId + '/project', { method: 'PATCH', headers: auth, body: JSON.stringify({ projectId: projId, expectedRevision: crj.req.revision, commandId: '67-proj-link-' + Date.now().toString(36) }) });
  if (pa0.status !== 200) throw new Error('PROJECT_LINK_FAILED ' + JSON.stringify(await pa0.json().catch(() => ({}))).slice(0, 200));
  let d = await getDetail(reqId);
  for (const q of d.questions || []) {
    await fetch(BASE + '/api/reqs/' + reqId + '/questions/' + q.id + '/answer', { method: 'POST', headers: auth, body: JSON.stringify({ answer: '已确认：67 门禁验证。', expectedRevision: d.revision, commandId: '67-ans-' + q.id + '-' + Date.now().toString(36) }) });
    d = await getDetail(reqId);
  }
  {
    const v = [...(d.versions || [])].reverse().find((x) => x.stage === d.stage);
    if (v) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (v.id || v.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '67-cf-idea-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const r = await fetch(BASE + '/api/reqs/' + reqId + '/stage', { method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: d.revision, commandId: '67-stage-req-' + Date.now().toString(36) }) });
    d = (await r.json()).req;
  }
  let gid;
  {
    const rv = [...(d.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (rv.id || rv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '67-cf-req-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const wsj = await (await fetch(BASE + '/api/reqs/' + reqId + '/artifact-workspace', { headers: auth })).json();
    const prop = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals', { method: 'POST', headers: auth, body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: wsj.inputFingerprint, expectedRevision: wsj.revision, commandId: '67-prop-' + Date.now().toString(36) }) });
    const pid = (await prop.json()).proposal?.id || (await prop.json()).proposal?.public_id;
    d = await getDetail(reqId);
    const adj = await (await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals/' + pid + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: wsj.inputFingerprint, expectedRevision: d.revision, commandId: '67-adopt-' + Date.now().toString(36) }) })).json();
    gid = adj.group?.id || adj.group?.public_id;
    d = await getDetail(reqId);
    const cbj = await (await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-business', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（67）', advanceTo: 'design', inputFingerprint: wsj.inputFingerprint, expectedRevision: d.revision, commandId: '67-cb-' + Date.now().toString(36) }) })).json();
    d = cbj.req || (await getDetail(reqId));
  }
  for (const k of ['design', 'sequence', 'flow', 'prototype']) {
    await fetch(BASE + '/api/agent/requirements/' + reqId + '/design-artifacts', { method: 'PUT', headers: auth, body: JSON.stringify({ kind: k, name: '67-' + k, content: ART[k] }) });
  }
  const dv = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
  const cd = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-design', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '67 设计产物齐套放行。', advanceTo: 'dev', designVersionId: dv?.id || dv?.public_id, scope: { goal: '67 dev 门禁', files: 'workspace/**', validation: 'true', exit: '无需执行', rollback: 'git revert', capabilityIds: [] }, expectedRevision: d.revision, commandId: '67-cd-' + Date.now().toString(36) }) });
  const cdj = await cd.json();
  if (cd.status !== 200 || cdj.nextStage !== 'dev') throw new Error('CONFIRM_DESIGN_FAILED ' + JSON.stringify(cdj).slice(0, 200));
  d = await getDetail(reqId);
  return { reqId, gid, name: reqName };
}

async function realDevExec(auth, reqId, d) {
  // 61 式：加载真实模块副本 → EXEC 真实 codex 写函数+测试 → SUCCEEDED
  const wsRoot = path.join(REPO, '.local', 'ai-tools-host-exec-20260917', 'CODEx_TEST_AI_HOST_20260917_' + randomUUID());
  const ws = path.join(wsRoot, 'workspace');
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'test'), { recursive: true });
  const srcText = fs.readFileSync(path.join(REPO, 'server', 'src', 'local', 'session-store.js'), 'utf8');
  const profileText = fs.readFileSync(path.join(REPO, 'server', 'src', 'local', 'profile.js'), 'utf8');
  fs.writeFileSync(path.join(ws, 'src', 'session-store.cjs'), srcText, { flag: 'wx' });
  fs.writeFileSync(path.join(ws, 'src', 'profile.js'), profileText, { flag: 'wx' });
  // 仓库根 package.json 是 type:module，profile.js 被当 ESM 导致 CJS require 崩溃；
  // 在 src/ 放 type:commonjs 标记，使 session-store.cjs/profile.js 按 CJS 加载，
  // test/ 仍按仓库根 type:module 走 ESM import（node 可 import CJS 默认导出）。
  fs.writeFileSync(path.join(ws, 'src', 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const execControl = require(path.join(REPO, 'server', 'src', 'agent', 'exec-control.js'));
  const baseline = execControl.baselineHash(execControl.scanWorkspace(ws));
  const control = { confirmed: true, mode: 'strict', allowedFiles: ['src/**', 'test/**'], allowedCommands: [['node', '--test']], maxFiles: 50, maxBytes: 2097152, validUntil: new Date(Date.now() + 240000).toISOString(), baselineHash: baseline };
  const msg = await fetch(BASE + '/api/reqs/' + reqId + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({
    content:
      '工作区是受控 EXEC 作业（67 门禁验证）：已加载真实模块副本 src/session-store.cjs。现有 API 含 createVerifier/cookieId 等，不得破坏。\n' +
      '1) 用 pfc_read_file 读取 src/session-store.cjs；\n' +
      '2) 新增函数 publicId()：返回 "sess_" + 16 位十六进制小写随机 id（node:crypto randomBytes），导出；\n' +
      '3) 新建 test/session-store.test.js（ESM import，import store from "../src/session-store.cjs"）断言 publicId() 匹配 /^sess_[0-9a-f]{16}$/ 且两次不同；\n' +
      '4) 用 codex_cli 执行 ["node","--test"] 确认真实通过；\n' +
      '5) 汇报改动与测试输出。',
    stage: 'dev', mode: 'real', tool: 'exec', workspace: ws, control, expectedRevision: d.revision, commandId: '67-msg-' + Date.now().toString(36),
  }) });
  const msgj = await msg.json();
  if (msg.status !== 200 && msg.status !== 201) throw new Error('EXEC_SEND_FAILED ' + JSON.stringify(msgj).slice(0, 300));
  const aiMessageId = msgj.reply?.id;
  const deadline = Date.now() + 300000;
  let final = null;
  const pollPgc = new Client({ connectionString: PG });
  await pollPgc.connect();
  const reqDb = await pollPgc.query('SELECT id FROM pfc_workbench.reqs WHERE public_id=$1', [reqId]);
  const reqDbId = reqDb.rows[0]?.id;
  let jobState = null, jobErr = null;
  while (Date.now() < deadline) {
    await sleep(5000);
    const j = await pollPgc.query("SELECT state,error_code FROM pfc_workbench.agent_jobs WHERE req_id=$1 AND kind='EXECUTE' ORDER BY created_at DESC LIMIT 1", [reqDbId]);
    jobState = j.rows[0]?.state || null;
    jobErr = j.rows[0]?.error_code || null;
    if (jobState === 'SUCCEEDED') break;
    if (jobState === 'FAILED' || jobState === 'TIMED_OUT' || jobState === 'CANCELLED') {
      await pollPgc.end();
      throw new Error('EXEC_JOB_' + jobState + ' ' + (jobErr || ''));
    }
  }
  await pollPgc.end();
  if (jobState !== 'SUCCEEDED') {
    console.log('EXEC 作业未成功，最终状态=' + jobState + ' err=' + jobErr);
    throw new Error('EXEC_TIMEOUT');
  }
  const m = await fetch(BASE + '/api/reqs/' + reqId + '/messages?offset=0&limit=10', { headers: auth });
  const mj = await m.json();
  const msgArr = (mj.items || []).concat(mj.messages || []);
  const list = msgArr.filter((x) => x.role === 'ai');
  final = list.find((x) => x.id === aiMessageId) || [...list].reverse()[0] || { status: 'ok' };
  if (final.status === 'failed' || final.status === 'error') {
    console.log('EXEC AI 消息失败：', JSON.stringify({ status: final.status, err: final.error, content: (final.content || '').slice(0, 300) }));
    throw new Error('EXEC_AI_FAILED');
  }
  // 独立验证工作区产物
  const afterSrc = fs.existsSync(path.join(ws, 'src', 'session-store.cjs')) ? fs.readFileSync(path.join(ws, 'src', 'session-store.cjs'), 'utf8') : '';
  const hasPublicId = /publicId/.test(afterSrc) && /sess_/.test(afterSrc);
  let greenExit = -1, greenOut = '';
  try { execFileSync(NODE, ['--test'], { cwd: ws, stdio: 'pipe' }); greenExit = 0; } catch (e) { greenExit = e.status ?? -1; greenOut = String(e.stdout || '').slice(-1500) + '\n---STDERR---\n' + String(e.stderr || '').slice(-1500); }
  if (greenExit !== 0) console.log('EXEC 工作区独立 node --test 失败输出：\n' + greenOut);
  return { final, hasPublicId, greenExit };
}

async function main() {
  console.log('67 号：dev→test 真实 EXEC 证据门禁验收');
  const auth = await loginOnce();
  const getDetail = async (id) => { const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth }); return (await r.json()).req; };

  // ---------- 场景 A：dev 无 EXEC → 409 ----------
  console.log('--- 场景 A：dev 阶段无真实 EXEC → handoff 阻断 ---');
  const A = await toDev(auth, getDetail, 'A_NOEXEC');
  let dA = await getDetail(A.reqId);
  const rA = await fetch(BASE + '/api/reqs/' + A.reqId + '/delivery-baselines', { method: 'POST', headers: auth, body: JSON.stringify({ devVersionId: 'x', changes: 'x', implementation: 'x', rollback: 'x', unimplemented: 'x', versionRef: 'x', evidence: [], expectedRevision: dA.revision, commandId: '67-a-handoff-' + Date.now().toString(36) }) });
  const jA = await rA.json();
  t('A：handoff 被 409 阻断', rA.status === 409, rA.status);
  t('A：错误码 DEV_EXEC_EVIDENCE_REQUIRED', jA.error?.code === 'DEV_EXEC_EVIDENCE_REQUIRED', jA.error?.code);
  t('A：错误信息指出需真实执行', (jA.error?.msg || '').includes('真实 EXEC'), (jA.error?.msg || '').slice(0, 80));
  dA = await getDetail(A.reqId);
  t('A：需求仍停 dev', dA.stage === 'dev', dA.stage);

  // ---------- 场景 B：真实 EXEC 后 → 完整 handoff 放行 ----------
  console.log('--- 场景 B：真实 EXEC dev 作业后 handoff 放行 ---');
  const B = await toDev(auth, getDetail, 'B_EXEC');
  let dB = await getDetail(B.reqId);
  const exec = await realDevExec(auth, B.reqId, dB);
  t('B：EXEC 真实产出代码（publicId+sess_）', exec.hasPublicId);
  t('B：独立重跑 node --test 真实通过', exec.greenExit === 0, exec.greenExit);
  // pg 核对 agent_jobs SUCCEEDED + input.stage=dev
  const pgc = new Client({ connectionString: PG });
  await pgc.connect();
  const job = await pgc.query("SELECT kind,state,input->>'stage' stage FROM pfc_workbench.agent_jobs WHERE req_id=(SELECT id FROM pfc_workbench.reqs WHERE public_id=$1) AND kind='EXECUTE' ORDER BY created_at DESC LIMIT 3", [B.reqId]);
  const devExecOk = job.rows.some((r) => r.kind === 'EXECUTE' && r.state === 'SUCCEEDED' && r.stage === 'dev');
  t('B：agent_jobs 存在 dev 阶段 SUCCEEDED 的 EXECUTE 记录（pg 直查）', devExecOk, job.rows.map((r) => r.state + '@' + r.stage));

  // dev 版本实质化：消息 diff 采纳（将目标/范围/实施说明改为…）
  dB = await getDetail(B.reqId);
  const dv = [...(dB.versions || [])].reverse().find((x) => x.stage === 'dev');
  t('B：dev 版本初始为待补充模板', /待补充|尚未确认/.test((dv?.content?.fields || []).map((f) => f.value).join('')), dv?.content?.fields);
  const diffMsg = await fetch(BASE + '/api/reqs/' + B.reqId + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({
    content: '开发完成：将目标改为：67 门禁验证目标；将范围改为：dev EXEC 代码作业与测试；将实施说明改为：已新增 publicId 并补 node --test 通过，改动见工作区。',
    stage: 'dev', mode: 'sim', expectedRevision: dB.revision, commandId: '67-diff-' + Date.now().toString(36),
  }) });
  const diffMsgj = await diffMsg.json();
  if (diffMsg.status !== 200 && diffMsg.status !== 201) console.log('DIFF SEND RESP:', JSON.stringify(diffMsgj).slice(0, 300));
  const aiMsg = diffMsgj.reply || (diffMsgj.items || []).find((m) => m.role === 'ai') || (diffMsgj.messages || []).find((m) => m.role === 'ai');
  const diffId = aiMsg?.id;
  const hasDiff = !!aiMsg?.diff;
  t('B：AI 消息生成字段 diff（将xx改为）', hasDiff, aiMsg?.diff && { fields: aiMsg.diff.fields.map((f) => f.name) });
  if (hasDiff) {
    const app = await fetch(BASE + '/api/reqs/' + B.reqId + '/messages/' + diffId + '/diff', { method: 'POST', headers: auth, body: JSON.stringify({ decision: 'accept', baseVersionId: aiMsg.diff.baseVersionId, expectedRevision: (await getDetail(B.reqId)).revision, commandId: '67-apply-' + Date.now().toString(36) }) });
    const appj = await app.json().catch(() => ({}));
    if (app.status !== 200) console.log('DIFF APPLY RESP:', JSON.stringify({ status: app.status, code: appj.error?.code, msg: (appj.error?.msg || '').slice(0, 100) }));
    t('B：diff 采纳成功', app.status === 200, app.status);
  }
  dB = await getDetail(B.reqId);
  const dv2 = [...(dB.versions || [])].reverse().find((x) => x.stage === 'dev');
  const devReal = !/待补充|尚未确认/.test((dv2?.content?.fields || []).map((f) => f.value).join(''));
  t('B：dev 版本已是实质内容', devReal, dv2?.content?.fields?.map((f) => f.name + '=' + (f.value || '').slice(0, 20)));

  // 项目关联（已在 toDev 确认链之前完成，避免作废业务方案回退 stage）
  dB = await getDetail(B.reqId);
  t('B：需求已关联项目', !!dB.projectId || !!dB.project, dB.projectId);

  // 测试套件：从 group 验收项派生完整用例
  const group = await (await fetch(BASE + '/api/reqs/' + B.reqId + '/artifact-groups/' + B.gid, { headers: auth })).json();
  const g = group.group || group;
  const acs = (g.acceptance?.content?.items) || [];
  const acIds = acs.map((a) => a.acId).filter(Boolean);
  t('B：group 验收项可读', acIds.length > 0, acIds.slice(0, 5));
  const cases = acIds.map((acId, i) => ({
    caseId: 'CASE-' + (i + 1),
    acIds: [acId],
    ruleIds: [],
    title: '用例' + (i + 1),
    scenario: '执行核心场景' + (i + 1),
    preconditions: '系统可用',
    steps: ['打开平台', '执行场景' + (i + 1)],
    expected: '符合预期',
    dataPolicy: '内部',
    owner: '陈立',
    executionMode: 'USER_REPORTED',
  }));
  dB = await getDetail(B.reqId);
  const g2 = group.group || group;
  const baseGroupId = g2.public_id || g2.id;
  const suiteCreate = await fetch(BASE + '/api/reqs/' + B.reqId + '/test-suites', { method: 'POST', headers: auth, body: JSON.stringify({ title: '67-套件', baseGroupId, cases, expectedRevision: dB.revision, commandId: '67-suite-' + Date.now().toString(36) }) });
  const suitej = await suiteCreate.json();
  const suiteId = suitej.suite?.id || suitej.suite?.public_id || suitej.id;
  t('B：测试套件创建成功', suiteCreate.status === 201, { status: suiteCreate.status, err: suitej.error?.code, msg: (suitej.error?.msg || '').slice(0, 100), suiteId: suiteId?.slice?.(0, 12) });
  const adopt = await fetch(BASE + '/api/reqs/' + B.reqId + '/test-suites/' + suiteId + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ currentSuiteId: null, baseGroupId, expectedRevision: (await getDetail(B.reqId)).revision, commandId: '67-adopt-suite-' + Date.now().toString(36) }) });
  const adoptj = await adopt.json().catch(() => ({}));
  console.log('SUITE ADOPT RESP:', JSON.stringify({ status: adopt.status, code: adoptj.error?.code, msg: (adoptj.error?.msg || '').slice(0, 120), suiteStatus: suitej.suite?.status, gaps: suitej.suite?.gaps }));
  t('B：套件采纳 READY', adopt.status === 200 && adoptj.adopted === true, adopt.status);

  // 证据材料（delivery 必填）：usage=attachment + 文件（带 hash），不进 group 输入指纹，
  // 因此不会在业务确认后触发 invalidate 回退 stage。
  const evBytes = Buffer.from('67 号交付证据：dev EXEC 作业 SUCCEEDED，node --test 真实通过。');
  const mat = await fetch(BASE + '/api/reqs/' + B.reqId + '/materials', { method: 'POST', headers: auth, body: JSON.stringify({ name: '67-dev-evidence.txt', usage: 'attachment', file: { name: '67-dev-evidence.txt', encoding: 'base64', content: evBytes.toString('base64'), mimeType: 'text/plain' }, expectedRevision: (await getDetail(B.reqId)).revision, commandId: '67-mat-' + Date.now().toString(36) }) });
  const matj = await mat.json();
  console.log('MATERIAL RESP:', JSON.stringify(matj).slice(0, 400));
  const matVer = (matj.material && (matj.material.versions || [])[0]) || matj.material || matj.version || matj;
  const evId = matj.material?.id || matj.material?.public_id || matVer.material_id || matj.materialId || matj.id;
  const evVersion = matVer.version || matj.versionNumber || 1;
  t('B：证据材料已登记', !!evId, { evId: evId?.slice(0, 12), ver: evVersion });

  // handoff：delivery create → 200 nextStage=test
  dB = await getDetail(B.reqId);
  const dvFinal = [...(dB.versions || [])].reverse().find((x) => x.stage === 'dev');
  const handoff = await fetch(BASE + '/api/reqs/' + B.reqId + '/delivery-baselines', { method: 'POST', headers: auth, body: JSON.stringify({
    devVersionId: dvFinal?.id || dvFinal?.public_id,
    versionRef: 'ws://67-exec',
    changes: '新增 publicId 函数与测试',
    implementation: '见工作区 src/session-store.cjs 与 test/session-store.test.js',
    rollback: 'git revert',
    unimplemented: '无',
    evidence: [{ id: evId, version: evVersion }],
    expectedRevision: dB.revision, commandId: '67-handoff-' + Date.now().toString(36),
  }) });
  const hj = await handoff.json();
  t('B：handoff 放行(200)', handoff.status === 200 || handoff.status === 201, { status: handoff.status, err: hj.error?.code, msg: (hj.error?.msg || '').slice(0, 80) });
  t('B：推进到 test', hj.nextStage === 'test', hj.nextStage);
  const dB3 = await getDetail(B.reqId);
  t('B：需求 stage=test', dB3.stage === 'test', dB3.stage);
  await pgc.end();

  console.log('\nRESULT: ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log('VERDICT ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e.code || e.message, (e.stack || '').split('\n')[1] || '');
  process.exit(2);
});
