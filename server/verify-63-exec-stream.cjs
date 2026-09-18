'use strict';
// 63 号验收：EXEC 作业命令级输出流（真实作业 → ndjson 流采集 → API 轮询一致）
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const REPO = 'D:\\项目管理\\product-full-chain-platform';
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('63 号：EXEC 终端流验收');
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  const login = await fetch(BASE + '/api/auth/local-session', { method: 'POST', headers: H, body: JSON.stringify({ key }) });
  if (login.status !== 200) throw new Error('LOGIN_FAILED ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const auth = { ...H, cookie };
  let gid = null;
  const getDetail = async (id) => { const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth }); return (await r.json()).req; };

  // 1. 创建需求 → 澄清 → 推进到 dev
  const reqName = 'CODEx_TEST_63_STREAM_' + Date.now().toString().slice(-6);
  const cr = await fetch(BASE + '/api/reqs', { method: 'POST', headers: auth, body: JSON.stringify({ name: reqName, goal: '63 端到端：EXEC 作业命令级输出流采集与 API 回放。', scope: '63 e2e stream', commandId: '63-create-' + Date.now().toString(36) }) });
  const crj = await cr.json();
  if (cr.status !== 201) throw new Error('CREATE_FAILED ' + JSON.stringify(crj).slice(0, 200));
  const reqId = crj.req.id;
  console.log('created', reqName, 'stage=' + crj.req.stage);
  let d = await getDetail(reqId);
  for (const q of d.questions || []) {
    await fetch(BASE + '/api/reqs/' + reqId + '/questions/' + q.id + '/answer', { method: 'POST', headers: auth, body: JSON.stringify({ answer: '已确认：EXEC 输出流验证。', expectedRevision: d.revision, commandId: '63-ans-' + q.id + '-' + Date.now().toString(36) }) });
    d = await getDetail(reqId);
  }
  {
    const v = [...(d.versions || [])].reverse().find((x) => x.stage === d.stage);
    if (v) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (v.id || v.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '63-cf-idea-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const r = await fetch(BASE + '/api/reqs/' + reqId + '/stage', { method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: d.revision, commandId: '63-stage-req-' + Date.now().toString(36) }) });
    const j = await r.json();
    if (r.status !== 200 || j.req?.stage !== 'req') throw new Error('STAGE_ADVANCE_BLOCKED ' + JSON.stringify(j).slice(0, 200));
    d = j.req;
  }
  {
    const rv = [...(d.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (rv.id || rv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '63-cf-req-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    const wsr = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-workspace', { headers: auth });
    const wsj = await wsr.json();
    const fp = wsj.inputFingerprint;
    const prop = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals', { method: 'POST', headers: auth, body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: fp, expectedRevision: wsj.revision, commandId: '63-prop-' + Date.now().toString(36) }) });
    const propj = await prop.json();
    const pid = (propj.proposal?.id || propj.proposal?.public_id || propj.proposalId);
    if (!pid) throw new Error('PROPOSAL_FAILED ' + JSON.stringify(propj).slice(0, 200));
    d = await getDetail(reqId);
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals/' + pid + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: fp, expectedRevision: d.revision, commandId: '63-adopt-' + Date.now().toString(36) }) });
    const adj = await ad.json();
    gid = adj.group?.id || adj.group?.public_id || (adj.artifactGroup && (adj.artifactGroup.id || adj.artifactGroup.public_id));
    if (!gid) throw new Error('ADOPT_FAILED ' + JSON.stringify(adj).slice(0, 200));
    d = await getDetail(reqId);
    await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-business', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（63）', advanceTo: 'design', inputFingerprint: fp, expectedRevision: d.revision, commandId: '63-cb-' + Date.now().toString(36) }) });
    d = await getDetail(reqId);
  }
  {
    const dv = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    if (dv) { await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (dv.id || dv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '63-cf-design-' + Date.now().toString(36) }) }); d = await getDetail(reqId); }
    // 64/65 号设计产物门禁：confirm-design 前补齐四类产物
    const ART63 = {
      design: '# 方案设计\n\n## 背景与目标\n\n验证 EXEC 输出流采集。\n\n## 总体架构\n\n前端 + 服务端 + 执行器。',
      sequence: '```sequenceDiagram\nsequenceDiagram\n    PM->>Platform: 提交想法\n    Platform->>Agent: 指派作业\n```',
      flow: '```flowchart\nflowchart TD\n    A[提交想法] --> B[需求澄清]\n    B --> C[确认方案]\n```',
      prototype: '<!doctype html><html><head></head><body><input id="q" placeholder="提问" /><button onclick="alert(1)">提交</button></body></html>',
    };
    for (const k of ['design', 'sequence', 'flow', 'prototype']) {
      const r = await fetch(BASE + '/api/agent/requirements/' + reqId + '/design-artifacts', { method: 'PUT', headers: auth, body: JSON.stringify({ kind: k, name: '63-' + k, content: ART63[k] }) });
      if (r.status !== 200 && r.status !== 201) throw new Error('ARTIFACT_PUT_FAILED ' + k + ' ' + JSON.stringify(await r.json().catch(() => ({}))).slice(0, 120));
    }
    const dv2 = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-design', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '实施设计已确认（63）', advanceTo: 'dev', designVersionId: dv2?.id || dv2?.public_id, scope: { goal: '验证 EXEC 输出流采集', files: 'workspace/**', validation: 'node src/hello.cjs', exit: '汇报执行结果', rollback: 'git revert', capabilityIds: [] }, expectedRevision: d.revision, commandId: '63-cd-' + Date.now().toString(36) }) });
    const adj = await ad.json();
    if (ad.status !== 200) throw new Error('CONFIRM_DESIGN_FAILED ' + JSON.stringify(adj).slice(0, 200));
    d = await getDetail(reqId);
    if (d.stage !== 'dev') throw new Error('NOT_IN_DEV ' + d.stage);
  }

  // 2. 工作区（预置多行输出脚本）
  const wsRoot = path.join(REPO, '.local', 'ai-tools-host-exec-20260917', 'CODEx_TEST_AI_HOST_20260917_' + randomUUID());
  const ws = path.join(wsRoot, 'workspace');
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src', 'hello.cjs'), "console.log('line1 hello');\nconsole.log('line2 world');\nconsole.error('err-marker');\nprocess.exit(0);\n", { flag: 'wx' });
  console.log('workspace prepared', path.basename(wsRoot));

  // 3. 计划 + control + EXEC 消息
  const execControl = require(path.join(REPO, 'server', 'src', 'agent', 'exec-control.js'));
  const baseline = execControl.baselineHash(execControl.scanWorkspace(ws));
  const control = { confirmed: true, mode: 'strict', allowedFiles: ['**'], allowedCommands: [['node', 'src/hello.cjs']], maxFiles: 50, maxBytes: 2097152, validUntil: new Date(Date.now() + 240000).toISOString(), baselineHash: baseline };
  const msg = await fetch(BASE + '/api/reqs/' + reqId + '/messages', { method: 'POST', headers: auth, body: JSON.stringify({
    content: '工作区为受控 EXEC 作业。用 codex_cli 执行计划内命令向量 ["node","src/hello.cjs"]，汇报真实 stdout/stderr 与退出码（脚本会输出 line1 hello / line2 world / err-marker 三行后退出 0）。',
    stage: 'dev', mode: 'real', tool: 'exec', workspace: ws, control, expectedRevision: d.revision, commandId: '63-msg-' + Date.now().toString(36),
  }) });
  const msgj = await msg.json();
  console.log('sendMessage', msg.status, JSON.stringify({ jobId: msgj.jobId, reply: msgj.reply?.id, err: msgj.error?.code || msgj.error?.message }).slice(0, 200));
  if (msg.status !== 200 && msg.status !== 201) throw new Error('SEND_FAILED ' + JSON.stringify(msgj).slice(0, 300));
  const jobId = msgj.jobId;
  const aiMessageId = msgj.reply?.id;
  t('jobId 返回', !!jobId, jobId);

  // 4. 轮询消息完成
  const deadline = Date.now() + 240000;
  let final = null;
  while (Date.now() < deadline) {
    await sleep(4000);
    const m = await fetch(BASE + '/api/reqs/' + reqId + '/messages?offset=0&limit=10', { headers: auth });
    const mj = await m.json();
    const list = mj.messages || mj.items || [];
    const ai = list.find((x) => x.id === aiMessageId) || [...list].reverse().find((x) => x.role === 'ai');
    if (ai && ai.status !== 'generating') { final = { msgStatus: ai.status, content: ai.content || '' }; break; }
  }
  if (!final) { console.log('E2E TIMEOUT'); process.exit(4); }
  t('消息完成（ok）', final.msgStatus === 'ok', final.msgStatus);

  // 5. exec-stream API 断言
  const s = await fetch(BASE + '/api/agent/requirements/' + reqId + '/exec-stream?jobId=' + jobId, { headers: auth });
  t('GET exec-stream 200', s.status === 200, s.status);
  const sj = await s.json();
  const all = (sj.chunks || []).map((c) => c.text).join('');
  t('流块非空', (sj.chunks || []).length > 0, { chunks: sj.chunks?.length });
  t('stdout 多行完整', all.includes('line1 hello') && all.includes('line2 world'), { hasLine1: all.includes('line1 hello'), hasLine2: all.includes('line2 world') });
  t('stderr 采集', all.includes('err-marker'));
  t('exit 闭合', sj.closed === true && sj.exit?.exitCode === 0, sj.exit);

  // 6. 独立核对 ndjson 文件
  const streamFile = path.join(REPO, '.local', 'pfc-exec-streams', jobId + '.ndjson');
  const fileExists = fs.existsSync(streamFile);
  t('ndjson 文件落盘', fileExists, streamFile);
  if (fileExists) {
    const lines = fs.readFileSync(streamFile, 'utf8').split('\n').filter((x) => x.trim());
    const hasExit = lines.some((l) => l.includes('"type":"exit"'));
    const chunks = lines.filter((l) => l.includes('"type":"chunk"'));
    const seqOk = chunks.every((l, i) => { try { return JSON.parse(l).seq === i + 1; } catch { return false; } });
    t('exit 行落盘', hasExit);
    t('seq 连续', seqOk, { chunkLines: chunks.length });
  }

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  console.log('VERDICT', fail === 0 ? 'PASS' : 'FAIL');
  process.exit(fail ? 3 : 0);
}
main().catch((e) => { console.error('E2E_ERR', e.message); process.exit(1); });
