'use strict';
// 54 号诊断：单独复现 C(design) freeze 503（干净服务状态）
const ACCESS_KEY = 'Qo-xLAsgQ63Aamynqk7nWwfYfe63f_eZWRKWEYJu8Y0';
const ORIGIN = 'http://127.0.0.1:5188';
const BASE = 'http://127.0.0.1:5188';
const reqC = 'CODEx_TEST_54_C_12DCEF84';
const wsC =
  'D:\\项目管理\\product-full-chain-platform\\.local\\ai-tools-host-exec-20260917\\CODEx_TEST_AI_HOST_20260917_db12639e-b8b7-4d65-942e-32e714e42f58\\workspace';
(async () => {
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ key: ACCESS_KEY }),
  });
  console.log('login', login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const headers = {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    Cookie: cookie,
  };
  let r = await fetch(`${BASE}/api/agent/requirements/${reqC}/stage-plan?stage=design`, { headers });
  console.log('GET stage-plan', r.status, (await r.text()).slice(0, 200));
  r = await fetch(`${BASE}/api/agent/requirements/${reqC}/stage-plan/freeze`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      stage: 'design',
      workspace: wsC,
      control: {
        mode: 'strict',
        allowedFiles: ['docs/**', '*.md'],
        allowedCommands: [['node', '--version']],
        maxFiles: 5,
        maxBytes: 1048576,
        validUntil: new Date(Date.now() + 2 * 3600000).toISOString(),
      },
    }),
  });
  console.log('POST freeze', r.status, (await r.text()).slice(0, 300));
})().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
