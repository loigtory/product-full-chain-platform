'use strict';
// 快速验证：approve 无 workspace 应返回 409 WORKSPACE_NOT_AUTHORIZED（修复前是 503 STORAGE_UNAVAILABLE）
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:5188';
const ACCESS_KEY = 'Qo-xLAsgQ63Aamynqk7nWwfYfe63f_eZWRKWEYJu8Y0';
(async () => {
  const pool = new Pool({
    connectionString:
      'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
  });
  const row = (
    await pool.query(
      `SELECT j.id job_id,a.id approval_id,a.scope_hash FROM "pfc_workbench".agent_jobs j
       JOIN "pfc_workbench".agent_approvals a ON a.job_id=j.id
       JOIN "pfc_workbench".reqs r ON r.id=j.req_id
       WHERE r.public_id=$1 AND a.state='PENDING' ORDER BY a.created_at DESC LIMIT 1`,
      ['CODEx_TEST_51_DEV_3C4C7F13'],
    )
  ).rows[0];
  await pool.end();
  if (!row) throw new Error('no pending approval');
  const login = await fetch(`${BASE}/api/auth/local-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ key: ACCESS_KEY }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const res = await fetch(
    `${BASE}/api/agent/jobs/${row.job_id}/approvals/${row.approval_id}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE },
      body: JSON.stringify({
        decision: 'approve',
        scopeHash: row.scope_hash,
        expectedState: 'PENDING',
        commandId: 'verify-51-approve-' + Date.now(),
      }),
    },
  );
  const body = await res.json();
  console.log('approve-no-workspace HTTP', res.status, 'code=', body?.error?.code);
  if (res.status !== 409 || body?.error?.code !== 'WORKSPACE_NOT_AUTHORIZED')
    throw new Error('unexpected: ' + JSON.stringify(body).slice(0, 200));
  console.log('exec-control status fix OK');
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
