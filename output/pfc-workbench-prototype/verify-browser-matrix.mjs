/* 浏览器兼容矩阵：Chrome / Firefox × 三档布局 smoke。
 * 入口：index.html（file://），路由 home/work/product/delivery/gov。
 * 断言：无横向溢出、头部 52px、图标 ≤ 32px、页面无 JS 报错。
 * Firefox 未安装时该浏览器组如实标记 SKIP，不伪装覆盖。
 */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url)),
  url = pathToFileURL(join(root, 'index.html')).href;
const evidence = await mkdtemp(join(tmpdir(), 'pfc-matrix-'));
const WIDTHS = [1280, 1440, 1920];
const ROUTES = ['home', 'work', 'product', 'delivery', 'gov'];
const results = [],
  errors = [];
let failed = false;
const engines = [
  { name: 'chrome', launch: () => chromium.launch({ channel: 'chrome', headless: true }) },
  { name: 'firefox', launch: () => firefox.launch({ headless: true }) },
];
for (const engine of engines) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (error) {
    results.push({
      engine: engine.name,
      status: 'SKIP',
      error: '本机未安装该浏览器运行环境：' + error.message.split('\n')[0],
    });
    console.log(JSON.stringify(results.at(-1)));
    continue;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(15000);
  const localErrors = [];
  page.on('pageerror', (e) => localErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') localErrors.push(m.text());
  });
  await page.route(/^https?:/, (r) => r.abort());
  let ok = true;
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 960 });
    for (const route of ROUTES) {
      const name = `${engine.name} ${route}@${width}`;
      try {
        await page.goto(url + '#/' + route);
        await page.evaluate(() => localStorage.removeItem(window.PFC.KEY));
        await page.reload();
        await page.locator('#global-header .brand').waitFor();
        const d = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          width: innerWidth,
          header: document.querySelector('#global-header').getBoundingClientRect().height,
          maxIcon: Math.max(
            0,
            ...[...document.querySelectorAll('svg')].map(
              (s) => s.getBoundingClientRect().width,
            ),
          ),
          grid: (document.querySelector('.guide-grid')?.children.length) || 0,
        }));
        assert.ok(d.scroll <= d.width, JSON.stringify(d));
        assert.equal(d.header, 52, JSON.stringify(d));
        assert.ok(d.maxIcon <= 32, JSON.stringify(d));
        if (route === 'home') assert.ok(d.grid >= 1, 'home 需有卡片');
        await page.screenshot({ path: join(evidence, `${engine.name}-${route}-${width}.png`) });
        results.push({ engine: engine.name, case: name, status: 'PASS' });
        console.log(JSON.stringify({ engine: engine.name, case: name, status: 'PASS' }));
      } catch (error) {
        ok = false;
        results.push({ engine: engine.name, case: name, status: 'FAIL', error: error.message });
        console.log(JSON.stringify({ engine: engine.name, case: name, status: 'FAIL', error: error.message }));
      }
    }
  }
  if (localErrors.length) {
    failed = true;
    errors.push({ engine: engine.name, errors: localErrors.slice(0, 5) });
  }
  if (!ok) failed = true;
  await browser.close();
}
const report = {
  status: failed ? 'FAIL' : 'PASS',
  results,
  errors,
  evidence,
  environment: 'Windows / project Node / file:// / isolated page HTTP(S) blocked',
  data: 'deterministic local prototype factory; isolated context destroyed per engine',
};
await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exitCode = failed ? 1 : 0;
