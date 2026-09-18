'use strict';
// 59 号端到端：dev 阶段真实修码闭环（命中六项纠偏第 1 项验收）
//  真实需求 → 澄清 → 版本确认 → artifact → dev 阶段
//  → EXEC 真实 codex 会话：读缺陷文件 → 修复实现 → node --test 真实运行 → 消息回写
//  → 独立验证：src/add.js 被真实修改（哈希变化+正确实现）、test 未改动、node --test 本地真实通过
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = 'D:\\项目管理\\product-full-chain-platform';
const NODE = path.join(REPO, '.tools', 'node-v24.20.0-win-x64', 'node.exe');

// ---- 缺陷项目（正确实现应为 a+b；当前故意实现为 a-b，测试会失败）----
const ADD_IMPL_BROKEN = 'module.exports = (a, b) => a - b;\n';
const ADD_IMPL_FIXED = 'module.exports = (a, b) => a + b;\n';
const TEST_IMPL =
  "import { test } from 'node:test';\n" +
  "import assert from 'node:assert';\n" +
  "import add from '../src/add.js';\n" +
  "test('add(1,2) === 3', () => assert.strictEqual(add(1, 2), 3));\n";
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function main() {
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST', headers: H, body: JSON.stringify({ key }),
  });
  if (login.status !== 200) throw new Error('LOGIN_FAILED ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const auth = { ...H, cookie };
  let gid = null;
  const getDetail = async (id) => {
    const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth });
    return (await r.json()).req;
  };

  // 1. 创建需求
  const stamp = Date.now().toString().slice(-6);
  const reqName = 'CODEx_TEST_59_FIX_' + stamp;
  const cr = await fetch(BASE + '/api/reqs', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: reqName, goal: '59 端到端：dev 阶段真实修码闭环——模型读取缺陷实现、修复、真实运行测试并回写。', scope: '59 e2e fix-loop', commandId: '59-create-' + Date.now().toString(36) }),
  });
  const crj = await cr.json();
  if (cr.status !== 201) throw new Error('CREATE_FAILED ' + JSON.stringify(crj).slice(0, 300));
  const reqId = crj.req.id;
  console.log('created', reqName, 'stage=' + crj.req.stage);

  // 2. 澄清
  let d = await getDetail(reqId);
  for (const q of d.questions || []) {
    const a = await fetch(BASE + '/api/reqs/' + reqId + '/questions/' + q.id + '/answer', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ answer: '已确认：dev 阶段真实修码闭环验证。', expectedRevision: d.revision, commandId: '59-ans-' + q.id + '-' + Date.now().toString(36) }),
    });
    console.log('answer', q.id, a.status);
    d = await getDetail(reqId);
  }

  // 3. idea→req
  d = await getDetail(reqId);
  {
    const v = [...(d.versions || [])].reverse().find((x) => x.stage === d.stage);
    if (v) {
      await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (v.id || v.public_id) + '/confirm', {
        method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '59-cf-idea-' + Date.now().toString(36) }),
      });
      d = await getDetail(reqId);
    }
    const r = await fetch(BASE + '/api/reqs/' + reqId + '/stage', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: d.revision, commandId: '59-stage-req-' + Date.now().toString(36) }),
    });
    const j = await r.json();
    console.log('advance→req', r.status, 'stage=' + j.req?.stage);
    if (r.status !== 200 || j.req?.stage !== 'req') throw new Error('STAGE_ADVANCE_BLOCKED ' + JSON.stringify(j).slice(0, 200));
    d = j.req;
  }

  // 4. req 版本确认 + proposal → adopt → confirm-business（自动→design）
  d = await getDetail(reqId);
  {
    const rv = [...(d.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) {
      await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (rv.id || rv.public_id) + '/confirm', {
        method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '59-cf-req-' + Date.now().toString(36) }),
      });
      d = await getDetail(reqId);
    }
    const wsr = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-workspace', { headers: auth });
    const wsj = await wsr.json();
    const fp = wsj.inputFingerprint;
    const prop = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: fp, expectedRevision: wsj.revision, commandId: '59-prop-' + Date.now().toString(36) }),
    });
    const propj = await prop.json();
    const pid = (propj.proposal?.id || propj.proposal?.public_id || propj.proposalId);
    if (!pid) throw new Error('PROPOSAL_FAILED ' + JSON.stringify(propj).slice(0, 300));
    d = await getDetail(reqId);
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals/' + pid + '/adopt', {
      method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: fp, expectedRevision: d.revision, commandId: '59-adopt-' + Date.now().toString(36) }),
    });
    const adj = await ad.json();
    gid = adj.group?.id || adj.group?.public_id || (adj.artifactGroup && (adj.artifactGroup.id || adj.artifactGroup.public_id));
    if (!gid) throw new Error('ADOPT_FAILED ' + JSON.stringify(adj).slice(0, 300));
    d = await getDetail(reqId);
    const cb = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-business', {
      method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（59）', advanceTo: 'design', inputFingerprint: fp, expectedRevision: d.revision, commandId: '59-cb-' + Date.now().toString(36) }),
    });
    console.log('confirmBusiness', cb.status, 'nextStage=' + (await cb.json()).nextStage);
    d = await getDetail(reqId);
  }

  // 5. design 版本确认 + confirm-design（自动→dev）
  {
    const dv = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    if (dv) {
      await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (dv.id || dv.public_id) + '/confirm', {
        method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '59-cf-design-' + Date.now().toString(36) }),
      });
      d = await getDetail(reqId);
    }
    const dv2 = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-design', {
      method: 'POST', headers: auth, body: JSON.stringify({ comment: '实施设计已确认（59）', advanceTo: 'dev', designVersionId: dv2?.id || dv2?.public_id, scope: { goal: '修复 add 实现并跑通测试', files: 'src/add.js, test/add.test.js', validation: 'node --test', exit: '汇报真实测试输出', rollback: 'git revert', capabilityIds: [] }, expectedRevision: d.revision, commandId: '59-cd-' + Date.now().toString(36) }),
    });
    const adj = await ad.json();
    console.log('confirmDesign', ad.status, 'nextStage=' + adj.nextStage);
    if (ad.status !== 200) throw new Error('CONFIRM_DESIGN_FAILED ' + JSON.stringify(adj).slice(0, 300));
    d = await getDetail(reqId);
    if (d.stage !== 'dev') throw new Error('NOT_IN_DEV ' + d.stage);
  }

  // 6. 搭授权工作区（缺陷项目）
  const wsRoot = path.join(REPO, '.local', 'ai-tools-remediation-20260916', 'CODEx_TEST_AI_FIX_20260916_' + randomUUID());
  const ws = path.join(wsRoot, 'workspace');
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'test'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src', 'add.js'), ADD_IMPL_BROKEN, { flag: 'wx' });
  fs.writeFileSync(path.join(ws, 'test', 'add.test.js'), TEST_IMPL, { flag: 'wx' });
  const testHash0 = sha(TEST_IMPL);
  const addHash0 = sha(ADD_IMPL_BROKEN);
  const execControl = require(path.join(REPO, 'server', 'src', 'agent', 'exec-control.js'));
  const baseline = execControl.baselineHash(execControl.scanWorkspace(ws));
  console.log('workspace ready', ws, 'addHash0=' + addHash0.slice(0, 10), 'testHash0=' + testHash0.slice(0, 10));

  // 7. 本地预验证：缺陷测试确实失败（红）
  let redExit = -1, redOut = '';
  try {
    execFileSync(NODE, ['--test'], { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
    redExit = 0;
  } catch (e) { redExit = e.status ?? -1; redOut = String(e.stderr || e.stdout || '').slice(0, 200); }
  console.log('pre-check 缺陷测试 exit=' + redExit, redExit !== 0 ? '(红，符合预期)' : '(未红！)');

  // 8. EXEC 真实作业（冻结计划：改 src/add.js + 跑 node --test）
  const control = {
    confirmed: true,
    mode: 'strict',
    allowedFiles: ['src/**', 'test/**'],
    allowedCommands: [['node', '--test']],
    maxFiles: 50,
    maxBytes: 2097152,
    validUntil: new Date(Date.now() + 240000).toISOString(),
    baselineHash: baseline,
  };
  const msg = await fetch(BASE + '/api/reqs/' + reqId + '/messages', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      content:
        '工作区是受控 EXEC 作业：最小 Node 项目。\n' +
        '- src/add.js 导出 add(a,b)，当前实现有缺陷（返回 a-b）。\n' +
        '- test/add.test.js 用 node:test 断言 add(1,2) === 3（当前会失败）。\n' +
        '请按冻结计划完成真实修复闭环：\n' +
        '1) 用 pfc_read_file 读取 src/add.js 与 test/add.test.js（读返回的 sha256 即后续写入的 expectedHash）；\n' +
        '2) 用 pfc_write_file 将 src/add.js 修正为正确实现（return a + b），expectedHash 用第 1 步读到的值；不得修改 test/add.test.js；\n' +
        '3) 用 codex_cli 执行命令向量 ["node","--test"] 运行测试，确认真实通过；\n' +
        '4) 汇报：改动文件清单、测试真实输出（通过用例数）、结论。若某步被受控拒绝，如实说明原因。',
      stage: 'dev',
      mode: 'real',
      tool: 'exec',
      workspace: ws,
      control,
      expectedRevision: d.revision,
      commandId: '59-msg-' + Date.now().toString(36),
    }),
  });
  const msgj = await msg.json();
  console.log('sendMessage', msg.status, JSON.stringify({ jobId: msgj.jobId, jobKind: msgj.jobKind, reply: msgj.reply?.id, err: msgj.error?.code || msgj.error?.message }).slice(0, 300));
  if (msg.status !== 200 && msg.status !== 201) throw new Error('SEND_FAILED ' + JSON.stringify(msgj).slice(0, 400));
  const jobId = msgj.jobId;
  const aiMessageId = msgj.reply?.id;

  // 9. 轮询（最长 300s）
  const deadline = Date.now() + 300000;
  let final = null;
  while (Date.now() < deadline) {
    await sleep(5000);
    const m = await fetch(BASE + '/api/reqs/' + reqId + '/messages?offset=0&limit=10', { headers: auth });
    const mj = await m.json();
    const list = mj.messages || mj.items || [];
    const ai = list.find((x) => x.id === aiMessageId) || [...list].reverse().find((x) => x.role === 'ai');
    if (ai && ai.status !== 'generating') { final = { msgStatus: ai.status, contentLen: (ai.content || '').length }; break; }
  }
  if (!final) { console.log('E2E_RESULT TIMEOUT'); process.exit(4); }

  // 10. 独立验证（不信任模型回写）
  const afterAdd = fs.existsSync(path.join(ws, 'src', 'add.js')) ? fs.readFileSync(path.join(ws, 'src', 'add.js'), 'utf8') : '';
  const afterTest = fs.existsSync(path.join(ws, 'test', 'add.test.js')) ? fs.readFileSync(path.join(ws, 'test', 'add.test.js'), 'utf8') : '';
  const addChanged = afterAdd !== ADD_IMPL_BROKEN;
  const addCorrect = /a\s*\+\s*b/.test(afterAdd) && !/a\s*-\s*b/.test(afterAdd);
  const testUntouched = sha(afterTest) === testHash0;
  let greenExit = -1, greenOut = '';
  try {
    execFileSync(NODE, ['--test'], { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
    greenExit = 0;
  } catch (e) { greenExit = e.status ?? -1; greenOut = String(e.stderr || e.stdout || '').slice(0, 300); }
  const verdict = {
    msgStatus: final.msgStatus,
    addChanged, addCorrect, testUntouched, greenExit,
  };
  console.log('VERIFY', JSON.stringify(verdict, null, 2));
  console.log('FIX_CONTENT', JSON.stringify(afterAdd));
  const ok = final.msgStatus === 'ok' && addChanged && addCorrect && testUntouched && greenExit === 0;
  console.log('FIX_LOOP_VERDICT', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 3);
}
main().catch((e) => { console.error('E2E_ERR', e.message); process.exit(1); });
