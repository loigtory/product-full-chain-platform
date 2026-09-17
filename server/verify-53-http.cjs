'use strict';
// 53 号多阶段 HTTP 验证：design/dev/test 任一阶段 freeze→review→revoke 闭环
const path = require('node:path');
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:5188';
const ORIGIN = 'http://127.0.0.1:5188';
const ACCESS_KEY = 'Qo-xLAsgQ63Aamynqk7nWwfYfe63f_eZWRKWEYJu8Y0';
const [, , reqId, wsRoot, stageArg] = process.argv;
const stage = stageArg || 'design';
let pass = 0,
  fail = 0;
const check = (name, ok, extra) => {
  if (ok) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, JSON.stringify(extra));
  }
};
(async () => {
  // 登录
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ key: ACCESS_KEY }),
  });
  check('login 200', login.status === 200, login.status);
  const cookieJar = (login.headers.get('set-cookie') || '').split(';')[0];
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

  // 初始 none
  let r = await api('GET', `/api/agent/requirements/${reqId}/stage-plan?stage=${stage}`);
  check('initial none', r.status === 200 && r.data?.state === 'none', r.data);

  // freeze（阶段模板：design 用 docs/**、dev/test 用 src/**）
  const control = {
    mode: 'strict',
    allowedFiles: stage === 'design' ? ['docs/**', '*.md'] : ['src/**', 'package.json'],
    allowedCommands: stage === 'design' ? [['ls']] : [['node', '--version']],
    maxFiles: 10,
    maxBytes: 1048576,
    validUntil: new Date(Date.now() + 2 * 3600000).toISOString(),
  };
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/freeze`, {
    stage,
    workspace: wsRoot,
    control,
  });
  check(
    'freeze frozen',
    r.status === 200 && r.data?.state === 'frozen' && r.data?.stage === stage && /^[a-f0-9]{64}$/.test(r.data?.baselineHash || ''),
    r.data,
  );

  // get frozen
  r = await api('GET', `/api/agent/requirements/${reqId}/stage-plan?stage=${stage}`);
  check('get frozen', r.status === 200 && r.data?.state === 'frozen' && r.data?.fileCount >= 1, r.data);

  // 违规路径：加越界文件 → review violates → revoke 拒绝
  const rogue = path.join(wsRoot, 'rogue.txt');
  fs.writeFileSync(rogue, 'x\n');
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/review`, { stage });
  check(
    'review violates',
    r.status === 200 && r.data?.violates === true && r.data?.outOfScope?.includes('rogue.txt'),
    r.data,
  );
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/revoke`, { stage });
  check('revoke rejected on violates', r.status === 409 && r.data?.error?.code === 'STAGE_REVIEW_VIOLATIONS', r.data);
  fs.unlinkSync(rogue);

  // 清场 review → revoke
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/review`, { stage });
  check('review clean', r.status === 200 && r.data?.violates === false, r.data);
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/revoke`, { stage });
  check('revoke succeeded', r.status === 200 && r.data?.state === 'revoked', r.data);
  r = await api('POST', `/api/agent/requirements/${reqId}/stage-plan/revoke`, { stage });
  check('revoke after terminal 409', r.status === 409 && r.data?.error?.code === 'PLAN_NOT_FROZEN', r.data);

  console.log('---');
  console.log('RESULT', pass, 'PASS /', fail, 'FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
