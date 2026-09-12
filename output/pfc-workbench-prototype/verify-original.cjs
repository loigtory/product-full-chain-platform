const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push('CONSOLE-ERR: ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(600);
  const steps = [];
  async function snap(label) {
    const info = await page.evaluate(() => {
      const app = document.getElementById('app');
      return { len: app ? app.innerHTML.length : -1, head: (app ? app.textContent : '').slice(0, 110).replace(/\s+/g, ' ') };
    });
    steps.push(label + ' -> len=' + info.len + ' | ' + info.head);
  }
  await snap('首页');
  // 导航：产品空间
  await page.click('[data-action="navigate"][data-route="product"]').catch(() => {});
  await page.waitForTimeout(350);
  await snap('产品空间');
  // 交付中心
  await page.click('[data-action="navigate"][data-route="delivery"]').catch(() => {});
  await page.waitForTimeout(350);
  await snap('交付中心');
  // 治理中心
  await page.click('[data-action="navigate"][data-route="gov"]').catch(() => {});
  await page.waitForTimeout(350);
  await snap('治理中心');
  // 回首页
  await page.click('[data-action="navigate"][data-route="home"]').catch(() => {});
  await page.waitForTimeout(350);
  await snap('回首页');
  // 进入需求工作区（继续作业）
  const openBtn = await page.$('[data-action="open-work"]');
  steps.push('open-work 按钮存在 -> ' + !!openBtn);
  if (openBtn) { await openBtn.click(); await page.waitForTimeout(400); }
  await snap('工作区');
  // 切换需求
  const sw = await page.$('[data-action="switch-req"]');
  steps.push('switch-req 按钮存在 -> ' + !!sw);
  if (sw) { await sw.click(); await page.waitForTimeout(300); }
  const pick = await page.$('[data-action="pick-req"]');
  steps.push('pick-req 选项存在 -> ' + !!pick);
  if (pick) { await pick.click(); await page.waitForTimeout(400); }
  await snap('切换需求后');
  // 发一条消息（澄清）
  const input = await page.$('#chat-input');
  steps.push('chat-input 存在 -> ' + !!input);
  if (input) {
    await input.fill('请确认目标用户的优先级排序');
    await page.click('[data-action="send"]').catch(() => {});
    await page.waitForTimeout(400);
  }
  await snap('发送消息后');
  // 治理 Tab
  await page.click('[data-action="navigate"][data-route="gov"]').catch(() => {});
  await page.waitForTimeout(350);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-action="gov-tab"]')].map(b => b.textContent.trim().slice(0, 12)));
  steps.push('gov-tab -> ' + JSON.stringify(tabs));
  console.log('STEPS:');
  steps.forEach(s => console.log('  ' + s));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (logs.length === 0) console.log('  (no console errors)');
  await page.screenshot({ path: 'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/original-check.png', fullPage: false });
  await browser.close();
})();
