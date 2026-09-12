const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push('CONSOLE-ERR: ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index-v3.html');
  await page.waitForTimeout(500);

  async function closeDialog() {
    const open = await page.evaluate(() => { const d = document.getElementById('dialog'); return !!(d && d.open); });
    if (!open) return;
    const confirmBtn = await page.$('#dialog [data-action="confirm-artifact"]');
    if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(200); return; }
    const closeBtn = await page.$('#dialog [data-action="close-dialog"]');
    if (closeBtn) { await closeBtn.click(); await page.waitForTimeout(200); return; }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  const steps = [];
  async function snap(label) {
    const info = await page.evaluate(() => {
      const app = document.getElementById('app');
      return { len: app ? app.innerHTML.length : -1, head: (app ? app.textContent : '').slice(0, 90).replace(/\s+/g, ' ') };
    });
    steps.push(label + ' -> len=' + info.len + ' | ' + info.head);
  }

  await snap('首页');
  const has1056 = await page.evaluate(() => !!document.querySelector('[data-req="R-1056"]'));
  steps.push('R-1056 入口存在 -> ' + has1056);
  if (has1056) {
    await page.click('[data-action="open-req"][data-req="R-1056"]').catch(() => {});
  } else {
    await page.click('[data-action="continue-work"]').catch(() => {});
  }
  await page.waitForTimeout(400);
  await snap('工作空间');
  for (let i = 0; i < 3; i++) {
    await closeDialog();
    const qs = await page.$$('[data-action="answer-question"]');
    if (!qs.length) break;
    await qs[0].click();
    await page.waitForTimeout(150);
  }
  await snap('回答澄清');
  await closeDialog();
  const c = await page.$$('[data-action="confirm-artifact"]');
  if (c.length) { await c[0].click(); await page.waitForTimeout(250); }
  await closeDialog();
  await snap('确认草稿');
  await closeDialog();
  const rs = await page.$$('[data-action="run-step"]');
  if (rs.length) { await rs[0].click(); await page.waitForTimeout(250); }
  await closeDialog();
  await snap('开发推进');
  await page.click('[data-action="switch-req"]').catch(() => {});
  await page.waitForTimeout(250);
  const pr = await page.$$('[data-action="pick-req"]');
  steps.push('需求切换面板项数 -> ' + pr.length);
  if (pr.length) {
    const target = await page.$$('[data-action="pick-req"][data-req="R-1031"]');
    if (target.length) { await target[0].click(); await page.waitForTimeout(300); }
    else { await pr[0].click(); await page.waitForTimeout(300); }
  }
  await closeDialog();
  await snap('切换需求后');
  await page.click('[data-action="nav"][data-route="gov"]').catch(async () => { await page.click('.nav-item[data-action="nav"][data-route="gov"]').catch(() => {}); });
  await page.waitForTimeout(300);
  await snap('治理中心');
  const b = await page.$$('[data-action="config-tab"]');
  steps.push('治理 Tab 数 -> ' + b.length);
  if (b.length > 1) { await b[1].click(); await page.waitForTimeout(250); }
  await snap('治理-阶段绑定');
  await page.click('[data-action="nav"][data-route="home"]').catch(() => {});
  await page.waitForTimeout(250);
  await snap('返回首页');

  console.log('STEPS:');
  steps.forEach(s => console.log('  ' + s));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (logs.length === 0) console.log('  (no console errors)');
  await page.screenshot({ path: 'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/v3-check-shot.png' });
  await browser.close();
})();
