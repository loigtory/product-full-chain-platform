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

  // ===== A09：消息引用 chips 可点击 → 来源视图 =====
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'terminal' }));
  await page.waitForTimeout(300);
  await page.click('[data-action="attach-menu"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="attach-material-ref"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="pick-ref"]');
  await page.waitForTimeout(200);
  await page.fill('#chat-input', '基于材料确认目标');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(700);
  const chipBtn = await page.evaluate(() => {
    const c = document.querySelector('.msg-refs .ref-chip');
    return c ? { action: c.dataset.action, idx: c.dataset.idx, isButton: c.tagName } : '(none)';
  });
  await page.click('.msg-refs .ref-chip');
  await page.waitForTimeout(300);
  out.a09 = await page.evaluate((chipBtn) => {
    const dlg = document.querySelector('.guide-dialog');
    return {
      chip: chipBtn,
      dialogTitle: dlg ? dlg.querySelector('h2')?.textContent : '(none)',
      hasName: dlg ? dlg.textContent.includes('原始想法') : false,
      hasVersion: dlg ? dlg.textContent.includes('v1') : false,
      hasStatus: dlg ? dlg.textContent.includes('状态') : false,
    };
  }, chipBtn);
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(200);

  // ===== G04：影响评估弹窗显示材料明细与队列 =====

  // ===== G04：影响评估弹窗显示材料明细与队列 =====
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.materials.push({ id: 'M-IMP-1', name: '新版积分规则', version: 2, type: '文本', content: '积分 45 天过期改为 60 天，关闭开关后停止触达。', classification: '内部', allowed: true, status: '待影响评估' });
    q.impactList.push('M-IMP-1');
    q.impact = 'M-IMP-1';
    P.save();
  });
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'terminal' }));
  await page.waitForTimeout(300);
  await page.click('[data-action="material-impact"]');
  await page.waitForTimeout(300);
  out.g04 = await page.evaluate(() => {
    const dlg = document.querySelector('.guide-dialog');
    return dlg ? {
      title: dlg.querySelector('h2')?.textContent,
      hasName: dlg.textContent.includes('新版积分规则'),
      hasVersion: dlg.textContent.includes('v2'),
      hasSummary: dlg.textContent.includes('45 天过期改为 60 天'),
      hasImpactCard: !!dlg.querySelector('.impact-card'),
    } : '(none)';
  });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(200);

  // ===== G05：测试批次历史可点击 → 详情 =====
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.stage = 'test';
    P.s.ui.stage = 'test';
    q.runs.push({ id: 'R-TEST', operation: '测试作业', status: 'SUCCEEDED', controller: 'Web', step: 5, pct: 100, exitCode: 0, stamp: P.stamp(q), files: [], logs: [], lines: [] });
    P.testRun(q, false);
    P.testRun(q, true);
    P.save();
  });
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'test', panel: 'terminal' }));
  await page.waitForTimeout(400);
  const batchBtns = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-action="test-batch-detail"]')];
    return btns.map(x => x.textContent.trim().slice(0, 30));
  });
  await page.click('[data-action="test-batch-detail"]');
  await page.waitForTimeout(300);
  out.g05 = await page.evaluate((batchBtns) => {
    const dlg = document.querySelector('.guide-dialog');
    return {
      batchButtons: batchBtns,
      dialogTitle: dlg ? dlg.querySelector('h2')?.textContent : '(none)',
      hasBaseline: dlg ? dlg.textContent.includes('基线') : false,
      hasCaseTable: dlg ? !!dlg.querySelector('table') : false,
      hasDefect: dlg ? dlg.textContent.includes('关联缺陷') : false,
    };
  }, batchBtns);
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(200);

  // ===== G02：只读角色拖拽/粘贴受控反馈（无未处理异常） =====
  await page.evaluate(() => {
    const P = window.PFC;
    P.s.role = 'viewer';
    P.s.viewState = 'normal';
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    P.render();
  });
  await page.waitForTimeout(300);
  // 模拟 paste 图片
  await page.evaluate(() => {
    const dt = new DataTransfer();
    const f = new File(['x'], 'x.png', { type: 'image/png' });
    dt.items.add(f);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.querySelector('#chat-input').dispatchEvent(ev);
  });
  await page.waitForTimeout(400);
  out.g02 = await page.evaluate(() => {
    const toasts = [...document.querySelectorAll('.toast.err')];
    const toast = toasts.at(-1);
    return {
      toastShown: !!toast,
      toastText: toast ? toast.textContent : '(none)',
      noAttachAdded: !document.querySelector('.attach-tray'),
    };
  });

  console.log(JSON.stringify(out, null, 1));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
