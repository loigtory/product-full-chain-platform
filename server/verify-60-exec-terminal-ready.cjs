'use strict';
// 60 号验收：zed/vscode 终端 READY（受控命令执行语义）+ 真实热插拔切换
//  A. 静态：registry READY / 别名注入 / approval terminal 分支映射
//  B. E2E：dev 阶段热插拔切换到 vscode_terminal → EXEC 真实作业 → 计划内命令(node --version)真实执行回写 → 恢复配置
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = 'D:\\项目管理\\product-full-chain-platform';

let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); };

async function main() {
  // ===== A. 静态断言 =====
  console.log('A. registry / approval 映射');
  const registry = require(path.join(REPO, 'server', 'src', 'agent', 'host-tools-registry.js'));
  t('zed READY', registry.statusOf('zed') === 'READY');
  t('vscode READY', registry.statusOf('vscode') === 'READY');
  const defs = registry.resolveHostTools(['zed', 'vscode', 'vs-code', 'codex-cli']);
  t('别名注入 zed_terminal/vscode_terminal/codex_cli=3', defs.length === 3 && ['zed_terminal', 'vscode_terminal', 'codex_cli'].every((n) => defs.some((d) => d.name === n)), defs.map((d) => d.name));
  const zedDef = defs.find((d) => d.name === 'zed_terminal');
  t('zed schema 带 command', zedDef.inputSchema.required?.[0] === 'command');
  const approvalSrc = fs.readFileSync(path.join(REPO, 'server', 'src', 'agent', 'approval-service.js'), 'utf8');
  t('approval terminal 分支含 zed/vscode', /zed_terminal:\s*'terminal'/.test(approvalSrc) && /vscode_terminal:\s*'terminal'/.test(approvalSrc));

  // ===== B. E2E：热插拔切换 vscode 终端并真实执行 =====
  console.log('B. 热插拔 E2E（dev 切 vscode_terminal）');
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  const login = await fetch(BASE + '/api/auth/local-session', { method: 'POST', headers: H, body: JSON.stringify({ key }) });
  if (login.status !== 200) throw new Error('LOGIN_FAILED ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const auth = { ...H, cookie };
  let gid = null;
  const getDetail = async (id) => { const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth }); return (await r.json()).req; };

  // 1. 热插拔：dev 阶段启用 vscode、停用 codex-cli（模拟页面切换终端来源）
  const putCap = await fetch(BASE + '/api/agent/stage-capabilities/dev', {
    method: 'PUT', headers: auth,
    body: JSON.stringify({ entries: [
      { kind: 'tool', name: 'vscode', source: 'local', description: 'VSCode 终端（受控命令执行）', priority: 5, enabled: true },
      { kind: 'tool', name: 'codex-cli', source: 'local', description: 'codex CLI 会话', priority: 4, enabled: false },
    ] }),
  });
  console.log('cap-switch vscode=on codex-cli=off', putCap.status);
  if (putCap.status !== 200) throw new Error('CAP_SWITCH_FAILED ' + (await putCap.text()).slice(0, 200));

  // 2. 创建需求 → 澄清 → 推进到 dev（复用 58 流程）
  const stamp = Date.now().toString().slice(-6);
  const reqName = 'CODEx_TEST_60_VSC_' + stamp;
  const cr = await fetch(BASE + '/api/reqs', { method: 'POST', headers: auth, body: JSON.stringify({ name: reqName, goal: '60 端到端：dev 阶段热插拔切换 vscode 终端并真实执行计划内命令。', scope: '60 e2e vsc', commandId: '60-create-' + Date.now().toString(36) }) });
  const crj = await cr.json();
  if (cr.status !== 201) throw new Error('CREATE_FAILED ' + JSON.stringify(crj).slice(0, 200));
  const reqId = crj.req.id;
  console.log('created', reqName, 'stage=' + crj.req.stage);
  let d = await getDetail(reqId);
  for (const q of d.questions || []) {
    await fetch(BASE + '/api/reqs/' + reqId + '/questions/' + q.id + '/answer', { method: 'POST', headers: auth, body: JSON.stringify({ answer: '已确认：vscode 终端热插拔验证。', expectedRevision: d.revision, commandId: '60-ans-' + q.id + '-' + Date.now().toString(36) }) });
    d = await getDetail(reqId);
  }
  {
    const v = [...(d.versions || [])].reverse().find((x) => x.stage === d.stage);
    if (v) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (v.id || v.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '60-cf-idea-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const r = await fetch(BASE + '/api/reqs/' + reqId + '/stage', { method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: d.revision, commandId: '60-stage-req-' + Date.now().toString(36) }) });
    const j = await r.json();
    if (r.status !== 200 || j.req?.stage !== 'req') throw new Error('STAGE_ADVANCE_BLOCKED ' + JSON.stringify(j).slice(0, 200));
    d = j.req;
  }
  {
    const rv = [...(d.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (rv.id || rv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '60-cf-req-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const wsr = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-workspace', { headers: auth });
    const wsj = await wsr.json();
    const fp = wsj.inputFingerprint;
    const prop = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals', { method: 'POST', headers: auth, body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: fp, expectedRevision: wsj.revision, commandId: '60-prop-' + Date.now().toString(36) }) });
    const propj = await prop.json();
    const pid = (propj.proposal?.id || propj.proposal?.public_id || propj.proposalId);
    if (!pid) throw new Error('PROPOSAL_FAILED ' + JSON.stringify(propj).slice(0, 200));
    d = await getDetail(reqId);
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals/' + pid + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: fp, expectedRevision: d.revision, commandId: '60-adopt-' + Date.now().toString(36) }) });
    const adj = await ad.json();
    gid = adj.group?.id || adj.group?.public_id || (adj.artifactGroup && (adj.artifactGroup.id || adj.artifactGroup.public_id));
    if (!gid) throw new Error('ADOPT_FAILED ' + JSON.stringify(adj).slice(0, 200));
    d = await getDetail(reqId);
    await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-business', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（60）', advanceTo: 'design', inputFingerprint: fp, expectedRevision: d.revision, commandId: '60-cb-' + Date.now().toString(36) }) });
    d = await getDetail(reqId);
  }
  {
    const dv = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    if (dv) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (dv.id || dv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '60-cf-design-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const dv2 = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-design', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '实施设计已确认（60）', advanceTo: 'dev', designVersionId: dv2?.id || dv2?.public_id, scope: { goal: '验证 vscode 终端执行 node --version', files: 'workspace/**', validation: 'node --version', exit: '汇报执行结果', rollback: 'git revert', capabilityIds: [] }, expectedRevision: d.revision, commandId: '60-cd-' + Date.now().toString(36) }) });
    const adj = await ad.json();
    if (ad.status !== 200) throw new Error('CONFIRM_DESIGN_FAILED ' + JSON.stringify(adj).slice(0, 200));
    d = await getDetail(reqId);
    if (d.stage !== 'dev') throw new Error('NOT_IN_DEV ' + d.stage);
  }

  // 3. 工作区 + 计划（node --version 真实执行）
  const wsRoot = path.join(REPO, '.local', 'ai-tools-remediation-20260916', 'CODEx_TEST_AI_FIX_20260916_' + randomUUID());
  const ws = path.join(wsRoot, 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'sample.txt'), '60 vsc terminal\n', { flag: 'wx' });
  const execControl = require(path.join(REPO, 'server', 'src', 'agent', 'exec-control.js'));
  const baseline = execControl.baselineHash(execControl.scanWorkspace(ws));
  const control = { confirmed: true, mode: 'strict', allowedFiles: ['**'], allowedCommands: [['node', '--version']], maxFiles: 50, maxBytes: 2097152, validUntil: new Date(Date.now() + 240000).toISOString(), baselineHash: baseline };
  const msg = await fetch(BASE + '/api/reqs/' + reqId + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({ content: '工作区为受控 EXEC 作业。请用当前已注入的 VSCode 终端工具（vscode_terminal）执行计划内命令向量 ["node","--version"]，并汇报真实输出（版本号）。', stage: 'dev', mode: 'real', tool: 'exec', workspace: ws, control, expectedRevision: d.revision, commandId: '60-msg-' + Date.now().toString(36) }) });
  const msgj = await msg.json();
  console.log('sendMessage', msg.status, JSON.stringify({ jobId: msgj.jobId, reply: msgj.reply?.id, err: msgj.error?.code || msgj.error?.message }).slice(0, 200));
  if (msg.status !== 200 && msg.status !== 201) throw new Error('SEND_FAILED ' + JSON.stringify(msgj).slice(0, 300));
  const aiMessageId = msgj.reply?.id;

  // 4. 轮询
  const deadline = Date.now() + 240000;
  let final = null;
  while (Date.now() < deadline) {
    await sleep(5000);
    const m = await fetch(BASE + '/api/reqs/' + reqId + '/messages?offset=0&limit=10', { headers: auth });
    const mj = await m.json();
    const list = mj.messages || mj.items || [];
    const ai = list.find((x) => x.id === aiMessageId) || [...list].reverse().find((x) => x.role === 'ai');
    if (ai && ai.status !== 'generating') { final = { msgStatus: ai.status, contentLen: (ai.content || '').length, content: ai.content || '' }; break; }
  }
  if (!final) { console.log('E2E TIMEOUT'); process.exit(4); }
  t('AI 消息回写 ok', final.msgStatus === 'ok');
  t('回写含真实 node 版本', /v\d+\.\d+\.\d+/.test(final.content), final.content.slice(0, 200));

  // 5. 恢复配置（codex-cli 恢复启用、vscode 停用——回到 59 定稿默认）
  const restore = await fetch(BASE + '/api/agent/stage-capabilities/dev', {
    method: 'PUT', headers: auth,
    body: JSON.stringify({ entries: [
      { kind: 'tool', name: 'vscode', source: 'local', description: 'VSCode 终端（受控命令执行）', priority: 5, enabled: false },
      { kind: 'tool', name: 'codex-cli', source: 'local', description: 'codex CLI 会话', priority: 4, enabled: true },
    ] }),
  });
  console.log('cap-restore codex-cli=on vscode=off', restore.status);

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  console.log('VERDICT', fail === 0 ? 'PASS' : 'FAIL');
  process.exit(fail ? 3 : 0);
}
main().catch((e) => { console.error('E2E_ERR', e.message); process.exit(1); });
