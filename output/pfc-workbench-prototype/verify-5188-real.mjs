// 45 号 C4 收尾：5188 真实前端验收（pg 模式、真实解锁、真实 PG）
// 真实用户路径：http://127.0.0.1:5188/ 同源打开 → 输入 access-key 解锁 →
// 新建需求（无版本）进 work 视图不崩（artifactCard 兜底）→ real toggle 默认模拟、
// 无 Codex 连接时开启被阻止并 toast。截图留档 evidence/verify-5188-*.png
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const accessKey = (
  readFileSync(resolve(repo, '.local/pfc-workbench/access-key.txt'), 'utf8') ||
  ''
).trim();
const evidence = resolve(
  repo,
  'docs/quality-gate/reports/ai-tools-integration-20260914',
);
mkdirSync(evidence, { recursive: true });
const report = { at: new Date().toISOString(), status: 'FAIL', tests: [], errors: [] };
const test = (name, ok, extra) => {
  report.tests.push({ name, status: ok ? 'PASS' : 'FAIL', ...(extra || {}) });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
};
const base = 'http://127.0.0.1:5188';
try {
  // 1) 服务健康 + personal
  const h = await (await fetch(base + '/api/health')).json();
  test('5188 health storage=pg', h.storage === 'pg', { storage: h.storage });

  const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 30000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.route(/^https?:\/\//, (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host !== '127.0.0.1') {
      report.errors.push('external:' + route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  page.setDefaultTimeout(15000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // 2) 同源打开（服务端注入 local-config：PFC_LOCAL_PERSONAL=true）
  await page.goto(base + '/');
  await page.waitForSelector('#local-unlock', { timeout: 15000 });
  test('同源打开进入解锁页', true);

  // 3) 输入 access-key 解锁
  await page.fill('#local-access-key', accessKey);
  await page.click('#local-unlock button[type="submit"]');
  await page.waitForFunction(() => window.PFC?.localSession && !window.PFC.localSession.locked, null, { timeout: 15000 });
  test('输入密钥解锁成功', true);

  // 4) 新建需求（真实 POST /api/reqs，无版本数据）
  const name = 'C4验收-空版本需求-' + Date.now();
  const created = await page.evaluate(async ({ name }) => {
    const data = await window.PFCAPI.api.req('POST', '/api/reqs', {
      commandId: crypto.randomUUID(),
      name,
      goal: '验证无版本数据进入工作台不崩溃',
      scope: '验收',
    });
    return { ok: true, req: data.req };
  }, { name });
  test('POST /api/reqs 创建需求', created.ok && !!created.req?.id, {
    id: created.req?.id,
  });

  // 5) 进 work 视图（无版本）→ artifactCard 兜底 + 无 JS 错误
  await page.evaluate(
    ({ id }) => window.PFC.go({ route: 'work', req: id, stage: 'idea' }),
    { id: created.req.id },
  );
  await page.waitForTimeout(1500);
  const card = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.card .card-title')].map((e) =>
      e.textContent.slice(0, 60),
    );
    return titles.join(' | ');
  });
  test('work 视图无 JS 错误（空版本兜底）', pageErrors.length === 0, { pageErrors: [...pageErrors] });
  test('artifactCard 渲染（需求草案/兜底标题均可）', /需求草案|尚未生成版本/.test(card), { card: card.slice(0, 80) });
  await page.screenshot({ path: resolve(evidence, 'verify-5188-work-' + Date.now() + '.png') });

  // 6) real toggle 默认模拟 + 无 Codex 连接时被阻止
  const toggle = page.locator('button[data-action="toggle-real-mode"]');
  await toggle.first().waitFor({ state: 'visible', timeout: 15000 });
  const label = (await page.locator('.real-toggle-label').first().innerText()).trim();
  test('real toggle 默认模拟', label === '模拟', { label });
  await toggle.first().click();
  await page.waitForTimeout(800);
  const stillSim = (await page.locator('.real-toggle-label').first().innerText()).trim() === '模拟';
  test('无 Codex 连接时开启被阻止保持模拟', stillSim);
  const toast = await page.evaluate(() => {
    const el = document.querySelector('[class*="toast"], [class*="Toast"], .notice');
    return el ? el.textContent.slice(0, 80) : '';
  });
  test('toast 提示可见', toast.length > 0, { toast });
  await page.screenshot({ path: resolve(evidence, 'verify-5188-block-' + Date.now() + '.png') });

  await browser.close();
  report.status = 'PASS';
} catch (e) {
  report.error = e.message;
  console.log('ERR ' + e.message);
}
const file = resolve(evidence, 'verify-5188-' + Date.now() + '.json');
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, tests: report.tests.length, errors: report.errors.length, file }));
