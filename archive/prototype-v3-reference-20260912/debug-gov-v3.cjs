const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push('CONSOLE-ERR: ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index-v3.html');
  await page.waitForTimeout(500);
  const navInfo = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-action="nav"]')];
    return btns.map(b => b.dataset.route + ':' + b.offsetParent !== null);
  });
  console.log('NAV: ' + JSON.stringify(navInfo));
  await page.click('[data-action="nav"][data-route="gov"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const app = document.getElementById('app');
    return {
      text: app.textContent.slice(0, 120).replace(/\s+/g, ' '),
      hasGov: /治理/.test(app.textContent),
      hasConfigTab: !!document.querySelector('[data-action="config-tab"]')
    };
  });
  console.log('AFTER GOV: ' + JSON.stringify(after, null, 2));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no errors)');
  await browser.close();
})();
