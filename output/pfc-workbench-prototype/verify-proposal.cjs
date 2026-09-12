const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(500);
  const steps = [];
  // 1) proposal 过期校验：dev 阶段发送触发 proposal，改产物后点按钮
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' }));
  await page.waitForTimeout(300);
  await page.fill('#chat-input', '帮我执行开发构建命令');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(900);
  const propBtn = await page.$('[data-action="plan-run"]');
  steps.push('proposal 按钮出现 -> ' + !!propBtn);
  // 让产物版本变化（模拟其他窗口编辑）：直接 newVersion
  await page.evaluate(() => {
    const P = window.PFC, r = P.r(), v = P.latest(r, 'dev');
    P.newVersion(r, 'dev', v.fields.map(f => ({ ...f, value: f.value + '\n（外部变更）' })));
    P.render();
  });
  await page.waitForTimeout(200);
  await page.click('[data-action="plan-run"]').catch(async () => {
    const P = await page.evaluate(() => window.PFC);
    P && P.r && P.r();
  });
  await page.waitForTimeout(300);
  const toastAfter = await page.evaluate(() => {
    const t = document.querySelector('.toast, #toast');
    return t ? t.textContent : '(none)';
  });
  steps.push('过期后点击 -> toast: ' + toastAfter);
  // 2) 重发：构造一条 failed 的 user 消息
  await page.evaluate(() => {
    const P = window.PFC, r = P.r();
    r.messages.push({ id: 'MSG-TESTFAIL', turnId: 'T-FAIL', role: 'user', stage: 'dev', text: '这条发送失败的消息', attachments: [], refs: [], replyTo: null, status: 'failed', error: '网络中断' });
    P.save(); P.render();
  });
  await page.waitForTimeout(250);
  const resendBtn = await page.$('[data-action="resend-message"]');
  steps.push('重发按钮出现 -> ' + !!resendBtn);
  if (resendBtn) { await resendBtn.click(); await page.waitForTimeout(300); }
  const resent = await page.evaluate(() => {
    const P = window.PFC, r = P.r();
    return r.messages.some(m => m.resent && m.text === '这条发送失败的消息');
  });
  steps.push('重发形成新回合 -> ' + resent);
  console.log('STEPS:');
  steps.forEach(s => console.log('  ' + s));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
