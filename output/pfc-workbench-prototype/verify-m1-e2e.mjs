import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { stop, portFree } from './m2b2-browser-fixture.mjs';

/* PFC · M1 端到端联调（verify-m1-e2e.mjs）
 * 启动后端（内存态，PORT=5191）→ 浏览器以 API 模式打开原型 → 验证
 *   ① 首屏 hydrate（dev-login → GET /api/state → 工厂种子 PUT）
 *   ② 页面修改后 P.save → flush 自动同步服务端（PUT /api/state）
 *   ③ 后端状态回读一致、无 console 错误
 * 运行：node verify-m1-e2e.mjs */
const root = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(root, '..', '..', 'server');
const PORT = 5191;
const BASE = 'http://127.0.0.1:' + PORT;
const results = [];
let failed = false;
function check(name, ok, extra = '') {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', note: extra });
  if (!ok) failed = true;
  console.log(JSON.stringify({ check: name, status: ok ? 'PASS' : 'FAIL', note: extra }));
}

/* 1 启动后端（内存态） */
let srv, browser, cleanup;
try {
if (!await portFree(PORT)) throw Error('Test port already occupied');
srv = spawn(process.execPath, ['src/index.js'], {
  cwd: serverRoot,
  env: { ...process.env, PORT: String(PORT), PFC_DB: 'memory', DATABASE_URL: '', JWT_SECRET: randomUUID() },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('服务启动超时')), 10000);
  srv.stdout.on('data', (d) => {
    if (String(d).includes('[pfc-server]')) {
      clearTimeout(timer);
      resolve();
    }
  });
  srv.on('exit', (c) => { clearTimeout(timer); reject(new Error('服务提前退出 code=' + c)); });
  srv.on('error', () => { clearTimeout(timer); reject(new Error('服务启动失败')); });
  srv.stderr.resume();
});

browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

/* 2 以 API 模式打开原型 */
await page.addInitScript((baseUrl) => {
  window.PFC_DATA_MODE = 'api';
  window.PFC_API_BASE = baseUrl;
}, BASE);
const url = pathToFileURL(join(root, 'index.html')).href;
const loginDelay = Number(process.env.PFC_E2E_DELAY_LOGIN_MS || 0);
if (loginDelay > 0) await page.route(BASE + '/api/auth/dev-login', async route => {
  await new Promise(resolve => setTimeout(resolve, Math.min(loginDelay, 5000)));
  await route.continue();
});
await page.goto(url);
await page.waitForFunction(() => localStorage.getItem('pfc.prototype.token')?.split('.').length === 3 && window.PFCWS?.state === 'connected', null, { timeout: 15000 });

/* 3 首屏 hydrate 断言 */
check('e2e-badge-api', (await page.locator('#global-header .data-mode-tag').textContent())?.includes('API'), '徽标=API 模式');
const token = await page.evaluate(() => localStorage.getItem('pfc.prototype.token') || '');
check('e2e-devlogin-token', token.split('.').length === 3, 'dev-login 已签发 JWT');
const state = await page.evaluate(() => window.PFC.s);
check('e2e-state-loaded', state && state.schema === 1 && state.reqs && Object.keys(state.reqs).length >= 3, '状态树已加载（工厂种子或服务端）');

/* 4 后端已收到种子（GET /api/state 非空） */
const res = await fetch(BASE + '/api/state', {
  headers: { Authorization: 'Bearer ' + token },
});
const serverState = (await res.json()).state;
check('e2e-seed-on-server', res.status === 200 && serverState && serverState.schema === 1, '工厂种子已 PUT 到服务端');

/* 5 页面修改 → P.save → flush 自动同步服务端 */
const saved = page.waitForResponse(response => response.url() === BASE + '/api/state' && response.request().method() === 'PUT' && response.ok() && response.request().postDataJSON()?.state?.reqs?.['R-1042']?.name === 'CODEx_TEST_M1_E2E_合成提醒', { timeout: 15000 });
await page.evaluate(() => {
  window.PFC.s.seq = 9999;
  window.PFC.s.reqs['R-1042'].name = 'CODEx_TEST_M1_E2E_合成提醒';
  window.PFC.save();
});
await saved; // Wait for this save response, then independently read the server.
const res2 = await fetch(BASE + '/api/state', {
  headers: { Authorization: 'Bearer ' + token },
});
const after = (await res2.json()).state;
check('e2e-flush-synced', res2.status === 200 && after?.seq === 9999, '页面修改已 flush 到服务端 seq=' + (after && after.seq));
check('e2e-flush-field', after?.reqs?.['R-1042']?.name === 'CODEx_TEST_M1_E2E_合成提醒', '字段级修改已同步');

/* 6 重新加载页面 → 从服务端恢复（hydrate 回读） */
await page.reload();
await page.waitForFunction(() => window.PFC?.s.seq === 9999 && window.PFCWS?.state === 'connected', null, { timeout: 15000 });
const restored = await page.evaluate(() => window.PFC.s.seq);
check('e2e-reload-restore', restored === 9999, '重载后从服务端恢复 seq=' + restored);

/* 7 无 console 错误（CORS/file 误报除外） */
const real = consoleErrors.filter((e) => !/favicon/i.test(e));
check('e2e-no-console-error', real.length === 0, real.slice(0, 3).join(' | '));

} catch(e) {
  check('e2e-flow-completed', false, e.message);
} finally {
  try { await browser?.close(); } finally { await stop(srv); }
  cleanup = { pid:srv?.pid, exited:!srv || srv.exitCode !== null || srv.signalCode !== null, port:PORT, portFree:await portFree(PORT), browserClosed:true, data:'synthetic memory discarded' };
  if (!cleanup.exited || !cleanup.portFree) { failed=true; }
}
console.log(JSON.stringify({ status: failed ? 'FAIL' : 'PASS', checks: results.length, results, cleanup, loginDelayMs:Number(process.env.PFC_E2E_DELAY_LOGIN_MS || 0) }));
process.exitCode = failed ? 1 : 0;
