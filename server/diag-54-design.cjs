'use strict';
// 54 号诊断：直调 stage-plan.freeze（design 阶段）拿真实堆栈
const { Pool } = require('pg');
const path = require('node:path');
const pool = new Pool({
  connectionString:
    'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
});
const SCHEMA = 'pfc_workbench';
const TENANT = 'a8dc197a-8b20-4831-ad93-c7d20ae77050';
const OWNER = '4e40d7a9-ce61-4380-bd2f-1ce1fb46b409';
const ctx = { tenantId: TENANT, role: 'owner', actor: '陈立', memberId: OWNER };
const db = { schema: SCHEMA, pool, targetVersion: '008' };
(async () => {
  const reqRow = (
    await pool.query(
      `SELECT * FROM "${SCHEMA}".reqs WHERE public_id=$1`,
      ['CODEx_TEST_54_C_12DCEF84'],
    )
  ).rows[0];
  if (!reqRow) throw new Error('C req not found');
  console.log('C stage =', reqRow.stage);
  const ws = 'D:/项目管理/product-full-chain-platform/.local/ai-tools-host-exec-20260917/CODEx_TEST_AI_HOST_20260917_db12639e-b8b7-4d65-942e-32e714e42f58/workspace';
  try {
    const plan = await require('./src/agent/stage-plan').freeze(db, ctx, reqRow, {
      stage: 'design',
      workspace: ws,
      control: {
        mode: 'strict',
        allowedFiles: ['docs/**', '*.md'],
        allowedCommands: [['node', '--version']],
        maxFiles: 5,
        maxBytes: 1048576,
        validUntil: new Date(Date.now() + 2 * 3600000).toISOString(),
      },
    });
    console.log('freeze OK', JSON.stringify(plan).slice(0, 300));
  } catch (e) {
    console.log('ERR', e.code || '', e.status || '', e.message);
    console.log(e.stack);
  }
  await pool.end();
})().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
