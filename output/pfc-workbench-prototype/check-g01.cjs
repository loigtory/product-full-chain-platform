const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(500);

  // G01：用真实工厂创建新需求模拟另一窗口写入
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.makeRequirement ? P.makeRequirement('R-NEW', '另一窗口新建需求', '测试', 'idea') : null;
    const s = JSON.parse(localStorage.getItem(P.KEY));
    s.revision += 5;
    if (q) s.reqs['R-NEW'] = q;
    localStorage.setItem(P.KEY, JSON.stringify(s));
    window.dispatchEvent(new StorageEvent('storage', { key: P.KEY, newValue: JSON.stringify(s) }));
  });
  await page.waitForTimeout(300);
  await page.click('[data-action="navigate"][data-route="product"]').catch(() => {});
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => {
    const P = window.PFC;
    const stored = JSON.parse(localStorage.getItem(P.KEY));
    return {
      conflict: P.conflict,
      route: P.s.ui.route,
      newReqStillExists: !!stored.reqs['R-NEW'],
      newReqHasArtifacts: stored.reqs['R-NEW'] ? typeof stored.reqs['R-NEW'].artifacts.idea : '(none)',
      productRendered: !!document.querySelector('.guide-page h1'),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
