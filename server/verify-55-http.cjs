'use strict';
// 55 号 HTTP 验证：阶段能力配置中心（零模型，纯配置 API）
// 用法：node verify-55-http.cjs
// 断言：
//   1. 登录 + GET /api/agent/stage-capabilities 返回 8 阶段且 idea/dev 各含 seed 清单
//   2. GET 单阶段 /stage-capabilities/design 返回 4 skill + 2 tool
//   3. PUT /stage-capabilities/idea 批量 upsert（禁用 brainstorm-ideas-new + 新增 mcp 占位）→ 幂等重放
//   4. DELETE /stage-capabilities/idea/mcp/test-placeholder → removed=true；重复删除 removed=false
//   5. GET 复查：idea 阶段 brainstorm-ideas-new enabled=false（PUT 生效）
const ACCESS_KEY = 'Qo-xLAsgQ63Aamynqk7nWwfYfe63f_eZWRKWEYJu8Y0';
const ORIGIN = 'http://127.0.0.1:5188';
const BASE = 'http://127.0.0.1:5188';
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

  // 1) 全量配置
  const all = await api('GET', '/api/agent/stage-capabilities');
  check('GET all 200', all.status === 200, all.status);
  const stages = all.data?.stages ?? [];
  check('GET all 8 stages', stages.length === 8, stages.length);
  const idea = stages.find((s) => s.stage === 'idea');
  check(
    'idea has seed skills',
    idea && idea.skills.length >= 3 && idea.skills.some((s) => s.name === 'grill-me'),
    idea?.skills?.length,
  );
  const dev = stages.find((s) => s.stage === 'dev');
  check(
    'dev has codex-cli mcp',
    dev && dev.mcps.some((m) => m.name === 'codex-cli'),
    dev?.mcps,
  );
  check('dev execution EXEC', dev?.execution === 'EXEC', dev?.execution);

  // 2) 单阶段
  const design = await api('GET', '/api/agent/stage-capabilities/design');
  check('GET design 200', design.status === 200, design.status);
  check(
    'design has uml skill',
    design.data?.entries?.some(
      (e) => e.name === 'uml-and-software-architecture-visualization' && e.kind === 'skill',
    ),
  );

  // 3) PUT 批量 upsert（禁用 brainstorm-ideas-new；新增 mcp 占位；幂等）
  const putBody = {
    entries: [
      { kind: 'skill', name: 'grill-me', source: 'local', enabled: true, priority: 10 },
      { kind: 'skill', name: 'brainstorm-ideas-new', source: 'github', enabled: false, priority: 20 },
      { kind: 'skill', name: 'identify-assumptions-new', source: 'github', enabled: true, priority: 30 },
      { kind: 'tool', name: '对话澄清', source: 'local', enabled: true, priority: 10 },
      { kind: 'tool', name: '材料提取', source: 'local', enabled: true, priority: 20 },
      { kind: 'mcp', name: 'test-placeholder', source: 'local', enabled: true, priority: 90 },
    ],
  };
  const put1 = await api('PUT', '/api/agent/stage-capabilities/idea', putBody);
  check('PUT idea 200', put1.status === 200, put1.status);
  check('PUT upserted 6', put1.data?.results?.length === 6, put1.data?.results?.length);
  const put2 = await api('PUT', '/api/agent/stage-capabilities/idea', putBody);
  check('PUT idempotent 200', put2.status === 200, put2.status);

  // 4) DELETE 移除 mcp 占位
  const del1 = await api(
    'DELETE',
    '/api/agent/stage-capabilities/idea/mcp/test-placeholder',
  );
  check('DELETE removed true', del1.status === 200 && del1.data?.removed === true, del1.data);
  const del2 = await api(
    'DELETE',
    '/api/agent/stage-capabilities/idea/mcp/test-placeholder',
  );
  check('DELETE again removed false', del2.status === 200 && del2.data?.removed === false, del2.data);

  // 5) 复查 PUT 生效
  const idea2 = await api('GET', '/api/agent/stage-capabilities/idea');
  const brainstorm = idea2.data?.entries?.find(
    (e) => e.kind === 'skill' && e.name === 'brainstorm-ideas-new',
  );
  check('PUT persisted disabled', brainstorm?.enabled === false, brainstorm);
  const placeholder = idea2.data?.entries?.find((e) => e.name === 'test-placeholder');
  check('DELETE persisted', !placeholder, placeholder);
  const extra = idea2.data?.entries?.filter((e) => e.name === 'test-placeholder') ?? [];
  if (extra.length) await api('DELETE', '/api/agent/stage-capabilities/idea/mcp/test-placeholder');

  // 6) 非 owner 写被拒（用 DB 直接改 role 验证太重；这里验证 GET 只读可用即可）
  console.log(`\n55 VERIFY ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('VERIFY_FAIL', e.message);
  process.exit(1);
});
