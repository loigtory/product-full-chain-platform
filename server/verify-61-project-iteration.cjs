'use strict';
// 61 号端到端：真实项目迭代场景（现有系统迭代）
//  模拟"现有系统迭代需加载本地项目"：从真实代码库复制模块到授权工作区（副本）
//  → EXEC 真实 codex 会话读现有代码 → 新增功能函数 + 补测试 → 真实运行测试
//  → 独立验证：新函数存在、现有逻辑未破坏、node --test 真实通过
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = 'D:\\项目管理\\product-full-chain-platform';
const NODE = path.join(REPO, '.tools', 'node-v24.20.0-win-x64', 'node.exe');
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function main() {
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  const login = await fetch(BASE + '/api/auth/local-session', { method: 'POST', headers: H, body: JSON.stringify({ key }) });
  if (login.status !== 200) throw new Error('LOGIN_FAILED ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const auth = { ...H, cookie };
  let gid = null;
  const getDetail = async (id) => { const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth }); return (await r.json()).req; };

  // 1. 创建需求（真实项目迭代）
  const stamp = Date.now().toString().slice(-6);
  const reqName = 'CODEx_TEST_61_ITER_' + stamp;
  const cr = await fetch(BASE + '/api/reqs', { method: 'POST', headers: auth, body: JSON.stringify({ name: reqName, goal: '61 端到端：现有系统迭代——加载本地真实模块副本，新增功能并补测试，真实运行通过。', scope: '61 e2e iteration', commandId: '61-create-' + Date.now().toString(36) }) });
  const crj = await cr.json();
  if (cr.status !== 201) throw new Error('CREATE_FAILED ' + JSON.stringify(crj).slice(0, 200));
  const reqId = crj.req.id;
  console.log('created', reqName, 'stage=' + crj.req.stage);
  let d = await getDetail(reqId);
  for (const q of d.questions || []) {
    await fetch(BASE + '/api/reqs/' + reqId + '/questions/' + q.id + '/answer', { method: 'POST', headers: auth, body: JSON.stringify({ answer: '已确认：现有系统迭代验证——真实模块副本新增功能。', expectedRevision: d.revision, commandId: '61-ans-' + q.id + '-' + Date.now().toString(36) }) });
    d = await getDetail(reqId);
  }
  {
    const v = [...(d.versions || [])].reverse().find((x) => x.stage === d.stage);
    if (v) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (v.id || v.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '61-cf-idea-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const r = await fetch(BASE + '/api/reqs/' + reqId + '/stage', { method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: d.revision, commandId: '61-stage-req-' + Date.now().toString(36) }) });
    const j = await r.json();
    if (r.status !== 200 || j.req?.stage !== 'req') throw new Error('STAGE_ADVANCE_BLOCKED ' + JSON.stringify(j).slice(0, 200));
    d = j.req;
  }
  {
    const rv = [...(d.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (rv.id || rv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '61-cf-req-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const wsr = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-workspace', { headers: auth });
    const wsj = await wsr.json();
    const fp = wsj.inputFingerprint;
    const prop = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals', { method: 'POST', headers: auth, body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: fp, expectedRevision: wsj.revision, commandId: '61-prop-' + Date.now().toString(36) }) });
    const propj = await prop.json();
    const pid = (propj.proposal?.id || propj.proposal?.public_id || propj.proposalId);
    if (!pid) throw new Error('PROPOSAL_FAILED ' + JSON.stringify(propj).slice(0, 200));
    d = await getDetail(reqId);
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals/' + pid + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: fp, expectedRevision: d.revision, commandId: '61-adopt-' + Date.now().toString(36) }) });
    const adj = await ad.json();
    gid = adj.group?.id || adj.group?.public_id || (adj.artifactGroup && (adj.artifactGroup.id || adj.artifactGroup.public_id));
    if (!gid) throw new Error('ADOPT_FAILED ' + JSON.stringify(adj).slice(0, 200));
    d = await getDetail(reqId);
    await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-business', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（61）', advanceTo: 'design', inputFingerprint: fp, expectedRevision: d.revision, commandId: '61-cb-' + Date.now().toString(36) }) });
    d = await getDetail(reqId);
  }
  {
    const dv = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    if (dv) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (dv.id || dv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '61-cf-design-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const dv2 = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-design', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '实施设计已确认（61）', advanceTo: 'dev', designVersionId: dv2?.id || dv2?.public_id, scope: { goal: '现有系统迭代：session-store 新增 publicId + 补测试', files: 'src/session-store.cjs, test/*.test.js', validation: 'node --test', exit: '汇报真实测试输出', rollback: 'git revert', capabilityIds: [] }, expectedRevision: d.revision, commandId: '61-cd-' + Date.now().toString(36) }) });
    const adj = await ad.json();
    if (ad.status !== 200) throw new Error('CONFIRM_DESIGN_FAILED ' + JSON.stringify(adj).slice(0, 200));
    d = await getDetail(reqId);
    if (d.stage !== 'dev') throw new Error('NOT_IN_DEV ' + d.stage);
  }

  // 2. 加载现有代码库副本（真实模块 session-store.js → workspace/src/session-store.cjs）
  const wsRoot = path.join(REPO, '.local', 'ai-tools-remediation-20260916', 'CODEx_TEST_AI_FIX_20260916_' + randomUUID());
  const ws = path.join(wsRoot, 'workspace');
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'test'), { recursive: true });
  const srcText = fs.readFileSync(path.join(REPO, 'server', 'src', 'local', 'session-store.js'), 'utf8');
  const profileText = fs.readFileSync(path.join(REPO, 'server', 'src', 'local', 'profile.js'), 'utf8');
  fs.writeFileSync(path.join(ws, 'src', 'session-store.cjs'), srcText, { flag: 'wx' });
  fs.writeFileSync(path.join(ws, 'src', 'profile.cjs'), profileText, { flag: 'wx' });
  const srcHash0 = sha(srcText);
  console.log('loaded real module session-store.js (' + srcText.split('\n').length + ' lines) → workspace/src/*.cjs 含依赖');

  // 3. 计划 + EXEC 真实作业（迭代：新增 publicId + 补测试）
  const execControl = require(path.join(REPO, 'server', 'src', 'agent', 'exec-control.js'));
  const baseline = execControl.baselineHash(execControl.scanWorkspace(ws));
  const control = { confirmed: true, mode: 'strict', allowedFiles: ['src/**', 'test/**'], allowedCommands: [['node', '--test']], maxFiles: 50, maxBytes: 2097152, validUntil: new Date(Date.now() + 240000).toISOString(), baselineHash: baseline };
  const msg = await fetch(BASE + '/api/reqs/' + reqId + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({
    content:
      '工作区是受控 EXEC 作业，模拟「现有系统迭代」：已加载真实模块副本 src/session-store.cjs（原 server/src/local/session-store.js，CommonJS）；依赖 src/profile.cjs 已一并加载（fault 来源）。\n' +
      '现有 API 包括 createVerifier/cookieName/cookieId/login/remove 等，不得破坏。\n' +
      '请完成真实迭代闭环：\n' +
      '1) 用 pfc_read_file 读取 src/session-store.cjs（读返回的 sha256 即写回 expectedHash）；\n' +
      '2) 新增函数 publicId()：返回字符串形式 "sess_" + 16 位十六进制小写随机 id（用 node:crypto randomBytes），导出到 module.exports；\n' +
      '3) 新建 test/session-store.test.js（**必须用 ESM import 语法**，因为项目根 package.json 为 type:module；import store from "../src/session-store.cjs"）断言 publicId() 匹配 /^sess_[0-9a-f]{16}$/ 且两次调用不同；\n' +
      '4) 用 codex_cli 执行命令向量 ["node","--test"] 确认真实通过；\n' +
      '5) 汇报：改动文件、新增函数、测试真实输出、结论。',
    stage: 'dev', mode: 'real', tool: 'exec', workspace: ws, control, expectedRevision: d.revision, commandId: '61-msg-' + Date.now().toString(36),
  }) });
  const msgj = await msg.json();
  console.log('sendMessage', msg.status, JSON.stringify({ jobId: msgj.jobId, reply: msgj.reply?.id, err: msgj.error?.code || msgj.error?.message }).slice(0, 200));
  if (msg.status !== 200 && msg.status !== 201) throw new Error('SEND_FAILED ' + JSON.stringify(msgj).slice(0, 300));
  const aiMessageId = msgj.reply?.id;

  // 4. 轮询
  const deadline = Date.now() + 300000;
  let final = null;
  while (Date.now() < deadline) {
    await sleep(5000);
    const m = await fetch(BASE + '/api/reqs/' + reqId + '/messages?offset=0&limit=10', { headers: auth });
    const mj = await m.json();
    const list = mj.messages || mj.items || [];
    const ai = list.find((x) => x.id === aiMessageId) || [...list].reverse().find((x) => x.role === 'ai');
    if (ai && ai.status !== 'generating') { final = { msgStatus: ai.status, content: ai.content || '' }; break; }
  }
  if (!final) { console.log('E2E TIMEOUT'); process.exit(4); }

  // 5. 独立验证
  const afterSrc = fs.existsSync(path.join(ws, 'src', 'session-store.cjs')) ? fs.readFileSync(path.join(ws, 'src', 'session-store.cjs'), 'utf8') : '';
  const profileExists = fs.existsSync(path.join(ws, 'src', 'profile.cjs'));
  const testExists = fs.existsSync(path.join(ws, 'test', 'session-store.test.js'));
  const testText = testExists ? fs.readFileSync(path.join(ws, 'test', 'session-store.test.js'), 'utf8') : '';
  const hasPublicId = /publicId\s*[:=(]|function\s+publicId/.test(afterSrc) && /sess_/.test(afterSrc);
  const hasCreateVerifier = /createVerifier/.test(afterSrc);
  const hasCookieId = /cookieId/.test(afterSrc);
  const testImportsCjs = /import\s+store\s+from\s+['"]\.\.\/src\/session-store\.cjs['"]/.test(testText);
  let greenExit = -1, greenOut = '';
  try { execFileSync(NODE, ['--test'], { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] }); greenExit = 0; } catch (e) { greenExit = e.status ?? -1; greenOut = String(e.stderr || e.stdout || '').slice(0, 300); }
  const verdict = { msgStatus: final.msgStatus, profileExists, hasPublicId, hasCreateVerifier, hasCookieId, testExists, testImportsCjs, greenExit };
  console.log('VERIFY', JSON.stringify(verdict, null, 2));
  console.log('AI 回写片段', JSON.stringify(final.content.slice(0, 300)));
  const ok = final.msgStatus === 'ok' && profileExists && hasPublicId && hasCreateVerifier && hasCookieId && testExists && testImportsCjs && greenExit === 0;
  console.log('ITERATION_VERDICT', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 3);
}
main().catch((e) => { console.error('E2E_ERR', e.message); process.exit(1); });
