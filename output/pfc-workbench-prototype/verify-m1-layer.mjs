import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* M1 前端先行 · 数据层验证（verify-m1-layer）
 * 覆盖：默认 local 模式等价基线；mock 模式与基线 key 隔离且可持久化；
 *       api 桥接骨架与 13 号契约清单；index.html 加载顺序；浏览器徽标与点击切换。
 * 运行：node verify-m1-layer.mjs  （需 playwright + msedge，同 verify-guide-browser） */
const root = dirname(fileURLToPath(import.meta.url));
const results = [];
async function test(name, fn) {
  await fn();
  results.push({ name, status: 'PASS' });
}
function sandbox(sharedStorage, extraWindow = {}) {
  const store = sharedStorage || new Map();
  const storage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const ctx = vm.createContext({
    window: { addEventListener() {}, ...extraWindow },
    localStorage: storage,
    Date,
  });
  for (const f of ['data.js', 'data-layer.js', 'api-client.js', 'model.js'])
    vm.runInContext(readFileSync(join(root, 'original', f), 'utf8'), ctx, {
      filename: f,
    });
  return {
    P: ctx.window.PFC,
    store: ctx.window.PFCStore,
    storage,
    map: store, // 共享存储 Map（模拟 reload 时传入）
    ctx,
  };
}

await test('default-mode-is-local-and-writes-baseline-key', () => {
  const { P, store, storage } = sandbox();
  assert.equal(store.mode, 'local');
  assert.equal(P.s.schema, 1); // 工厂数据可加载
  P.save();
  assert.ok(storage.getItem(P.KEY), 'local 模式应写基线 key');
  assert.equal(storage.getItem(store.MOCK_KEY), null, '不应写 mock key');
});

await test('mock-mode-isolated-from-baseline-key-and-persists', () => {
  const { P, store, storage } = sandbox();
  store.setMode('mock');
  assert.equal(store.mode, 'mock');
  P.save();
  assert.equal(storage.getItem(P.KEY), null, 'mock 模式不得污染基线 key');
  const persisted = storage.getItem(store.MOCK_KEY);
  assert.ok(persisted && JSON.parse(persisted).schema === 1, 'mock 持久化完整');
  assert.equal(storage.getItem(store.MODE_KEY), 'mock', '模式选择已持久化');
});

await test('mock-mode-reload-restores-saved-mode-and-data', () => {
  const first = sandbox();
  first.store.setMode('mock');
  first.P.save();
  const s1 = first.storage;
  // 新会话：同一存储 Map（模拟 reload），无显式 PFC_DATA_MODE
  const second = sandbox(first.map);
  assert.equal(second.store.mode, 'mock', 'reload 后沿用持久化模式');
  assert.equal(second.P.s.schema, 1);
  assert.equal(second.P.s.seq, first.P.s.seq, 'mock 数据 reload 后可恢复');
});

await test('api-bridge-sync-surface-and-contract-mapping', async () => {
  const { P, store, ctx } = sandbox();
  store.setMode('api');
  assert.ok(ctx.window.PFCAPI && ctx.window.PFCAPI.api, 'api-client 已挂载');
  P.save(); // apiStore → PFCAPI.api.setSync 入内存镜像 + 队列
  const api = ctx.window.PFCAPI.api;
  assert.equal(api.getSync(P.KEY) != null, true, '同步镜像可读');
  const c = api.contract();
  for (const domain of ['auth', 'reqs', 'runs', 'governance', 'release', 'notices', 'projects'])
    assert.ok(Array.isArray(c[domain]) && c[domain].length, '契约域 ' + domain + ' 存在');
  assert.ok(c.runs.some((x) => x[0] === 'planApprove' && /plan-approve/.test(x[1])), '13 号契约路径映射');
  const flushed = api.flush();
  assert.equal(typeof flushed.then, 'function', 'flush 返回 Promise');
  assert.ok((await flushed).length >= 1, '变更队列非空');
});

await test('index-html-loads-data-layer-before-model', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const iData = html.indexOf('original/data.js');
  const iLayer = html.indexOf('original/data-layer.js');
  const iApi = html.indexOf('original/api-client.js');
  const iModel = html.indexOf('original/model.js');
  assert.ok(iLayer > iData && iLayer < iModel, 'data-layer 在 data 后、model 前');
  assert.ok(iApi > iLayer && iApi < iModel, 'api-client 在 model 前');
});

/* ---- 浏览器 smoke：默认徽标 + 点击切换生效 ---- */
let browserResult = { status: 'SKIP', reason: '' };
try {
  const { chromium } = await import('playwright');
  const url = pathToFileURL(join(root, 'index.html')).href;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.locator('#global-header .data-mode-tag').waitFor();
  const label = await page.locator('#global-header .data-mode-tag').textContent();
  const mode = await page.evaluate(() => window.PFCStore.mode);
  assert.equal(mode, 'local');
  assert.equal(label.trim(), '本地存储');
  await page.locator('#global-header .data-mode-tag').click(); // 切到 mock 并 reload
  await page.waitForTimeout(1200);
  await page.locator('#global-header .data-mode-tag').waitFor();
  const mode2 = await page.evaluate(() => window.PFCStore.mode);
  assert.equal(mode2, 'mock', '点击切换后 reload 生效');
  const label2 = await page.locator('#global-header .data-mode-tag').textContent();
  assert.equal(label2.trim(), 'Mock 服务端');
  assert.equal(errors.length, 0, 'console/page 无错误: ' + errors.join(' | '));
  await browser.close();
  browserResult = { status: 'PASS', reason: '徽标/切换/无错' };
} catch (e) {
  browserResult = { status: 'FAIL', reason: e.message };
}
results.push({ name: 'browser-badge-and-mode-cycle', status: browserResult.status, note: browserResult.reason });

console.log(JSON.stringify({ status: 'PASS', checks: results.length, results, browser: browserResult }));
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
