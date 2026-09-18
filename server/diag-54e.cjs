const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local' });
(async () => {
  const rows = (await pool.query(`SELECT p.stage,p.state,p.req_id,r.public_id,p.created_at FROM "pfc_workbench".stage_plans p JOIN "pfc_workbench".reqs r ON r.id=p.req_id WHERE r.public_id IN ('CODEx_TEST_54B_A_8E4BB048','CODEx_TEST_54B_C_4FE6B329') ORDER BY p.created_at`)).rows;
  for (const x of rows) console.log(JSON.stringify(x));
  const jobs = (await pool.query(`SELECT r.public_id, j.kind, j.input->>'stage' stage, j.input->'control'->>'approvalSource' src, j.created_at FROM "pfc_workbench".agent_jobs j JOIN "pfc_workbench".reqs r ON r.id=j.req_id WHERE r.public_id IN ('CODEx_TEST_54B_A_8E4BB048','CODEx_TEST_54B_C_4FE6B329') AND j.kind='EXECUTE' ORDER BY j.created_at DESC`)).rows;
  for (const x of jobs) console.log(JSON.stringify(x));
  await pool.end();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });