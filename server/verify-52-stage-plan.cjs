'use strict';
// 52 号：stage-plan 服务层集成测试（freeze → review → revoke 全链路 + 违规路径）
const { Pool } = require('pg');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const repo = 'D:/项目管理/product-full-chain-platform';
const pool = new Pool({
  connectionString:
    'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
});
const SCHEMA = 'pfc_workbench';
const TENANT = 'a8dc197a-8b20-4831-ad93-c7d20ae77050';
const OWNER = '4e40d7a9-ce61-4380-bd2f-1ce1fb46b409';
const db = { schema: SCHEMA, pool, targetVersion: '008', assertScope() {} };
const ctx = { tenantId: TENANT, role: 'owner', actor: '陈立', memberId: OWNER };
const stagePlan = require('./src/agent/stage-plan');

let pass = 0,
  fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
(async () => {
  const now = new Date();
  const reqId = crypto.randomUUID();
  const publicId = 'CODEx_TEST_52_PLAN_' + crypto.randomUUID().slice(0, 8).toUpperCase();
  await pool.query(
    `INSERT INTO "${SCHEMA}".reqs
      (id,tenant_id,public_id,name,goal,owner,stage,created_at,updated_at,revision,material_revision,artifact_business_epoch,artifact_design_epoch,verification_epoch,release_epoch)
     VALUES($1,$2,$3,$4,$5,$6,'dev',$7,$7,1,0,0,0,0,0)`,
    [reqId, TENANT, publicId, 'CODEx_TEST 52 阶段基线冻结验证', '验证 freeze/review/revoke 闭环', '陈立', now],
  );
  const reqRow = (
    await pool.query(`SELECT * FROM "${SCHEMA}".reqs WHERE id=$1`, [reqId])
  ).rows[0];

  // 1) 造授权 workspace
  const wsRoot = path.join(
    repo,
    '.local/ai-tools-host-exec-20260917',
    'CODEx_TEST_AI_HOST_20260917_' + crypto.randomUUID(),
    'workspace',
  );
  fs.mkdirSync(path.join(wsRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(wsRoot, 'src', 'app.js'), '// baseline v1\n');
  fs.writeFileSync(path.join(wsRoot, 'package.json'), '{}\n');

  const control = {
    mode: 'strict',
    allowedFiles: ['src/**', 'package.json'],
    allowedCommands: [['node', '--version']],
    maxFiles: 5,
    maxBytes: 1048576,
    validUntil: new Date(Date.now() + 2 * 3600000).toISOString(),
  };

  // 2) freeze
  let frozen;
  try {
    frozen = await stagePlan.freeze(db, ctx, reqRow, {
      stage: 'dev',
      workspace: wsRoot,
      control,
    });
    check('freeze frozen', frozen.state === 'frozen' && /^[a-f0-9]{64}$/.test(frozen.baselineHash), frozen);
    check('freeze fileCount', frozen.fileCount === 2, frozen.fileCount);
  } catch (e) {
    check('freeze frozen', false, { code: e.code, msg: e.message });
  }

  // 3) get
  try {
    const got = await stagePlan.get(db, ctx, reqRow, 'dev');
    check('get frozen', got.state === 'frozen' && got.fileCount === 2, got);
  } catch (e) {
    check('get frozen', false, { code: e.code });
  }

  // 4) 违规路径：新增计划外文件 → review violates=true → revoke 拒绝
  try {
    fs.writeFileSync(path.join(wsRoot, 'other.txt'), 'leak\n');
    try {
    const diff = await stagePlan.review(db, ctx, reqRow, 'dev');
    check('review violates on out-of-scope', diff.violates === true && diff.outOfScope.includes('other.txt'), diff);
    await stagePlan
      .revoke(db, ctx, reqRow, 'dev')
      .then(() => check('revoke rejected on violates', false))
      .catch((e) => check('revoke rejected on violates', e.code === 'STAGE_REVIEW_VIOLATIONS', e.code));
    } finally { fs.unlinkSync(path.join(wsRoot, 'other.txt')); }
  } catch (e) {
    check('review/revoke violate path', false, { code: e.code, msg: e.message });
  }

  // 5) 清场 review → revoke 成功
  try {
    const diff = await stagePlan.review(db, ctx, reqRow, 'dev');
    check('review clean', diff.violates === false && diff.totalFiles === 0, diff);
    const rv = await stagePlan.revoke(db, ctx, reqRow, 'dev');
    check('revoke succeeded', rv.state === 'revoked', rv);
    const got = await stagePlan.get(db, ctx, reqRow, 'dev');
    check('get revoked', got.state === 'revoked', got);
  } catch (e) {
    check('clean review/revoke', false, { code: e.code, msg: e.message });
  }

  // 6) revoked 后不可再 revoke
  try {
    await stagePlan
      .revoke(db, ctx, reqRow, 'dev')
      .then(() => check('revoke after terminal rejected', false))
      .catch((e) => check('revoke after terminal rejected', e.code === 'PLAN_NOT_FROZEN', e.code));
  } catch (e) {
    check('revoke after terminal rejected', false, { code: e.code });
  }

  // 7) 重新 freeze（upsert 覆盖）→ 幂等
  try {
    const f2 = await stagePlan.freeze(db, ctx, reqRow, {
      stage: 'dev',
      workspace: wsRoot,
      control: { ...control, allowedCommands: [['npm', 'test']] },
    });
    check('refreeze upsert', f2.state === 'frozen', f2);
  } catch (e) {
    check('refreeze upsert', false, { code: e.code });
  }

  // 8) 非 owner（role=member）freeze 拒绝
  try {
    await stagePlan
      .freeze(db, { tenantId: TENANT, role: 'member', actor: '成员', memberId: OWNER }, reqRow, {
        stage: 'dev',
        workspace: wsRoot,
        control,
      })
      .then(() => check('non-owner freeze rejected', false))
      .catch((e) => check('non-owner freeze rejected', e.code === 'FORBIDDEN', e.code));
  } catch (e) {
    check('non-owner freeze rejected', false, { code: e.code });
  }

  console.log('---');
  console.log('RESULT', pass, 'PASS /', fail, 'FAIL');
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
