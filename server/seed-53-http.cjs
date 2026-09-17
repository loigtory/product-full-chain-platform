'use strict';
// 53 号多阶段验证前置：造 design 阶段需求 + 授权 workspace（design 产物目录）
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
const STAGE = process.argv[2] || 'design';
(async () => {
  const reqId = crypto.randomUUID();
  const publicId =
    'CODEx_TEST_53_' + STAGE.toUpperCase() + '_' + crypto.randomUUID().slice(0, 8).toUpperCase();
  const now = new Date();
  await pool.query(
    `INSERT INTO "${SCHEMA}".reqs
      (id,tenant_id,public_id,name,goal,owner,stage,created_at,updated_at,revision,material_revision,artifact_business_epoch,artifact_design_epoch,verification_epoch,release_epoch)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,1,0,0,0,0,0)`,
    [reqId, TENANT, publicId, 'CODEx_TEST 53 多阶段验证', '验证 stage-plan 多阶段闭环', '陈立', STAGE, now],
  );
  const wsRoot = path.join(
    repo,
    '.local/ai-tools-host-exec-20260917',
    'CODEx_TEST_AI_HOST_20260917_' + crypto.randomUUID(),
    'workspace',
  );
  if (STAGE === 'design') {
    fs.mkdirSync(path.join(wsRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(wsRoot, 'docs', 'design.md'), '# design baseline v1\n');
  } else {
    fs.mkdirSync(path.join(wsRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(wsRoot, 'src', 'app.js'), '// baseline v1\n');
    fs.writeFileSync(path.join(wsRoot, 'package.json'), '{}\n');
  }
  await pool.end();
  console.log('SEED_53_REQ=' + publicId);
  console.log('SEED_53_WS=' + wsRoot);
  console.log('SEED_53_STAGE=' + STAGE);
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
