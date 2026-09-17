'use strict';
// 52 号 HTTP 验证：登录 → freeze → get → review → revoke 全链路 + 违规路径
// 用法：node verify-52-http.cjs <publicId> <workspace>
const ACCESS_KEY = 'Qo-xLAsgQ63Aamynqk7nWwfYfe63f_eZWRKWEYJu8Y0';
const ORIGIN = 'http://127.0.0.1:5188';
const BASE = 'http://127.0.0.1:5188';
const fs = require('node:fs');
const path = require('node:path');

let pass = 0,
  fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
(async () => {
  const reqId = process.argv[2];
  const wsRoot = process.argv[3];
  if (!reqId || !wsRoot) throw new Error('usage: verify-52-http.cjs <reqId> <workspace>');

  // 1) 登录
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ key: ACCESS_KEY }),
  });
  const cookie = login.headers.get('set-cookie') || '';
  check('login 200', login.status === 200, login.status);
  const cookieJar = cookie.split(';')[0];

  async function api(method, url, body) {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: cookieJar,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data };
  }

  // 2) 初始 none
  let r = await api('GET', `/api/agent/requirements/${reqId}/stage-plan?stage=dev`);
  check('initial state none', r.status === 200 && r.data?.state === 'none', { status: r.status, data: r.data });

  // 3) freeze
  const control = {
    mode: 'strict',
    allowedFiles: ['src/**', 'package.json'],
    allowedCommands: [['node', '--version']],
    maxFiles: 5,
    maxBytes: 1048576,
    validUntil: new Date(Date.now() + 2 * 3600000).toISOString(),
  };
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/freeze`, {
    stage: 'dev',
    workspace: wsRoot,
    control,
  });
  check('freeze frozen', r.status === 200 && r.data?.state === 'frozen' && /^[a-f0-9]{64}$/.test(r.data?.baselineHash || ''), { status: r.status, data: r.data });

  // 4) get frozen
  r = await api('GET', `/api/agent/requirements/${reqId}/stage-plan?stage=dev`);
  check('get frozen', r.status === 200 && r.data?.state === 'frozen', r.data);

  // 5) 违规路径：加计划外文件 → review violates → revoke 拒绝
  const other = path.join(wsRoot, 'other.txt');
  fs.writeFileSync(other, 'x\n');
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/review`, { stage: 'dev' });
  check('review violates', r.status === 200 && r.data?.violates === true && r.data?.outOfScope?.includes('other.txt'), { status: r.status, data: r.data });
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/revoke`, { stage: 'dev' });
  check('revoke rejected on violates', r.status === 409 && r.data?.error?.code === 'STAGE_REVIEW_VIOLATIONS', { status: r.status, data: r.data });
  fs.unlinkSync(other);

  // 6) 清场 review → revoke
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/review`, { stage: 'dev' });
  check('review clean', r.status === 200 && r.data?.violates === false, r.data);
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/revoke`, { stage: 'dev' });
  check('revoke succeeded', r.status === 200 && r.data?.state === 'revoked', { status: r.status, data: r.data });
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/revoke`, { stage: 'dev' });
  check('revoke after terminal 409', r.status === 409 && r.data?.error?.code === 'PLAN_NOT_FROZEN', { status: r.status, data: r.data });

  // 7) 非法输入：过期 validUntil
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/freeze`, {
    stage: 'dev',
    workspace: wsRoot,
    control: { ...control, validUntil: new Date(Date.now() + 3600000).toISOString(), mode: 'bad' },
  });
  check('freeze invalid mode 400', r.status === 400 && r.data?.error?.code === 'PLAN_INVALID_MODE', { status: r.status, data: r.data });

  console.log('---');
  console.log('RESULT', pass, 'PASS /', fail, 'FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
