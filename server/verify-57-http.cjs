// 57 号 HTTP 验证：dev 阶段配置 codex-cli（PUT）→ GET 确认 → 恢复 seed 默认
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
  const cookie = (login.headers.getSetCookie?.() || []).join(';') || login.headers.get('set-cookie') || '';
  const headers = cookie ? { cookie, 'content-type': 'application/json' } : { 'content-type': 'application/json' };

  // PUT dev 阶段：追加 codex-cli（幂等 upsert；写操作需 Origin）
  const put = await fetch(BASE + '/api/agent/stage-capabilities/dev', {
    method: 'PUT',
    headers: { ...headers, origin: BASE },
    body: JSON.stringify({
      entries: [
        {
          kind: 'tool',
          name: 'codex-cli',
          source: 'local',
          description: 'Codex CLI 受控终端（冻结计划内命令执行）',
          enabled: true,
          priority: 50,
        },
      ],
    }),
  });
  t('PUT codex-cli 200', put.status === 200, put.status);

  const caps = await fetch(BASE + '/api/agent/stage-capabilities/dev', { headers });
  const body = await caps.json().catch(() => null);
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  const toolNames = entries.filter((e) => e.kind === 'tool').map((e) => e.name);
  t('dev tools 含 codex-cli', toolNames.includes('codex-cli'), toolNames);
  console.log('\nHTTP 57: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
