import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* PFC Server · M1 验证（verify-server.mjs）
 * 启动后端（内存态，PORT=5189）→ 按 13 号契约跑通 auth/state/batch/reqs/notices/contract → 关闭
 * 运行：node verify-server.mjs */
const root = dirname(fileURLToPath(import.meta.url));
const PORT = 5189;
const BASE = 'http://127.0.0.1:' + PORT;
const results = [];
let failed = false;
function check(name, ok, extra = '') {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', note: extra });
  if (!ok) failed = true;
  console.log(JSON.stringify({ check: name, status: ok ? 'PASS' : 'FAIL', note: extra }));
}
async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json };
}

const evidence = await mkdtemp(join(tmpdir(), 'pfc-server-'));
const srv = spawn(process.execPath, ['src/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), PFC_DB: 'memory', JWT_SECRET: 'verify-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let booted = false;
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('服务启动超时')), 10000);
  srv.stdout.on('data', (d) => {
    if (String(d).includes('[pfc-server]')) {
      booted = true;
      clearTimeout(timer);
      resolve();
    }
  });
  srv.on('exit', (c) => reject(new Error('服务提前退出 code=' + c)));
});
writeFile(join(evidence, 'server.log'), ''); // 占位：日志走 stdout

/* 1 健康检查 */
const health = await api('GET', '/api/health');
check('health-200', health.status === 200 && health.json?.ok === true);

/* 2 未登录访问受保护接口 → 401 */
const noAuth = await api('GET', '/api/state');
check('state-requires-auth-401', noAuth.status === 401 && noAuth.json?.error?.code === 'UNAUTHORIZED');

/* 3 dev-login → token */
const login = await api('POST', '/api/auth/dev-login', { name: '陈立' });
const token = login.json?.token;
check('dev-login-200-token', login.status === 200 && typeof token === 'string' && token.split('.').length === 3);

/* 4 me */
const me = await api('GET', '/api/auth/me', null, token);
check('me-role-permissions', me.status === 200 && Array.isArray(me.json?.user?.permissions) && me.json.user.permissions.includes('run.control'));

/* 5 首次 state = null → 前端工厂种子 → PUT 保存 → 回读一致 */
const first = await api('GET', '/api/state', null, token);
check('state-first-null', first.status === 200 && first.json?.state === null);

const seed = {
  schema: 1,
  seq: 1200,
  role: 'owner',
  reqs: {
    'R-1042': {
      id: 'R-1042',
      name: '会员积分过期提醒',
      stage: 'dev',
      owner: '陈立',
      goal: '积分过期无提醒导致资产流失感知，客诉占比 8%',
      closed: false,
      messages: [
        { id: 'M1', stage: 'idea', role: 'user', content: '想法', turnId: 'T-1', status: 'ok' },
      ],
    },
  },
  notices: [
    { id: 'NT-1', title: '发布审批待处理：REL-7', kind: 'info', req: 'R-1042', read: false, at: '2026-09-10T00:00:00Z' },
  ],
};
const put = await api('PUT', '/api/state', { state: seed, revision: 1 }, token);
check('state-put-ok', put.status === 200 && put.json?.ok === true && put.json?.storage === 'memory');

const back = await api('GET', '/api/state', null, token);
check('state-readback', back.status === 200 && back.json?.state?.reqs?.['R-1042']?.name === seed.reqs['R-1042'].name);

/* 6 batch 批量变更 */
const batch = await api('POST', '/api/batch', {
  ops: [
    { op: 'set', k: 'pfc.state', v: { ...seed, seq: 1201 } },
  ],
}, token);
check('batch-apply-ok', batch.status === 200 && batch.json?.ok === true && batch.json?.applied === 1);
const afterBatch = await api('GET', '/api/state', null, token);
check('batch-state-updated', afterBatch.status === 200 && afterBatch.json?.state?.seq === 1201);

/* 7 reqs 域：list / get / messages */
const list = await api('GET', '/api/reqs?stage=dev', null, token);
check('reqs-list-filtered', list.status === 200 && list.json?.total === 1 && list.json?.items?.[0]?.id === 'R-1042');
const one = await api('GET', '/api/reqs/R-1042', null, token);
check('reqs-get', one.status === 200 && one.json?.req?.name === '会员积分过期提醒');
const msgs = await api('GET', '/api/reqs/R-1042/messages?stage=idea', null, token);
check('reqs-messages', msgs.status === 200 && msgs.json?.total === 1);
const missing = await api('GET', '/api/reqs/NOPE', null, token);
check('reqs-404', missing.status === 404);

/* 8 写端点：M2a 已落真实实现（创建需求成功） */
const create = await api('POST', '/api/reqs', { name: '联调基线-新建', goal: '验证写端点' }, token);
check('reqs-write-created', create.status === 201 && create.json?.req?.id && create.json?.req?.stage === 'idea');

/* 9 notices：list 未读 / mark-read / read-all */
const noti = await api('GET', '/api/notices', null, token);
check('notices-unread', noti.status === 200 && noti.json?.unread === 1);
const mark = await api('POST', '/api/notices/NT-1/read', null, token);
const noti2 = await api('GET', '/api/notices', null, token);
check('notices-mark-read', mark.status === 200 && noti2.json?.unread === 0);

/* 10 contract 契约对齐 */
const contract = await api('GET', '/api/contract', null, token);
const domains = ['auth', 'reqs', 'runs', 'governance', 'release', 'notices', 'projects'];
check('contract-domains', contract.status === 200 && domains.every((d) => Array.isArray(contract.json?.contract?.[d]) && contract.json.contract[d].length));
check('contract-plan-approve', (contract.json?.contract?.runs || []).some((x) => x[0] === 'planApprove' && /plan-approve/.test(x[1])));

srv.kill();
console.log(JSON.stringify({ status: failed ? 'FAIL' : 'PASS', checks: results.length, results, evidence }));
process.exitCode = failed ? 1 : 0;
