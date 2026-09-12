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

  // ===== 1. 跨需求隔离（A03/A04） =====
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' }));
  await page.waitForTimeout(300);
  // R-1042 加附件 + 引用材料
  await page.evaluate(() => window.PFC.enqueueFile(new File(['x'], 'a.txt', { type: 'text/plain' })));
  await page.waitForTimeout(300);
  await page.click('[data-action="attach-menu"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="attach-material-ref"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="pick-ref"]').catch(() => {});
  await page.waitForTimeout(200);
  const bag1042Before = await page.evaluate(() => {
    const b = window.PFC.s.ui.pending['R-1042'];
    return b ? { atts: b.atts.length, refs: b.refs.length } : null;
  });
  // 切到 R-1031：composer 应无队列/引用/回复
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1031', stage: 'accept', panel: 'terminal' }));
  await page.waitForTimeout(300);
  const bag1031 = await page.evaluate(() => {
    const b = window.PFC.s.ui.pending['R-1031'];
    const tray = document.querySelector('.composer .attach-tray, .composer .ref-tray');
    return { hasBag: !!b, atts: b ? b.atts.length : -1, refs: b ? b.refs.length : -1, trayShown: !!tray };
  });
  // R-1031 发送 → 消息应无附件/引用
  await page.fill('#chat-input', '确认验收范围');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(600);
  const msg1031 = await page.evaluate(() => {
    const q = window.PFC.r();
    const m = [...q.messages].reverse().find(x => x.role === 'user');
    return { attachments: (m.attachments || []).length, refs: (m.refs || []).length };
  });
  // 切回 R-1042：队列和引用应还在
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' }));
  await page.waitForTimeout(300);
  const bag1042After = await page.evaluate(() => {
    const b = window.PFC.s.ui.pending['R-1042'];
    return b ? { atts: b.atts.length, refs: b.refs.length } : null;
  });
  out.isolation = { bag1042Before, bag1031, msg1031, bag1042After };

  // ===== 2. 权限校验（A05）：登记受限材料后引用列表禁用 + pick-ref 拒绝 =====
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.materials.push({
      id: 'M-LOCK-1', name: '受限合同扫描件', version: 1, type: 'pdf', size: 1024,
      content: '', classification: '受限', allowed: false, status: '已登记', createdAt: new Date().toISOString(),
    });
  });
  await page.click('[data-action="attach-menu"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="attach-material-ref"]');
  await page.waitForTimeout(200);
  const lockUi = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.search-results .btn')];
    const lock = btns.find(x => x.textContent.includes('受限合同扫描件'));
    return {
      lockDisabled: lock ? lock.disabled : null,
      lockNote: lock ? lock.textContent.trim() : '(not found)',
    };
  });
  let pickErr = '';
  await page.evaluate(() => window.PFC.close());
  try {
    await page.evaluate(() => window.PFC.actions['pick-ref']({ kind: 'material', id: 'M-LOCK-1' }));
  } catch (e) { pickErr = e.message; }
  out.permission = { lockUi, pickErr };

  // ===== 3. 原子保存（D01）：idea 阶段采纳 Diff 后立即持久化 =====
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'canvas' }));
  await page.waitForTimeout(300);
  await page.fill('#chat-input', '把 30 天改为 45 天');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(700);
  const diffCard = await page.evaluate(() => !!document.querySelector('.diff-card'));
  await page.click('[data-action="accept-diff"]').catch(() => {});
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem(window.PFC.KEY);
    const s = raw ? JSON.parse(raw) : null;
    const q = s ? s.reqs['R-1042'] : null;
    const idea = q ? [...q.artifacts.idea].reverse().find(() => true) : null;
    return {
      ideaVersion: idea ? idea.version : null,
      ideaId: idea ? idea.id : null,
      uiVersion: s ? s.ui.version : null,
      field30: idea ? idea.fields.some(f => String(f.value).includes('45 天')) : null,
    };
  });
  out.atomicSave = { diffCard, saved };

  // ===== 4. 待发送附件预览（A02） =====
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'terminal' }));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.PFC.enqueueFile(new File(['# 标题'], 'note.md', { type: 'text/markdown' })));
  await page.waitForTimeout(400);
  await page.click('.attach-tray .att-card [data-action="open-attachment"]').catch(() => {});
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => {
    const dlg = document.querySelector('.guide-dialog');
    return dlg ? { title: dlg.querySelector('h2')?.textContent || '', hasBody: !!dlg.querySelector('.dialog-body') } : null;
  });
  out.pendingPreview = preview;

  console.log(JSON.stringify(out, null, 1));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
