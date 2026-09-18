'use strict';
// 65 号验收：设计产物门禁——confirm-design 推进 dev 前校验四类产物齐套+格式；
// 场景 A（阻断）：无产物 confirm-design → 409 DESIGN_ARTIFACTS_INCOMPLETE
// 场景 B（放行）：已有完整产物（R-1082/CODEx_TEST_64_DESIGN_066577 四产物齐全）→ confirm-design → 200 推进 dev
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const REPO = 'D:\\项目管理\\product-full-chain-platform';
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loginOnce() {
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  for (let i = 0; i < 5; i++) {
    const login = await fetch(BASE + '/api/auth/local-session', { method: 'POST', headers: H, body: JSON.stringify({ key }) });
    if (login.status === 200) {
      const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
      return { ...H, cookie };
    }
    await sleep(15000);
  }
  throw new Error('LOGIN_RATE_LIMITED');
}

async function main() {
  console.log('65 号：设计产物门禁验收');
  const auth = await loginOnce();
  const getDetail = async (id) => { const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth }); const j = await r.json(); return j.req || j; };

  // ============ 场景 A：阻断（无产物 confirm-design） ============
  console.log('--- 场景 A：无产物阻断 ---');
  const reqNameA = 'CODEx_TEST_65_GATE_BLOCK_' + Date.now().toString().slice(-6);
  const crA = await fetch(BASE + '/api/reqs', { method: 'POST', headers: auth, body: JSON.stringify({ name: reqNameA, goal: '65 A：设计产物门禁阻断验证。', scope: '65 e2e gate block', commandId: '65a-create-' + Date.now().toString(36) }) });
  const crjA = await crA.json();
  if (crA.status !== 201) throw new Error('CREATE_A_FAILED ' + JSON.stringify(crjA).slice(0, 200));
  const reqA = crjA.req.id;
  let dA = await getDetail(reqA);
  for (const q of dA.questions || []) {
    await fetch(BASE + '/api/reqs/' + reqA + '/questions/' + q.id + '/answer', { method: 'POST', headers: auth, body: JSON.stringify({ answer: '已确认：门禁阻断验证。', expectedRevision: dA.revision, commandId: '65a-ans-' + q.id + '-' + Date.now().toString(36) }) });
    dA = await getDetail(reqA);
  }
  {
    const v = [...(dA.versions || [])].reverse().find((x) => x.stage === dA.stage);
    if (v) { await fetch(BASE + '/api/reqs/' + reqA + '/versions/' + (v.id || v.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: dA.revision, commandId: '65a-cf-idea-' + Date.now().toString(36) }) }); dA = await getDetail(reqA); }
    const r = await fetch(BASE + '/api/reqs/' + reqA + '/stage', { method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: dA.revision, commandId: '65a-stage-req-' + Date.now().toString(36) }) });
    const j = await r.json();
    if (r.status !== 200 || j.req?.stage !== 'req') throw new Error('STAGE_A_BLOCKED ' + JSON.stringify(j).slice(0, 200));
    dA = j.req;
  }
  {
    const rv = [...(dA.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) { await fetch(BASE + '/api/reqs/' + reqA + '/versions/' + (rv.id || rv.public_id) + '/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: dA.revision, commandId: '65a-cf-req-' + Date.now().toString(36) }) }); dA = await getDetail(reqA); }
    const wsr = await fetch(BASE + '/api/reqs/' + reqA + '/artifact-workspace', { headers: auth });
    const wsj = await wsr.json();
    const fp = wsj.inputFingerprint;
    const prop = await fetch(BASE + '/api/reqs/' + reqA + '/artifact-proposals', { method: 'POST', headers: auth, body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: fp, expectedRevision: wsj.revision, commandId: '65a-prop-' + Date.now().toString(36) }) });
    const propj = await prop.json();
    const pid = (propj.proposal?.id || propj.proposal?.public_id || propj.proposalId);
    if (!pid) throw new Error('PROPOSAL_A_FAILED ' + JSON.stringify(propj).slice(0, 200));
    dA = await getDetail(reqA);
    const ad = await fetch(BASE + '/api/reqs/' + reqA + '/artifact-proposals/' + pid + '/adopt', { method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: fp, expectedRevision: dA.revision, commandId: '65a-adopt-' + Date.now().toString(36) }) });
    const adj = await ad.json();
    const gidA = adj.group?.id || adj.group?.public_id || (adj.artifactGroup && (adj.artifactGroup.id || adj.artifactGroup.public_id));
    if (!gidA) throw new Error('ADOPT_A_FAILED ' + JSON.stringify(adj).slice(0, 200));
    dA = await getDetail(reqA);
    const cb = await fetch(BASE + '/api/reqs/' + reqA + '/artifact-groups/' + gidA + '/confirm-business', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（65A）', advanceTo: 'design', inputFingerprint: fp, expectedRevision: dA.revision, commandId: '65a-cb-' + Date.now().toString(36) }) });
    const cbj = await cb.json();
    dA = cbj.req || (await getDetail(reqA));
    if (dA.stage !== 'design') throw new Error('A_NOT_IN_DESIGN ' + dA.stage);
    // 直接 confirm-design（无设计产物）
    const dvA = [...(dA.versions || [])].reverse().find((x) => x.stage === 'design');
    const cdA = await fetch(BASE + '/api/reqs/' + reqA + '/artifact-groups/' + gidA + '/confirm-design', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '65A 无产物确认（应被阻断）', advanceTo: 'dev', designVersionId: dvA?.id || dvA?.public_id, scope: { goal: '门禁阻断验证', files: 'workspace/**', validation: 'true', exit: '无需执行', rollback: 'git revert', capabilityIds: [] }, expectedRevision: dA.revision, commandId: '65a-cd-' + Date.now().toString(36) }) });
    const cdj = await cdA.json();
    t('A：无产物 confirm-design 被阻断(409)', cdA.status === 409, cdA.status);
    t('A：错误码 DESIGN_ARTIFACTS_INCOMPLETE', cdj.error?.code === 'DESIGN_ARTIFACTS_INCOMPLETE', cdj.error?.code);
    t('A：错误信息列出缺失产物', (cdj.error?.msg || '').includes('缺 design') && (cdj.error?.msg || '').includes('缺 prototype'), (cdj.error?.msg || '').slice(0, 160));
    const dA2 = await getDetail(reqA);
    t('A：需求仍停在 design', dA2.stage === 'design', dA2.stage);
  }

  // ============ 场景 B：放行（R-1082 已有完整四产物） ============
  console.log('--- 场景 B：完整产物放行（R-1082） ---');
  const d = await getDetail('R-1082');
  t('B：R-1082 在设计阶段', d.stage === 'design', d.stage);
  // 从库取 artifact group 与 design 版本（detail 接口不返回 confirmation/group 明细）
  const { Client } = require('pg');
  const pgc = new Client({ connectionString: 'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local' });
  await pgc.connect();
  const gr = await pgc.query('SELECT public_id FROM pfc_workbench.artifact_groups WHERE req_id=(SELECT id FROM pfc_workbench.reqs WHERE public_id=$1) ORDER BY created_at DESC LIMIT 1', ['R-1082']);
  const vr = await pgc.query('SELECT public_id FROM pfc_workbench.req_versions WHERE req_id=(SELECT id FROM pfc_workbench.reqs WHERE public_id=$1) AND stage=$2 AND stale=false ORDER BY version DESC LIMIT 1', ['R-1082', 'design']);
  const cf = await pgc.query("SELECT public_id FROM pfc_workbench.artifact_confirmations WHERE req_id=(SELECT id FROM pfc_workbench.reqs WHERE public_id=$1) AND kind='BUSINESS' ORDER BY created_at DESC LIMIT 1", ['R-1082']);
  await pgc.end();
  const gidB = gr.rows[0]?.public_id;
  const dvB = vr.rows[0];
  const pidB = cf.rows[0]?.public_id;
  t('B：存在业务确认与设计版本', !!pidB && !!dvB, { pidB, gidB, dvB: dvB?.public_id });
  const cdB = await fetch(BASE + '/api/reqs/R-1082/artifact-groups/' + gidB + '/confirm-design', { method: 'POST', headers: auth, body: JSON.stringify({ comment: '65B 门禁放行：四产物齐套格式达标。', advanceTo: 'dev', designVersionId: dvB.public_id, scope: { goal: '65 门禁放行验证', files: 'workspace/**', validation: 'true', exit: '无需执行', rollback: 'git revert', capabilityIds: [] }, expectedRevision: d.revision, commandId: '65b-cd-' + Date.now().toString(36) }) });
  const cdjB = await cdB.json();
  t('B：confirm-design 放行(200)', cdB.status === 200, { status: cdB.status, err: cdjB.error?.code });
  t('B：推进到 dev', cdjB.nextStage === 'dev' || (await getDetail('R-1082')).stage === 'dev', cdjB.nextStage);

  console.log('\nRESULT: ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log('VERDICT ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.log('FATAL', e.code || e.message, (e.stack || '').split('\n')[1] || '');
  process.exit(2);
});
