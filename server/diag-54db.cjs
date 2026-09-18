'use strict';
const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
});
(async () => {
  const rows = (
    await pool.query(
      `SELECT p.stage,p.state,p.created_at,p.baseline_hash,p.control->>'validUntil' valid_until,
              r.public_id,r.revision
       FROM "pfc_workbench".stage_plans p
       JOIN "pfc_workbench".reqs r ON r.id=p.req_id
       WHERE r.public_id IN ('CODEx_TEST_54_A_683D4855','CODEx_TEST_54_B_891C0329','CODEx_TEST_54_C_12DCEF84')
       ORDER BY p.created_at`,
    )
  ).rows;
  for (const row of rows) console.log(JSON.stringify(row));
  await pool.end();
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
