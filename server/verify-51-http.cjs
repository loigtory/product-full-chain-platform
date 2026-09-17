'use strict';
// 51 号：HTTP 层验证 decision approve 闭环（local-session + routes + 审计）
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:5188';
const reqId = 'CODEx_TEST_51_DEV_7FA3648E';
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
      [reqId],
    )
  ).rows[0];
  await pool.end();
  if (!row) throw new Error('no pending approval for ' + reqId);

  // 1) 解锁拿 cookie
  const login = await fetch(`${BASE}/api/auth/local-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ key: ACCESS_KEY }),
  });
  const setCookie = login.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  console.log('login HTTP', login.status, 'cookie=', cookie.slice(0, 24) + '…');
  if (login.status !== 200 || !cookie) throw new Error('login failed');

  const headers = {
    'Content-Type': 'application/json',
    Cookie: cookie,
    Origin: BASE,
  };

  // 2) decision deny（deny 不扩展冻结计划，无需 workspace）
  const res = await fetch(
    `${BASE}/api/agent/jobs/${row.job_id}/approvals/${row.approval_id}/decision`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'deny',
        scopeHash: row.scope_hash,
        expectedState: 'PENDING',
        commandId: 'verify-51-' + Date.now(),
      }),
    },
  );
  const body = await res.json();
  console.log('decision HTTP', res.status, 'state=', body?.approval?.state);
  if (res.status !== 200 || body?.approval?.state !== 'DENIED')
    throw new Error('decision failed: ' + JSON.stringify(body).slice(0, 300));

  // 3) tool-control 复核
  const tc = await (
    await fetch(`${BASE}/api/agent/requirements/${reqId}/tool-control`, { headers })
  ).json();
  const ap = (tc.approvals || []).find((a) => a.id === row.approval_id);
  console.log('tool-control state =', ap?.state, '| pending =', tc.approvals.filter((a) => a.state === 'PENDING').length);
  if (ap?.state !== 'DENIED') throw new Error('tool-control not DENIED');
  console.log('VERIFY 51 HTTP OK');
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
