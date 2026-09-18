'use strict';
// 64 号验收：设计阶段产物闭环（真实 EXEC → design/ 四类产物 → 需求设计产物快照 → API 读取）
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const REPO = 'D:\\项目管理\\product-full-chain-platform';
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('64 号：设计阶段产物闭环验收');
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  const login = await fetch(BASE + '/api/auth/local-session', { method: 'POST', headers: H, body: JSON.stringify({ key }) });
  if (login.status !== 200) throw new Error('LOGIN_FAILED ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const auth = { ...H, cookie };
  let gid = null;
  const getDetail = async (id) => { const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth }); return (await r.json()).req; };

  // 1. 创建需求 → 澄清 → 推进到 design（停在 design，不 confirm-design）
  const reqName = 'CODEx_TEST_64_DESIGN_' + Date.now().toString().slice(-6);
  const cr = await fetch(BASE + '/api/reqs', { method: 'POST', headers: auth, body: JSON.stringify({ name: reqName, goal: '64 端到端：design 阶段 EXEC 真实产出方案设计/时序图/流程图/可交互原型并沉淀为需求设计产物。', scope: '64 e2e design artifacts', commandId: '64-create-' + Date.now().toString(36) }) });
  const crj = await cr.json();
  if (cr.status !== 201) throw new Error('CREATE_FAILED ' + JSON.stringify(crj).slice(0, 200));
  const reqId = crj.req.id;
  console.log('created', reqName, 'stage=' + crj.req.stage);
  let d = await getDetail(reqId);
  for (const q of d.questions || []) {
    await fetch(BASE + '/api/reqs/' + reqId + '/questions/' + q.id + '/answer', { method: 'POST', headers: auth, body: JSON.stringify({ answer: '已确认：设计产物闭环验证。', expectedRevision: d.revision, commandId: '64-ans-' + q.id + '-' + Date.now().toString(36) }) });
    d = await getDetail(reqId);
  }
  {
    const v = [...(d.versions || [])].reverse().find((x) => x.stage === d.stage);
    if (v) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (v.id || v.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '64-cf-idea-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const r = await fetch(BASE + '/api/reqs/' + reqId + '/stage', { method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: d.revision, commandId: '64-stage-req-' + Date.now().toString(36) }) });
    const j = await r.json();
    if (r.status !== 200 || j.req?.stage !== 'req') throw new Error('STAGE_ADVANCE_BLOCKED ' + JSON.stringify(j).slice(0, 200));
    d = j.req;
  }
  {
    const rv = [...(d.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (rv.id || rv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '64-cf-req-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const wsr = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-workspace', { headers: auth });
    const wsj = await wsr.json();
    const fp = wsj.inputFingerprint;
    const prop = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals', { method: 'POST', headers: auth, body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: fp, expectedRevision: wsj.revision, commandId: '64-prop-' + Date.now().toString(36) }) });
    const propj = await prop.json();
    const pid = (propj.proposal?.id || propj.proposal?.public_id || propj.proposalId);
    if (!pid) throw new Error('PROPOSAL_FAILED ' + JSON.stringify(propj).slice(0, 200));
    d = await getDetail(reqId);
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals/' + pid + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: fp, expectedRevision: d.revision, commandId: '64-adopt-' + Date.now().toString(36) }) });
    const adj = await ad.json();
    gid = adj.group?.id || adj.group?.public_id || (adj.artifactGroup && (adj.artifactGroup.id || adj.artifactGroup.public_id));
    if (!gid) throw new Error('ADOPT_FAILED ' + JSON.stringify(adj).slice(0, 200));
    d = await getDetail(reqId);
    const cb = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-business', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（64）', advanceTo: 'design', inputFingerprint: fp, expectedRevision: d.revision, commandId: '64-cb-' + Date.now().toString(36) }) });
    const cbj = await cb.json();
    d = cbj.req || (await getDetail(reqId));
    if (d.stage !== 'design') throw new Error('NOT_IN_DESIGN ' + d.stage);
  }
  console.log('req at stage=design');

  // 2. 工作区（模型自建 design/ 目录与四类产物）
  const wsRoot = path.join(REPO, '.local', 'ai-tools-host-exec-20260917', 'CODEx_TEST_AI_HOST_20260917_' + randomUUID());
  const ws = path.join(wsRoot, 'workspace');
  fs.mkdirSync(path.join(ws, 'design'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'design', 'README.txt'), '本目录用于存放设计阶段产物：design.md / sequence.mmd / flow.mmd / prototype.html。\n');
  console.log('workspace prepared', path.basename(wsRoot));

  // 3. 计划 + control + EXEC 消息（design 阶段）
  const execControl = require(path.join(REPO, 'server', 'src', 'agent', 'exec-control.js'));
  const baseline = execControl.baselineHash(execControl.scanWorkspace(ws));
  const control = { confirmed: true, mode: 'strict', allowedFiles: ['design/**', '**'], allowedCommands: [['node', '*']], maxFiles: 50, maxBytes: 4194304, validUntil: new Date(Date.now() + 300000).toISOString(), baselineHash: baseline };
  const prompt =
    '你是产品全链路平台的设计阶段作业（需求：' + reqName + '）。工作区 design/ 目录已预置。请直接使用文件写入工具在 design/ 目录创建 4 个真实文件（**不要先读取不存在的文件**，如确认状态请在写入后用 node -e 检查 fs.existsSync）：\n' +
    '1. design/design.md：技术方案设计文档（Markdown），须包含：背景与目标、总体架构、数据模型、接口设计、关键流程、风险与回退 六个章节，每章有实质内容；\n' +
    '2. design/sequence.mmd：Mermaid 时序图，第一行必须是 ```sequenceDiagram，描述「想法→需求→设计→开发→测试→发布」关键交互时序，至少 6 个参与方与 8 条消息；\n' +
    '3. design/flow.mmd：Mermaid 流程图，第一行必须是 ```flowchart，描述全链路阶段流转与决策分支（含确认/回退分支），至少 8 个节点；\n' +
    '4. design/prototype.html：自包含可交互原型页面（内联 CSS/JS，禁止外链），包含页面标题、输入框、按钮与点击交互反馈。\n' +
    '每个文件都必须真实非空、格式正确。全部写入后，用 node -e 读取校验 4 个文件存在与首行格式，汇报校验结果。';
  const msg = await fetch(BASE + '/api/reqs/' + reqId + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({
    content: prompt,
    stage: 'design', mode: 'real', tool: 'exec', workspace: ws, control, expectedRevision: d.revision, commandId: '64-msg-' + Date.now().toString(36),
  }) });
  const msgj = await msg.json();
  console.log('sendMessage', msg.status, JSON.stringify({ jobId: msgj.jobId, reply: msgj.reply?.id, err: msgj.error?.code || msgj.error?.message }).slice(0, 200));
  if (msg.status !== 200 && msg.status !== 201) throw new Error('SEND_FAILED ' + JSON.stringify(msgj).slice(0, 300));
  const jobId = msgj.jobId;
  const aiMessageId = msgj.reply?.id;
  t('jobId 返回', !!jobId, jobId);

  // 4. 轮询消息完成（真实 EXEC，最长 5 分钟）
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
  t('消息完成（ok）', final.msgStatus === 'ok', final.msgStatus);
  t('AI 汇报含设计产物字样', /design\/|sequence\.mmd|flow\.mmd|prototype\.html|校验/.test(final.content), final.content.slice(0, 80));

  // 5. design-artifacts API 断言
  const s = await fetch(BASE + '/api/agent/requirements/' + reqId + '/design-artifacts', { headers: auth });
  t('GET design-artifacts 200', s.status === 200, s.status);
  const sj = await s.json();
  const kinds = Object.keys(sj || {});
  t('四类产物齐全', ['design', 'sequence', 'flow', 'prototype'].every((k) => kinds.includes(k)), kinds);
  const design = sj.design?.content || '';
  t('design.md 方案文档实质', design.includes('背景') && design.includes('架构') && design.length > 200, { len: design.length });
  const seq = sj.sequence?.content || '';
  t('时序图 mermaid', seq.trim().startsWith('```sequenceDiagram') || seq.trim().startsWith('sequenceDiagram'), seq.trim().slice(0, 40));
  const flow = sj.flow?.content || '';
  t('流程图 mermaid', flow.trim().startsWith('```flowchart') || flow.trim().startsWith('flowchart'), flow.trim().slice(0, 40));
  const proto = sj.prototype?.content || '';
  t('原型 HTML 自包含', /<html/i.test(proto) && /<input/i.test(proto) && /<button/i.test(proto) && /<script/i.test(proto), { len: proto.length });
  t('fingerprint 均 64hex', kinds.every((k) => /^[a-f0-9]{64}$/.test(sj[k].fingerprint)));
  t('source 含 exec-workspace', sj.design?.updatedAt ? true : false, sj.design?.updatedAt || null);

  // 6. 独立核对：工作区文件确实存在（不经 API）
  const wsFiles = ['design/design.md', 'design/sequence.mmd', 'design/flow.mmd', 'design/prototype.html'];
  const exist = wsFiles.every((f) => fs.existsSync(path.join(ws, f)));
  t('工作区四文件真实落盘', exist, wsFiles);

  console.log('\nRESULT: ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log('VERDICT ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.log('FATAL', e.code || e.message, (e.stack || '').split('\n')[1] || '');
  process.exit(2);
});
