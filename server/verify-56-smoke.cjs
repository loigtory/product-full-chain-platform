// 56 号冒烟：5188 重启后 API 可用性（登录 + 核心接口）
'use strict';
const BASE = 'http://127.0.0.1:5188';
const KEY = 'Qo-xLAsgQ63Aamynqk7nWwfYfe63f_eZWRKWEYJu8Y0';
let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, JSON.stringify(extra)); }
};
(async () => {
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ key: KEY }),
  });
  t('local-session 200', login.status === 200, login.status);
  const cookie = (login.headers.getSetCookie?.() || []).join(';') || login.headers.get('set-cookie') || '';
  const headers = cookie ? { cookie } : {};
  const caps = await fetch(BASE + '/api/agent/stage-capabilities', { headers });
  t('stage-capabilities 200', caps.status === 200, caps.status);
  const body = await caps.json().catch(() => null);
  t('8 阶段返回', Array.isArray(body?.stages) && body.stages.length === 8, body?.stages?.length);
  const dev = body?.stages?.find((s) => s.stage === 'dev');
  t('dev skills 4', Array.isArray(dev?.skills) && dev.skills.length === 4, dev?.skills?.length);
  t('dev tools 含开发终端', Array.isArray(dev?.tools) && dev.tools.some((x) => (typeof x === 'string' ? x : x.name) === '开发终端'), dev?.tools);
  const reqs = await fetch(BASE + '/api/reqs', { headers });
  t('reqs 200', reqs.status === 200, reqs.status);
  console.log('\nSMOKE ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
