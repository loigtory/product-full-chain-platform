const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const dir = 'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/ui-review';
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(600);
  const go = (p) => page.evaluate((x) => window.PFC.go(x), p);
  async function shot(name) {
    await page.waitForTimeout(260);
    await page.screenshot({ path: dir + '/' + name + '.png' });
  }
  await shot('01-home');
  await go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' });
  await shot('02-work-terminal');
  await go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'canvas' });
  await shot('03-work-canvas');
  await go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'evidence' });
  await shot('04-work-evidence');
  // 消息增强区：附件+引用+停止
  await go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' });
  await page.click('[data-action="attach-menu"]');
  await page.waitForTimeout(250);
  await shot('05-attach-menu');
  await page.click('[data-action="attach-material-ref"]');
  await page.waitForTimeout(250);
  await page.click('[data-action="pick-ref"]').catch(() => {});
  await page.waitForTimeout(250);
  await page.evaluate(() => window.PFC.enqueueFile(new File(['# 理赔材料清单\n1. 身份证'], '理赔材料.md', { type: 'text/markdown' })));
  await page.waitForTimeout(400);
  await page.fill('#chat-input', '把 30 天改为 45 天');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(900);
  await shot('06-msg-enrich');
  await page.click('[data-action="accept-diff"]').catch(() => {});
  await page.waitForTimeout(300);
  // 产品空间各 tab
  await go({ route: 'product', req: 'R-1042', productTab: 'requirements' });
  await shot('07-product-reqs');
  await go({ route: 'product', req: 'R-1042', productTab: 'materials' });
  await shot('08-product-materials');
  await go({ route: 'product', req: 'R-1042', productTab: 'artifacts' });
  await shot('09-product-artifacts');
  await go({ route: 'product', req: 'R-1042', productTab: 'trace' });
  await shot('10-product-trace');
  await go({ route: 'product', req: 'R-1042', productTab: 'timeline' });
  await shot('11-product-timeline');
  await go({ route: 'delivery' });
  await shot('12-delivery');
  // 治理中心各 tab
  for (const t of ['catalog', 'bind', 'team', 'workspace', 'audit']) {
    await go({ route: 'gov', govTab: t });
    await shot('13-gov-' + t);
  }
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
