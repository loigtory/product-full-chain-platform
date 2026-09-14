import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
    'Browser gate: real-mode toggle renders in PG mode, defaults to simulate, and is blocked without Codex connection',
  tests: [],
  errors: [],
  external: [],
};
const outputDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(outputDir, '..', '..');
const serverDir = resolve(projectRoot, 'server');
const nodeBin = resolve(projectRoot, '.tools/node-v24.20.0-win-x64/node.exe');
const serverRequire = createRequire(resolve(serverDir, 'package.json'));
const root =
  'docs/quality-gate/reports/ai-tools-integration-20260914';
const smokeDir = resolve(projectRoot, '.local/ai-tools-browser-smoke-20260914');
const filesRoot = resolve(
  projectRoot,
  '.local/m2c-2-domain-20260912/files/ai-tools-browser-smoke',
);
const port = 5202;
const jwtSecret = randomUUID() + randomUUID().replaceAll('-', '');
let fixture, child, ready = false;
try {
  const { aiDatabaseFixture } = await import('../../server/test-data/ai-tools-fixture.mjs');
  fixture = await aiDatabaseFixture('browser');
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
  };
  delete env.PFC_CODEX_BINARY;
  delete env.PFC_CODEX_PREFLIGHT_CWD;
  delete env.PFC_CODEX_CONNECTION_SHA256;
  delete env.PFC_CODEX_BINARY_SHA256;
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
  report.tests.push({ name: '007 browser smoke server boots', status: 'PASS' });

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

  // PG 模式（api 模式 health.storage==='pg'）下 composer 应显示 real toggle，默认模拟。
  await page.evaluate(
    ({ id }) => window.PFC.go({ route: 'work', req: id, stage: 'idea' }),
    { id: req.public_id },
  );
  const toggle = page.locator('button[data-action="toggle-real-mode"]');
  await toggle.first().waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(
    (await page.locator('.real-toggle-label').first().innerText()).trim(),
    '模拟',
  );
  report.tests.push({
    name: 'real-mode toggle renders in PG mode and defaults to simulate',
    status: 'PASS',
  });

  // 未配置 Codex 连接（capable=false）时点击应阻止并提示，保持模拟。
  await toggle.first().click();
  await page.waitForFunction(
    () => document.body.innerText.includes('已保持模拟模式'),
  );
  assert.equal(
    (await page.locator('.real-toggle-label').first().innerText()).trim(),
    '模拟',
  );
  report.tests.push({
    name: 'toggle open is blocked with toast when Codex connection absent',
    status: 'PASS',
  });

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
  const file = `${root}/browser-${Date.now()}.json`;
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
