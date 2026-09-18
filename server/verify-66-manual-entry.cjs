'use strict';
// 66 号验收：设计产物人工补录入口（65 门禁兜底）
// 场景 A：创建需求推进 design（无产物）→ PUT 补录四产物（source=manual）→ GET 产物齐全 → confirm-design 放行 dev
// 场景 B：格式不达标补录（sequence 无 sequenceDiagram）→ PUT 成功但 confirm-design 仍被 65 门禁拦截（补录绕过不了门禁）
const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('pg');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const REPO = 'D:\\项目管理\\product-full-chain-platform';
const PG = 'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local';
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

async function main() {
  console.log('66 号：设计产物人工补录验收');
  const auth = await loginOnce();
  const getDetail = async (id) => { const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth }); return (await r.json()).req; };
  let gidA, gidB;

  // ---------- 场景 A：补录四产物 → 放行 ----------
  console.log('--- 场景 A：人工补录四产物放行 ---');
  const nameA = 'CODEx_TEST_66_MANUAL_' + Date.now().toString().slice(-6);
  const cr = await fetch(BASE + '/api/reqs', { method: 'POST', headers: auth, body: JSON.stringify({ name: nameA, goal: '66 A：人工补录四产物并放行。', scope: '66 e2e manual', commandId: '66a-create-' + Date.now().toString(36) }) });
  const reqA = (await cr.json()).req.id;
  let d = await getDetail(reqA);
  for (const q of d.questions || []) {
    await fetch(BASE + '/api/reqs/' + reqA + '/questions/' + q.id + '/answer', { method: 'POST', headers: auth, body: JSON.stringify({ answer: '已确认：人工补录验证。', expectedRevision: d.revision, commandId: '66a-ans-' + q.id + '-' + Date.now().toString(36) }) });
    d = await getDetail(reqA);
  }
  {
    const v = [...(d.versions || [])].reverse().find((x) => x.stage === d.stage);
    if (v) { await fetch(BASE + '/api/reqs/' + reqA + '/versions/' + (v.id || v.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '66a-cf-idea-' + Date.now().toString(36) }) }); d = await getDetail(reqA); }
    const r = await fetch(BASE + '/api/reqs/' + reqA + '/stage', { method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: d.revision, commandId: '66a-stage-req-' + Date.now().toString(36) }) });
    d = (await r.json()).req;
  }
  {
    const rv = [...(d.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) { await fetch(BASE + '/api/reqs/' + reqA + '/versions/' + (rv.id || rv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '66a-cf-req-' + Date.now().toString(36) }) }); d = await getDetail(reqA); }
    const wsj = await (await fetch(BASE + '/api/reqs/' + reqA + '/artifact-workspace', { headers: auth })).json();
    const prop = await fetch(BASE + '/api/reqs/' + reqA + '/artifact-proposals', { method: 'POST', headers: auth, body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: wsj.inputFingerprint, expectedRevision: wsj.revision, commandId: '66a-prop-' + Date.now().toString(36) }) });
    const pid = (await prop.json()).proposal?.id || (await prop.json()).proposal?.public_id;
    d = await getDetail(reqA);
    const adj = await (await fetch(BASE + '/api/reqs/' + reqA + '/artifact-proposals/' + pid + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: wsj.inputFingerprint, expectedRevision: d.revision, commandId: '66a-adopt-' + Date.now().toString(36) }) })).json();
    gidA = adj.group?.id || adj.group?.public_id;
    d = await getDetail(reqA);
    const cbj = await (await fetch(BASE + '/api/reqs/' + reqA + '/artifact-groups/' + gidA + '/confirm-business', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（66A）', advanceTo: 'design', inputFingerprint: wsj.inputFingerprint, expectedRevision: d.revision, commandId: '66a-cb-' + Date.now().toString(36) }) })).json();
    d = cbj.req || (await getDetail(reqA));
  }
  t('A：需求进入 design 且无产物', d.stage === 'design', d.stage);
  // 人工补录四产物（PUT，owner）
  for (const k of ['design', 'sequence', 'flow', 'prototype']) {
    const rr = await fetch(BASE + '/api/agent/requirements/' + reqA + '/design-artifacts', { method: 'PUT', headers: auth, body: JSON.stringify({ kind: k, name: '人工补录-' + k, content: ART[k] }) });
    const rj = await rr.json();
    t('A：PUT 补录 ' + k + ' 成功', rr.status === 200 && !!rj.fingerprint, { status: rr.status, fp: rj.fingerprint && rj.fingerprint.slice(0, 8) });
  }
  const ga = await (await fetch(BASE + '/api/agent/requirements/' + reqA + '/design-artifacts', { headers: auth })).json();
  t('A：GET 四产物齐全', ['design', 'sequence', 'flow', 'prototype'].every((k) => ga[k]), Object.keys(ga));
  const pgc = new Client({ connectionString: PG });
  await pgc.connect();
  const src = await pgc.query('SELECT kind, source FROM pfc_workbench.design_artifacts WHERE req_id=(SELECT id FROM pfc_workbench.reqs WHERE public_id=$1) ORDER BY kind', [reqA]);
  await pgc.end();
  t('A：source 全部 origin=manual', src.rows.length === 4 && src.rows.every((r) => r.source?.origin === 'manual'), src.rows.map((r) => r.source?.origin));
  // confirm-design 应放行
  const dv = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
  const cd = await fetch(BASE + '/api/reqs/' + reqA + '/artifact-groups/' + gidA + '/confirm-design', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '66A 人工补录产物齐套。', advanceTo: 'dev', designVersionId: dv?.id || dv?.public_id, scope: { goal: '66 补录放行', files: 'workspace/**', validation: 'true', exit: '无需执行', rollback: 'git revert', capabilityIds: [] }, expectedRevision: d.revision, commandId: '66a-cd-' + Date.now().toString(36) }) });
  const cdj = await cd.json();
  t('A：补录后 confirm-design 放行(200)', cd.status === 200, { status: cd.status, err: cdj.error?.code });
  t('A：推进到 dev', cdj.nextStage === 'dev', cdj.nextStage);

  // ---------- 场景 B：格式不达标补录 → 仍被门禁拦 ----------
  console.log('--- 场景 B：格式不达标补录仍被拦 ---');
  const nameB = 'CODEx_TEST_66_BADFMT_' + Date.now().toString().slice(-6);
  const crB = await fetch(BASE + '/api/reqs', { method: 'POST', headers: auth, body: JSON.stringify({ name: nameB, goal: '66 B：格式不达标补录仍被门禁拦。', scope: '66 e2e badfmt', commandId: '66b-create-' + Date.now().toString(36) }) });
  const reqB = (await crB.json()).req.id;
  let dB = await getDetail(reqB);
  for (const q of dB.questions || []) {
    await fetch(BASE + '/api/reqs/' + reqB + '/questions/' + q.id + '/answer', { method: 'POST', headers: auth, body: JSON.stringify({ answer: '已确认：坏格式补录验证。', expectedRevision: dB.revision, commandId: '66b-ans-' + q.id + '-' + Date.now().toString(36) }) });
    dB = await getDetail(reqB);
  }
  {
    const v = [...(dB.versions || [])].reverse().find((x) => x.stage === dB.stage);
    if (v) { await fetch(BASE + '/api/reqs/' + reqB + '/versions/' + (v.id || v.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: dB.revision, commandId: '66b-cf-idea-' + Date.now().toString(36) }) }); dB = await getDetail(reqB); }
    const r = await fetch(BASE + '/api/reqs/' + reqB + '/stage', { method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: dB.revision, commandId: '66b-stage-req-' + Date.now().toString(36) }) });
    dB = (await r.json()).req;
  }
  {
    const rv = [...(dB.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) { await fetch(BASE + '/api/reqs/' + reqB + '/versions/' + (rv.id || rv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: dB.revision, commandId: '66b-cf-req-' + Date.now().toString(36) }) }); dB = await getDetail(reqB); }
    const wsj = await (await fetch(BASE + '/api/reqs/' + reqB + '/artifact-workspace', { headers: auth })).json();
    const prop = await fetch(BASE + '/api/reqs/' + reqB + '/artifact-proposals', { method: 'POST', headers: auth, body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: wsj.inputFingerprint, expectedRevision: wsj.revision, commandId: '66b-prop-' + Date.now().toString(36) }) });
    const pidB = (await prop.json()).proposal?.id || (await prop.json()).proposal?.public_id;
    dB = await getDetail(reqB);
    const adjB = await (await fetch(BASE + '/api/reqs/' + reqB + '/artifact-proposals/' + pidB + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: wsj.inputFingerprint, expectedRevision: dB.revision, commandId: '66b-adopt-' + Date.now().toString(36) }) })).json();
    gidB = adjB.group?.id || adjB.group?.public_id;
    dB = await getDetail(reqB);
    const cbjB = await (await fetch(BASE + '/api/reqs/' + reqB + '/artifact-groups/' + gidB + '/confirm-business', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（66B）', advanceTo: 'design', inputFingerprint: wsj.inputFingerprint, expectedRevision: dB.revision, commandId: '66b-cb-' + Date.now().toString(36) }) })).json();
    dB = cbjB.req || (await getDetail(reqB));
  }
  t('B：需求进入 design', dB.stage === 'design', dB.stage);
  // 补录四产物，但 sequence 格式不达标（无 sequenceDiagram 标记）
  const badSeq = 'Participant A\nParticipant B\nA->>B: hello\n';
  const fixes = { design: ART.design, sequence: badSeq, flow: ART.flow, prototype: ART.prototype };
  for (const k of ['design', 'sequence', 'flow', 'prototype']) {
    await fetch(BASE + '/api/agent/requirements/' + reqB + '/design-artifacts', { method: 'PUT', headers: auth, body: JSON.stringify({ kind: k, name: '补录-' + k, content: fixes[k] }) });
  }
  // 补录接口允许保存（不校验格式——门禁兜底）
  const gb = await (await fetch(BASE + '/api/agent/requirements/' + reqB + '/design-artifacts', { headers: auth })).json();
  t('B：坏格式产物可保存（补录不代行门禁）', !!gb.sequence && !/sequenceDiagram/i.test(gb.sequence.content), !!gb.sequence);
  const dvB = [...(dB.versions || [])].reverse().find((x) => x.stage === 'design');
  const cdB = await fetch(BASE + '/api/reqs/' + reqB + '/artifact-groups/' + gidB + '/confirm-design', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '66B 坏格式补录，应被门禁拦。', advanceTo: 'dev', designVersionId: dvB?.id || dvB?.public_id, scope: { goal: '66 坏格式', files: 'workspace/**', validation: 'true', exit: '无需执行', rollback: 'git revert', capabilityIds: [] }, expectedRevision: dB.revision, commandId: '66b-cd-' + Date.now().toString(36) }) });
  const cdjB = await cdB.json();
  t('B：confirm-design 被门禁拦(409)', cdB.status === 409, cdB.status);
  t('B：错误码 DESIGN_ARTIFACTS_INCOMPLETE', cdjB.error?.code === 'DESIGN_ARTIFACTS_INCOMPLETE', cdjB.error?.code);
  t('B：错误信息指出时序图格式问题', (cdjB.error?.msg || '').includes('时序图缺 sequenceDiagram'), (cdjB.error?.msg || '').slice(0, 120));
  const dB2 = await getDetail(reqB);
  t('B：需求仍停 design', dB2.stage === 'design', dB2.stage);

  console.log('\nRESULT: ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log('VERDICT ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.log('FATAL', e.code || e.message, (e.stack || '').split('\n')[1] || '');
  process.exit(2);
});
