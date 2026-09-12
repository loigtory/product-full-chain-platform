const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(500);
  const out = {};
  // 1) 首页导航 active
  const navHome = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.nav-item')];
    return nav.find(x => x.classList.contains('active'))?.textContent.trim() || '(none)';
  });
  out.navHome = navHome;
  // 2) 工作区导航 active + composer 图标
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' }));
  await page.waitForTimeout(350);
  out.navWork = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.nav-item')];
    const active = nav.find(x => x.classList.contains('active'))?.textContent.trim() || '(none)';
    const attch = document.querySelector('.attch-btn svg')?.outerHTML.slice(0, 60) || '(none)';
    return { active, attchHasPath: attch.includes('m21.4 11.05') };
  });
  // 3) 引用 chips 蓝色 + 附件 + 发送
  await page.click('[data-action="attach-menu"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="attach-material-ref"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="pick-ref"]').catch(() => {});
  await page.waitForTimeout(200);
  await page.evaluate(() => window.PFC.enqueueFile(new File(['# 材料'], 'm.md', { type: 'text/markdown' })));
  await page.waitForTimeout(400);
  await page.fill('#chat-input', '确认范围');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(800);
  out.msg = await page.evaluate(() => {
    const chip = document.querySelector('.msg-refs .ref-chip');
    const cs = chip ? getComputedStyle(chip) : null;
    return {
      chipBg: cs ? cs.backgroundColor : '(none)',
      chipColor: cs ? cs.color : '(none)',
      attCard: !!document.querySelector('.msg-atts .att-card'),
      userMsg: !!document.querySelector('.msg.user'),
    };
  });
  // 4) 错误 toast 语义色
  await page.evaluate(() => {
    const P = window.PFC;
    P.s.ui.stage = 'idea';
    P.s.ui.replyTarget = null;
    P.s.ui.pendingRefs = [];
    P.s.ui.pendingAttachments = [];
    P.s.ui.drafts = {};
    // 触发一个断言错误：发送空消息
  });
  await page.waitForTimeout(100);
  await page.fill('#chat-input', '');
  await page.click('[data-action="send"]').catch(() => {});
  await page.waitForTimeout(300);
  out.errToast = await page.evaluate(() => {
    const t = document.querySelector('.toast.err');
    return t ? { text: t.textContent.slice(0, 20), bg: getComputedStyle(t).backgroundColor } : '(none)';
  });
  // 5) 错误 toast 正常路径（无附件时）
  await page.screenshot({ path: 'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/ui-review/14-final-work.png' });
  console.log(JSON.stringify(out, null, 1));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
