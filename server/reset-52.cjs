'use strict';
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({
    connectionString:
      'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
  });
  await pool.query('DROP TABLE IF EXISTS "pfc_workbench".stage_plans');
  await pool.query('DROP FUNCTION IF EXISTS "pfc_workbench".stage_plans_guard()');
  await pool.query(
    "DELETE FROM \"pfc_workbench\".schema_migrations WHERE version='008'",
  );
  await pool.query(
    "DELETE FROM \"pfc_workbench\".reqs WHERE public_id LIKE 'CODEx_TEST_52_%'",
  );
  console.log('008 + 52 test data cleaned');
  await pool.end();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
