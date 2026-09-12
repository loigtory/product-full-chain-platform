const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await p.waitForTimeout(400);
  await p.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' }));
  await p.waitForTimeout(300);
  await p.fill('#chat-input', '把提醒周期说清楚');
  await p.click('[data-action="send"]');
  await p.waitForTimeout(700);
  await p.evaluate(() => {
    const q = window.PFC.r();
    const m = q.messages.find(x => x.role === 'user');
    window.PFC.actions['reply-message']({ id: m.id });
  });
  await p.waitForTimeout(300);
  const tray = await p.evaluate(() => {
    const t = document.querySelector('.reply-tray');
    return t
      ? { text: t.textContent.trim().slice(0, 50), hasCancel: !!t.querySelector('[data-action="clear-reply"]') }
      : '(none)';
  });
  console.log('REPLY TRAY:', JSON.stringify(tray));
  await p.screenshot({ path: 'ui-review/15-reply-tray.png' });
  await b.close();
})();
