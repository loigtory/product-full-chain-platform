'use strict';
// exec 前端入口浏览器闸（零模型消耗）：
// 1. 007 schema + PFC_CODEX_BINARY 配置 → /api/agent/status.execCapable=true
//    → 开发阶段 composer 渲染"开发执行"入口（#exec-workspace / #exec-restricted）。
// 2. 输入项目路径 → P.s.ui.execWorkspace 持久化；payload 携带
//    mode:'real' + tool:'exec' + workspace + restrictedReadDirs（源码断言）。
// 3. 不发送消息，不触发 runExecJob——真实执行链由 verify-ai-tools-exec-worker 覆盖。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'Browser gate: exec entry (tool:exec + workspace) renders in dev stage when execCapable, persists input, payload carries exec params (zero model)',
  tests: [],
  errors: [],
  external: [],
};
const outputDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(outputDir, '..', '..');
const serverDir = resolve(projectRoot, 'server');
const nodeBin = resolve(projectRoot, '.tools/node-v24.20.0-win-x64/node.exe');
const serverRequire = createRequire(resolve(serverDir, 'package.json'));
const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
const smokeDir = resolve(projectRoot, '.local/ai-tools-exec-browser-smoke-20260915');
const filesRoot = resolve(
  projectRoot,
  '.local/m2c-2-domain-20260912/files/ai-tools-exec-browser-smoke',
);
const port = 5203;
const jwtSecret = randomUUID() + randomUUID().replaceAll('-', '');
const codexBinary = 'C:/Users/hz19114673/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js';
let fixture, child, ready = false;
try {
  const { aiDatabaseFixture } = await import('../../server/test-data/ai-tools-fixture.mjs');
  fixture = await aiDatabaseFixture('execbrowser');
  const { migrate, assertReady } = serverRequire('./src/persistence/migrations');
  await migrate(fixture.db);
  await assertReady(fixture.db);
  const { ctx, req } = await fixture.seed();
  const db = fixture.db;
  mkdirSync(smokeDir, { recursive: true });
  mkdirSync(filesRoot, { recursive: true });
  const usersFile = resolve(smokeDir, 'users.json');
  writeFileSync(
    usersFile,
    JSON.stringify([{ name: ctx.actor, tenantId: ctx.tenantId, role: 'owner' }]),
  );
  const jwt = serverRequire('jsonwebtoken').sign(
    { sub: ctx.actor, role: 'owner', tenant: ctx.tenantId },
    jwtSecret,
    { expiresIn: '1h' },
  );
  const env = {
    ...process.env,
    PORT: String(port),
    PFC_DB: 'pg',
    DATABASE_URL: fixture.options.connectionString,
    PFC_DB_SCHEMA: db.schema,
    PFC_AUTHORIZED_SCHEMA: db.schema,
    PFC_DB_TARGET_VERSION: '007',
    JWT_SECRET: jwtSecret,
    PFC_LOCAL_USERS_FILE: usersFile,
    PFC_FILE_QUOTA_BYTES: '10485760',
    PFC_FILES_ROOT: filesRoot,
    // 真实 agent 连接：仅用于 execCapable=true（status 只读 env，不调用模型；
    // 本闸不发送 exec 消息，不触发 runExecJob）
    PFC_CODEX_BINARY: codexBinary,
    PFC_CODEX_PREFLIGHT_CWD: 'D:/项目管理/product-full-chain-platform',
  };
  child = spawn(nodeBin, ['src/index.js'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => {
    if (report.serverLogs) report.serverLogs += d.toString();
    else report.serverLogs = d.toString();
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) { ready = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, 'server did not become ready');
  report.tests.push({ name: '007 + codex exec-browser server boots', status: 'PASS' });

  // agent/status 返回 execCapable=true（capable && schemaVersion==='007'）
  const st = await (
    await fetch(base + '/api/agent/status', {
      headers: { Authorization: 'Bearer ' + jwt },
    })
  ).json();
  assert.equal(st.capable, true, 'capable should be true with PFC_CODEX_BINARY');
  assert.equal(st.schemaVersion, '007');
  assert.equal(st.execCapable, true, 'execCapable should be true on 007 + codex');
  report.tests.push({ name: 'agent/status exposes execCapable=true on 007 + codex', status: 'PASS' });

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    timeout: 30000,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      report.external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(
    ({ base, name }) => {
      window.PFC_DATA_MODE = 'api';
      window.PFC_API_BASE = base;
      window.PFC_USER_NAME = name;
    },
    { base, name: ctx.actor },
  );
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(
    pathToFileURL(resolve('output/pfc-workbench-prototype/index.html')).href,
  );
  await page.waitForFunction(
    () => window.PFCAPI?.api.ready || window.PFC?.remoteError,
  );
  assert.equal(await page.evaluate(() => window.PFC.remoteError), null);
  report.tests.push({ name: 'workbench loads in api mode without remote error', status: 'PASS' });

  // 进入开发阶段；等 P.s.env.execCapable 异步就绪
  await page.evaluate(
    ({ id }) => window.PFC.go({ route: 'work', req: id, stage: 'dev' }),
    { id: req.public_id },
  );
  await page.waitForFunction(
    () => window.PFC?.s?.env?.execCapable === true,
    null,
    { timeout: 15000 },
  );
  report.tests.push({ name: 'P.s.env.execCapable becomes true after status fetch', status: 'PASS' });

  // 开发阶段渲染 exec-bar
  const wsInput = page.locator('#exec-workspace');
  await wsInput.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('.exec-bar .exec-cap').first().innerText().then((t) => t.includes('开发执行')), true);
  report.tests.push({ name: 'exec-bar renders in dev stage when execCapable', status: 'PASS' });

  // 受限读输入也存在
  const rsInput = page.locator('#exec-restricted');
  await rsInput.waitFor({ state: 'visible', timeout: 15000 });
  report.tests.push({ name: 'exec-restricted input renders', status: 'PASS' });

  // 输入项目路径 → P.s.ui.execWorkspace 持久化；受限读目录数组化
  const workspace = 'D:/项目管理/product-full-chain-platform/.local/ai-tools-integration-20260914/preflight';
  await wsInput.fill(workspace);
  await rsInput.fill('D:/other, D:/another');
  await page.evaluate(() => document.getElementById('exec-restricted').dispatchEvent(new Event('input', { bubbles: true })));
  await page.waitForFunction(
    (w) => window.PFC?.s?.ui?.execWorkspace === w,
    workspace,
  );
  const dirs = await page.evaluate(() => window.PFC.s.ui.execRestrictedDirs);
  assert.deepEqual(dirs, ['D:/other', 'D:/another']);
  report.tests.push({ name: 'exec workspace + restricted dirs persist to P.s.ui', status: 'PASS' });

  // payload 构造（源码断言）：domain-conversation.js 携带 mode/tool/workspace/restrictedReadDirs
  const dc = readFileSync(resolve(outputDir, 'original/domain-conversation.js'), 'utf8');
  assert.match(dc, /tool: 'exec'/);
  assert.match(dc, /workspace: execWs/);
  assert.match(dc, /restrictedReadDirs: P\.s\.ui\.execRestrictedDirs \|\| \[\]/);
  assert.match(dc, /P\.s\.ui\.realMode \|\| execWs \? \{ mode: 'real' \} : \{\}/);
  report.tests.push({ name: 'submitTurn payload carries exec params (source assertion)', status: 'PASS' });

  // 渲染条件源码断言：006 或未配置 codex 时不显示（execCapable 门控）
  const wb = readFileSync(resolve(outputDir, 'original/workbench.js'), 'utf8');
  assert.match(wb, /P\.s\.env\?\.execCapable && P\.s\.ui\.stage === 'dev'/);
  report.tests.push({ name: 'exec-bar gated by execCapable + dev stage (source assertion)', status: 'PASS' });

  assert.equal(report.errors.length, 0, 'page JS errors: ' + report.errors.join('; '));
  assert.equal(report.external.length, 0, 'non-loopback requests observed');
  await browser.close();
  report.status = 'PASS';
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: e.message };
  process.exitCode = 1;
} finally {
  if (child && !child.killed) child.kill();
  await new Promise((r) => setTimeout(r, 300));
  if (fixture) await fixture.cleanup();
  rmSync(smokeDir, { recursive: true, force: true });
  rmSync(filesRoot, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const file = `${root}/exec-browser-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      file,
      error: report.error,
      jsErrors: report.errors.length,
      external: report.external.length,
      serverLogs: (report.serverLogs || '').slice(-300),
    }),
  );
}
