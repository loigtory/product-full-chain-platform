'use strict';
// 54 号 HTTP 验证前置：造 3 个需求（dev 全链路 / dev 无冻结兼容 / design 三阶段对齐）+ workspace
// 用法：node seed-54-http.cjs  输出 SEED_54_REQ_A/REQ_B/REQ_C/WS_A/WS_B/WS_C
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
(async () => {
  const out = {};
  for (const [key, stage] of [
    ['A', 'dev'],
    ['B', 'dev'],
    ['C', 'design'],
  ]) {
    const reqId = crypto.randomUUID();
    const publicId =
      'CODEx_TEST_54_' + key + '_' + crypto.randomUUID().slice(0, 8).toUpperCase();
    const now = new Date();
    await pool.query(
      `INSERT INTO "${SCHEMA}".reqs
        (id,tenant_id,public_id,name,goal,owner,stage,created_at,updated_at,revision,material_revision,artifact_business_epoch,artifact_design_epoch,verification_epoch,release_epoch)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,1,0,0,0,0,0)`,
      [reqId, TENANT, publicId, 'CODEx_TEST 54 ' + stage + ' 冻结执行链验证', '验证冻结计划派生执行约束', '陈立', stage, now],
    );
    const wsRoot = path.join(
      repo,
      '.local/ai-tools-host-exec-20260917',
      'CODEx_TEST_AI_HOST_20260917_' + crypto.randomUUID(),
      'workspace',
    );
    fs.mkdirSync(path.join(wsRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(wsRoot, 'src', 'app.js'), '// 54 baseline v1\n');
    fs.writeFileSync(path.join(wsRoot, 'package.json'), '{}\n');
    out[key] = { reqId, publicId, wsRoot };
    console.log('SEED_54_REQ_' + key + '=' + publicId);
    console.log('SEED_54_WS_' + key + '=' + wsRoot);
  }
  await pool.end();
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
