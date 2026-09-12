import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* PFC Server · M2b Bridge 实时对话流验证（verify-m2b.mjs）
 * 启动后端 → pair 拿 bridge_token → 启动 sim-bridge →
 * Web 客户端订阅 /ws/web → 创建需求/确认/推进 → 创建作业/批准/启动 →
 * 断言：sim-bridge 逐行推送 job.line（Web 端实时收到）→ job.done → run SUCCEEDED。
 * 运行：node verify-m2b.mjs */
const root = dirname(fileURLToPath(import.meta.url));
const PORT = 5193;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 1 启动后端 */
const srv = spawn(process.execPath, ['src/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), PFC_DB: 'memory', JWT_SECRET: 'm2b-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('服务启动超时')), 10000);
  srv.stdout.on('data', (d) => {
    if (String(d).includes('[pfc-server]')) {
      clearTimeout(timer);
      resolve();
    }
  });
  srv.on('exit', (c) => reject(new Error('服务提前退出 code=' + c)));
});

/* 2 登录 + pair */
const login = await api('POST', '/api/auth/dev-login', { name: '陈立' });
const webToken = login.json?.token;
const paired = await api('POST', '/api/bridges/pair', { name: '本地开发电脑' }, webToken);
const bridgeToken = paired.json?.bridgeToken;
check('m2b-pair-token', typeof bridgeToken === 'string' && bridgeToken.split('.').length === 3);

/* 3 启动 sim-bridge */
const sim = spawn(process.execPath, ['sim-bridge.mjs', '--port', String(PORT), '--token', bridgeToken, '--name', '本地开发电脑'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
await sleep(1200); // 等待 sim-bridge 连接

/* 4 Web 客户端订阅 /ws/web */
const received = [];
const wsUrl = 'ws://127.0.0.1:' + PORT + '/ws/web?token=' + encodeURIComponent(webToken);
const webWs = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('web ws 连接超时')), 5000);
  webWs.onopen = () => {
    clearTimeout(t);
    resolve();
  };
  webWs.onerror = () => reject(new Error('web ws 连接失败'));
});
webWs.onmessage = (ev) => {
  try {
    received.push(JSON.parse(String(ev.data)));
  } catch {
    /* ignore */
  }
};
await sleep(500);
const bridgeStatus = received.filter((m) => m.type === 'bridge.status' && m.status === 'ONLINE');
check('m2b-bridge-online-pushed', bridgeStatus.length >= 1, 'Web 端收到 Bridge 上线推送');

/* 5 创建需求 → 确认 idea 版本 → 推进到 req */
const created = await api('POST', '/api/reqs', { name: '实时推送演示', goal: '验证 Bridge 对话流' }, webToken);
const nid = created.json?.req?.id;
const versions = await api('GET', '/api/reqs/' + nid + '/versions', null, webToken);
const vid = versions.json?.versions?.find((v) => v.stage === 'idea')?.id;
await api('POST', '/api/reqs/' + nid + '/versions/' + vid + '/confirm', {}, webToken);
await api('PATCH', '/api/reqs/' + nid + '/stage', { to: 'req' }, webToken);

/* 6 创建作业 → 批准 → 启动（应派发 Bridge） */
const run = await api('POST', '/api/runs', { reqId: nid, plan: '拆解：1) 读取结构 2) 实现 3) 测试' }, webToken);
const runId = run.json?.run?.id;
await api('POST', '/api/runs/' + runId + '/plan-approve', { by: '陈立' }, webToken);
await api('POST', '/api/runs/' + runId + '/start', {}, webToken);

/* 7 等待 Bridge 逐行推送（5 行 × 600ms + 余量） */
await sleep(4500);
const lines = received.filter((m) => m.type === 'job.line' && m.runId === runId);
check('m2b-realtime-lines', lines.length >= 4, 'Web 端实时收到 job.line ' + lines.length + ' 条');
check('m2b-line-content', lines.some((l) => l.text.includes('单元测试')), '推送内容为终端对话流');
const done = received.find((m) => m.type === 'run.status' && m.runId === runId && m.status === 'SUCCEEDED');
check('m2b-run-succeeded-pushed', !!done, 'job.done → run.status SUCCEEDED 推送');

/* 8 服务端落库：回放步骤 + 行 + 运行状态 */
const replay = await api('GET', '/api/runs/' + runId + '/replay', null, webToken);
check('m2b-replay-recorded', replay.status === 200 && replay.json?.steps?.length >= 4, 'Bridge 快照已落库');
const list = await api('GET', '/api/reqs', null, webToken);
check('m2b-no-console-break', list.status === 200);

sim.kill();
srv.kill();
console.log(JSON.stringify({ status: failed ? 'FAIL' : 'PASS', checks: results.length, results }));
process.exitCode = failed ? 1 : 0;
