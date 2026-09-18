'use strict';
// 54 号第 2 轮前置：全新 3 组需求 + workspace（避免触发器 23514 污染）
// 用法：node seed-54b-http.cjs  输出 SEED_54B_REQ_A/REQ_B/REQ_C/WS_A/WS_B/WS_C
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
  for (const [key, stage] of [
    ['A', 'dev'],
    ['B', 'dev'],
    ['C', 'design'],
  ]) {
    const reqId = crypto.randomUUID();
    const publicId =
      'CODEx_TEST_54B_' + key + '_' + crypto.randomUUID().slice(0, 8).toUpperCase();
    const now = new Date();
    await pool.query(
      `INSERT INTO "${SCHEMA}".reqs
        (id,tenant_id,public_id,name,goal,owner,stage,created_at,updated_at,revision,material_revision,artifact_business_epoch,artifact_design_epoch,verification_epoch,release_epoch)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,1,0,0,0,0,0)`,
      [reqId, TENANT, publicId, 'CODEx_TEST 54B ' + stage + ' 冻结执行链验证', '验证冻结计划派生执行约束', '陈立', stage, now],
    );
    const wsRoot = path.join(
      repo,
      '.local/ai-tools-host-exec-20260917',
      'CODEx_TEST_AI_HOST_20260917_' + crypto.randomUUID(),
      'workspace',
    );
    fs.mkdirSync(path.join(wsRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(wsRoot, 'src', 'app.js'), '// 54b baseline v1\n');
    fs.writeFileSync(path.join(wsRoot, 'package.json'), '{}\n');
    console.log('SEED_54B_REQ_' + key + '=' + publicId);
    console.log('SEED_54B_WS_' + key + '=' + wsRoot);
  }
  await pool.end();
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
