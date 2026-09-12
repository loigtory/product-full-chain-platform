const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push('CONSOLE-ERR: ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index-v3.html');
  await page.waitForTimeout(500);
  const steps = [];
  async function snap(label) {
    const info = await page.evaluate(() => {
      const app = document.getElementById('app');
      return { len: app ? app.innerHTML.length : -1, head: (app ? app.textContent : '').slice(0, 90).replace(/\s+/g, ' ') };
    });
    steps.push(label + ' -> len=' + info.len + ' | ' + info.head);
  }
  // 治理中心（正确路由 governance）
  await page.click('[data-action="nav"][data-route="governance"]');
  await page.waitForTimeout(400);
  await snap('治理中心');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-action="config-tab"]')].map(b => b.textContent.trim().slice(0, 10)));
  steps.push('治理 Tab -> ' + JSON.stringify(tabs));
  // 切到阶段绑定
  const bindTab = await page.$$('[data-action="config-tab"]');
  if (bindTab.length > 1) { await bindTab[1].click(); await page.waitForTimeout(250); }
  await snap('治理-阶段绑定');
  // 切换一个绑定
  const b1 = await page.$$('[data-action="toggle-bind"]');
  steps.push('绑定项数 -> ' + b1.length);
  if (b1.length) { await b1[0].click(); await page.waitForTimeout(200); }
  await snap('切换绑定后');
  // 产品空间
  await page.click('[data-action="nav"][data-route="space"]').catch(() => {});
  await page.waitForTimeout(300);
  await snap('产品空间');
  // 交付中心
  await page.click('[data-action="nav"][data-route="delivery"]').catch(() => {});
  await page.waitForTimeout(300);
  await snap('交付中心');
  console.log('STEPS:');
  steps.forEach(s => console.log('  ' + s));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (logs.length === 0) console.log('  (no console errors)');
  await page.screenshot({ path: 'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/v3-check-shot.png' });
  await browser.close();
})();
