'use strict';
// 常驻验收服务（5188，007 schema + codex env）浏览器验收（零模型消耗）：
// 1. dev-login 拿 token → POST /api/reqs 创建真实需求（走服务真实接口）。
// 2. 浏览器打开 workbench 面板（api 模式连 127.0.0.1:5188），无 remoteError。
// 3. 进入开发阶段：execCapable=true → exec-bar 渲染（#exec-workspace / #exec-restricted）。
// 4. 输入真实项目路径 → P.s.ui.execWorkspace 持久化；截图。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '常驻验收服务浏览器验收：真实 req 创建 + 面板 dev 阶段 exec 入口渲染 + 项目路径持久化（零模型）',
  tests: [],
  errors: [],
  external: [],
};
const outputDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(outputDir, '..', '..');
const base = 'http://127.0.0.1:5188';
const evidenceDir = resolve(projectRoot, '.local/ai-tools-live-browser-20260915');
const workspace = resolve(projectRoot, '.local/ai-tools-integration-20260914/preflight');
try {
  mkdirSync(evidenceDir, { recursive: true });
  // 1. dev-login
  const login = await fetch(base + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  assert.equal(login.status, 200, 'dev-login 200');
  const { token, user } = await login.json();
  report.tests.push({ name: 'dev-login(owner) 200', status: 'PASS' });
  const auth = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };

  // agent status
  const st = await (await fetch(base + '/api/agent/status', { headers: auth })).json();
  assert.equal(st.execCapable, true, 'execCapable on 5188');
  assert.equal(st.schemaVersion, '007');
  report.tests.push({ name: 'agent/status: execCapable=true, schema 007', status: 'PASS' });

  // 2. 创建真实 req
  const created = await fetch(base + '/api/reqs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      name: '常驻验收需求（浏览器入口 smoke）',
      goal: '验证常驻服务面板直达：想法→需求→开发全链路入口可用',
      scope: '浏览器面板真实连 5188',
    }),
  });
  assert.equal(created.status, 201, 'req created');
  const resp = await created.json();
  const req = resp.req;
  assert.ok(req && (req.public_id || req.id), 'req id');
  report.tests.push({ name: 'POST /api/reqs 201（真实创建）', status: 'PASS' });

  // 3. 浏览器面板
  const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 30000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
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
    { base, name: user.name },
  );
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(pathToFileURL(resolve(outputDir, 'index.html')).href);
  await page.waitForFunction(() => window.PFCAPI?.api.ready || window.PFC?.remoteError);
  assert.equal(await page.evaluate(() => window.PFC.remoteError), null);
  report.tests.push({ name: '面板加载无 remoteError（连 5188）', status: 'PASS' });

  // 4. 进入开发阶段
  const reqId = req.public_id || req.id;
  await page.evaluate(({ id }) => window.PFC.go({ route: 'work', req: id, stage: 'dev' }), { id: reqId });
  await page.waitForFunction(() => window.PFC?.s?.env?.execCapable === true, null, { timeout: 15000 });
  report.tests.push({ name: 'dev 阶段 execCapable=true 就绪', status: 'PASS' });

  const wsInput = page.locator('#exec-workspace');
  await wsInput.waitFor({ state: 'visible', timeout: 15000 });
  const capText = await page.locator('.exec-bar .exec-cap').first().innerText();
  assert.equal(capText.includes('开发执行'), true);
  report.tests.push({ name: 'exec-bar 渲染（开发执行入口可见）', status: 'PASS' });

  const rsInput = page.locator('#exec-restricted');
  await rsInput.waitFor({ state: 'visible', timeout: 15000 });
  report.tests.push({ name: 'exec-restricted 渲染', status: 'PASS' });

  // 5. 输入真实项目路径 → 持久化
  await wsInput.fill(workspace);
  await page.waitForFunction(
    (w) => window.PFC?.s?.ui?.execWorkspace === w,
    workspace,
    { timeout: 5000 },
  );
  report.tests.push({ name: '项目路径写入 P.s.ui.execWorkspace 持久化', status: 'PASS' });

  // 截图
  await page.screenshot({ path: resolve(evidenceDir, 'panel-dev-exec-1440.png') });
  report.tests.push({ name: '截图 panel-dev-exec-1440.png', status: 'PASS' });

  await browser.close();
  report.status = 'PASS';
} catch (e) {
  report.errors.push(e.message);
  report.status = 'FAIL';
}
const file = resolve(projectRoot, 'docs/quality-gate/reports/ai-tools-integration-20260914/live-server-browser-' + Date.now() + '.json');
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, tests: report.tests.length, file, errors: report.errors, external: report.external.length }));
