const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const logs = [], downloads = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  page.on('download', d => downloads.push(d.suggestedFilename()));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(500);
  const steps = [];
  const go = (patch) => page.evaluate((p) => { window.PFC.go(p); }, patch);
  async function snap(label) {
    const info = await page.evaluate(() => {
      const app = document.getElementById('app');
      return { len: app ? app.innerHTML.length : -1, head: (app ? app.textContent : '').slice(0, 60).replace(/\s+/g, ' ') };
    });
    steps.push(label + ' -> len=' + info.len + ' | ' + info.head);
  }
  // 1) 治理中心 5 Tab（UI 导航）
  await page.click('[data-action="navigate"][data-route="gov"]');
  await page.waitForTimeout(300);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-action="gov-tab"]')].map(x => x.textContent.trim()));
  steps.push('治理 Tab -> ' + JSON.stringify(tabs));
  // 2) 交付中心 + 交付包下载
  await page.click('[data-action="navigate"][data-route="delivery"]');
  await page.waitForTimeout(300);
  await snap('交付中心');
  await page.click('[data-action="deliver-package"]');
  await page.waitForTimeout(400);
  // 3) 产品空间
  await page.click('[data-action="navigate"][data-route="product"]');
  await page.waitForTimeout(300);
  await snap('产品空间');
  // 4) 工作区
  await go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal', runId: null });
  await page.waitForTimeout(350);
  await snap('工作区(dev)');
  const chatInput = await page.$('#chat-input');
  steps.push('chat-input 存在 -> ' + !!chatInput);
  // 5) Diff（idea 阶段）
  await go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'terminal' });
  await page.waitForTimeout(250);
  await page.fill('#chat-input', '把 24 小时改为 48 小时');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(800);
  const diffCard = await page.evaluate(() => {
    const d = document.querySelector('.diff-card');
    return d ? d.textContent.replace(/\s+/g, ' ').slice(0, 90) : '(none)';
  });
  steps.push('idea Diff 卡 -> ' + diffCard);
  if (diffCard !== '(none)') {
    await page.click('[data-action="accept-diff"]');
    await page.waitForTimeout(300);
    const v = await page.evaluate(() => {
      const P = window.PFC, latest = P.latest(P.r(), 'idea');
      return latest ? latest.id + ' v' + latest.version : '(none)';
    });
    steps.push('采纳后 idea 版本 -> ' + v);
  }
  // 6) 引用 + 附件发送
  await go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' });
  await page.waitForTimeout(250);
  await page.click('[data-action="attach-menu"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="attach-material-ref"]');
  await page.waitForTimeout(200);
  const pickRefs = await page.$$('[data-action="pick-ref"]');
  steps.push('可引用材料数 -> ' + pickRefs.length);
  if (pickRefs.length) { await pickRefs[0].click(); await page.waitForTimeout(200); }
  await page.evaluate(() => {
    const P = window.PFC;
    P.enqueueFile(new File(['# 理赔材料清单\n1. 身份证\n2. 事故证明'], '理赔材料.md', { type: 'text/markdown' }));
  });
  await page.waitForTimeout(400);
  await page.fill('#chat-input', '结合材料确认范围');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(800);
  const enrich = await page.evaluate(() => ({
    refs: !!document.querySelector('.msg-refs'),
    atts: !!document.querySelector('.msg-atts'),
    msgs: document.querySelectorAll('.msg').length,
  }));
  steps.push('发送后 -> 引用:' + enrich.refs + ' 附件:' + enrich.atts + ' 消息数:' + enrich.msgs);
  // 7) 停止答复
  await page.fill('#chat-input', '请分析当前需求范围并给出下一步建议，需要详细说明处理优先级、依赖与风险');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(120);
  const stopBtn = await page.$('[data-action="stop-reply"]');
  steps.push('停止按钮 -> ' + !!stopBtn);
  if (stopBtn) { await stopBtn.click(); await page.waitForTimeout(300); }
  const stopped = await page.evaluate(() => [...document.querySelectorAll('.msg-note')].map(x => x.textContent).join('|'));
  steps.push('停止状态 -> ' + (stopped || '(none)'));
  // 8) 引用回复 + 消息引用行
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.msg-actions [data-action="reply-message"]')][0];
    if (btn) btn.click();
  });
  await page.waitForTimeout(250);
  const replyBar = await page.evaluate(() => window.PFC.s.ui.replyTarget || '(none)');
  steps.push('引用回复目标 -> ' + replyBar);
  await page.fill('#chat-input', '补充确认');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(500);
  const quoteShown = await page.evaluate(() => !!document.querySelector('.msg-quote'));
  steps.push('消息引用行 -> ' + quoteShown);
  // 9) 工作区文件
  await page.evaluate(() => {
    const P = window.PFC, r = P.r(), run = P.run(r);
    run.status = 'SUCCEEDED'; run.pct = 100; run.step = 6; run.exitCode = 0; run.verified = true;
    run.files = [
      { path: 'src/feature/service.ts', status: 'M', kind: 'code', lines: '+38 −12', preview: 'export async function handleExpiryNotify() {}\n' },
      { path: 'src/feature/expiry.test.ts', status: 'A', kind: 'test', lines: '+86 −0', preview: "describe('expiry notify', () => {})\n" },
    ];
    P.save(); P.render();
  });
  await page.waitForTimeout(300);
  const wsFiles = await page.evaluate(() => [...document.querySelectorAll('.ws-file .ws-path')].map(x => x.textContent));
  steps.push('工作区文件 -> ' + JSON.stringify(wsFiles));
  if (wsFiles.length) {
    await page.click('.ws-file .btn');
    await page.waitForTimeout(250);
    const modal = await page.evaluate(() => document.querySelector('.guide-dialog h2')?.textContent || '(none)');
    steps.push('文件预览 -> ' + modal);
    await page.click('.guide-dialog button[data-action="close-modal"]', { force: true }).catch(async () => {
      await page.evaluate(() => { const P = window.PFC; if (P.close) P.close(); });
    });
    await page.waitForTimeout(150);
  }
  // 10) 产物下载
  await go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'canvas' });
  await page.waitForTimeout(250);
  await page.click('[data-action="download-artifact"]');
  await page.waitForTimeout(400);
  console.log('STEPS:');
  steps.forEach(s => console.log('  ' + s));
  console.log('DOWNLOADS: ' + JSON.stringify(downloads));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await page.screenshot({ path: 'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/final-check.png' });
  await browser.close();
})();
