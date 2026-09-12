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

  // ===== W02：搜索历史 run 精确定位 =====
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.runs.push({ id: 'R-200', operation: '开发实现·pfc-notify·控制端Web', status: 'RUNNING', controller: 'Web', step: 2, pct: 40, exitCode: null, preview: false, stamp: P.stamp(q), files: [], logs: [], lines: [], git: P.gitMeta(q, 200), budget: 8000, queuePos: 1, limit: 3, scopeId: 'SCOPE-200', verified: false });
  });
  await page.click('[data-action="search"]');
  await page.waitForTimeout(200);
  await page.fill('#global-query', 'R-102');
  await page.waitForTimeout(300);
  await page.click('#search-results [data-action="search-open"]');
  await page.waitForTimeout(400);
  out.w02 = await page.evaluate(() => {
    const P = window.PFC;
    const run = P.run(P.r());
    return { uiRunId: P.s.ui.runId, activeRun: run ? run.id : null };
  });

  // ===== D02：两条建议，点第一条采纳 =====
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'canvas' }));
  await page.waitForTimeout(300);
  await page.fill('#chat-input', '把 30 天改为 45 天');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(900); // 第一条生成完
  await page.fill('#chat-input', '把 30 天改为 60 天');
  await page.click('[data-action="send"]');
  await page.waitForTimeout(900); // 第二条生成完
  // 点第一条消息的采纳按钮
  const firstDiff = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.diff-card')];
    const btn = cards[0]?.querySelector('[data-action="accept-diff"]');
    return btn ? btn.dataset.mid : '(none)';
  });
  await page.click('.diff-card >> nth=0 >> [data-action="accept-diff"]');
  await page.waitForTimeout(400);
  out.d02 = await page.evaluate((firstDiff) => {
    const P = window.PFC;
    const q = P.r();
    const first = q.messages.find(x => x.id === firstDiff);
    const second = [...q.messages].filter(x => x.diff).at(-1);
    const idea = [...q.artifacts.idea].at(-1);
    return {
      firstApplied: first ? first.diffApplied : null,
      secondApplied: second ? second.diffApplied : null,
      appliedField: idea ? idea.fields.find(f => f.name === '目标')?.value.slice(0, 40) : null,
      version: idea ? idea.version : null,
    };
  }, firstDiff);

  // ===== A08：图片原图保留，预览可放大 =====
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'terminal' }));
  await page.waitForTimeout(200);
  // 构造 1200x800 合成图片
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0F766E'; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#fff'; ctx.font = '48px sans-serif'; ctx.fillText('RAW CHECK', 400, 400);
    canvas.toBlob(blob => {
      window.PFC.enqueueFile(new File([blob], 'shot.png', { type: 'image/png' }));
    });
  });
  await page.waitForTimeout(800);
  const raw = await page.evaluate(() => {
    const P = window.PFC;
    const bag = P.s.ui.pending['R-1042'];
    const a = bag ? bag.atts[0] : null;
    return { hasRaw: !!(a && P.raws[a.id]), rawPrefix: a && P.raws[a.id] ? P.raws[a.id].slice(0, 22) : '' };
  });
  // 打开预览，检查 img src 是原图 dataURL（非 160px 缩略图）
  await page.click('.attach-tray .att-card [data-action="open-attachment"]').catch(() => {});
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => {
    const img = document.querySelector('.att-preview-img');
    return img ? { srcPrefix: img.src.slice(0, 22), w: img.naturalWidth } : '(none)';
  });
  out.a08 = { raw, preview };

  // ===== G01：冲突时导航不覆盖共享存储 =====
  await page.evaluate(() => {
    window.PFC.close();
    // 模拟：另一窗口已写入新 revision
    const P = window.PFC;
    const s = JSON.parse(localStorage.getItem(P.KEY));
    s.revision += 5;
    s.reqs['R-NEW'] = { id: 'R-NEW', name: '另一窗口新建需求', stage: 'idea', materials: [], artifacts: {}, messages: [], runs: [], overrides: {}, timeline: [], tests: [], testRuns: [], defects: [], accept: null, release: null, releaseHistory: [], observation: null, impact: null, impactList: [], attachments: [], contextRefs: [], questions: [], units: [], acs: [], owner: '陈立' };
    localStorage.setItem(P.KEY, JSON.stringify(s));
    window.dispatchEvent(new StorageEvent('storage', { key: P.KEY, newValue: JSON.stringify(s) }));
  });
  await page.waitForTimeout(300);
  // 冲突后点击导航"产品空间"（P.go 触发）
  await page.click('[data-action="navigate"][data-route="product"]').catch(() => {});
  await page.waitForTimeout(300);
  out.g01 = await page.evaluate(() => {
    const P = window.PFC;
    const stored = JSON.parse(localStorage.getItem(P.KEY));
    return {
      conflict: P.conflict,
      route: P.s.ui.route,
      newReqStillExists: !!stored.reqs['R-NEW'],
      revision: stored.revision,
    };
  });

  console.log(JSON.stringify(out, null, 1));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
