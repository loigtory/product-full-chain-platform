const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'terminal' }));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => {
    const P = window.PFC, v = P.latest(P.r(), 'idea');
    return v.id + ' v' + v.version + ' | ' + v.fields.map(f => f.name + ':' + (f.value || '').slice(0, 30)).join(' // ');
  });
  await page.fill('#chat-input', '把 30 天改为 45 天');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(900);
  const diff = await page.evaluate(() => {
    const d = document.querySelector('.diff-card');
    return d ? d.textContent.replace(/\s+/g, ' ').slice(0, 160) : '(none)';
  });
  const diffBtn = await page.$('[data-action="accept-diff"]');
  if (diffBtn) { await diffBtn.click(); await page.waitForTimeout(350); }
  const after = await page.evaluate(() => {
    const P = window.PFC, v = P.latest(P.r(), 'idea');
    const stale = P.D.STAGES.filter(s => P.latest(P.r(), s.id) && P.latest(P.r(), s.id).stale).map(s => s.id);
    return { id: v.id, version: v.version, stale, panel: P.s.ui.panel, artifactStage: P.s.ui.artifactStage };
  });
  console.log('BEFORE: ' + before);
  console.log('DIFF: ' + diff);
  console.log('AFTER: ' + JSON.stringify(after));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await page.screenshot({ path: 'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/diff-check.png' });
  await browser.close();
})();
