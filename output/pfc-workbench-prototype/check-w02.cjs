const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await p.waitForTimeout(400);
  // 构造第二个作业（新 run R-200 与历史 R-102 并存）
  await p.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.runs.push({
      id: 'R-200', operation: '开发实现·pfc-notify·控制端Web', status: 'RUNNING',
      controller: 'Web', step: 2, pct: 40, exitCode: null, preview: false,
      stamp: P.stamp(q), files: [], logs: ['>_ R-200 新作业'],
    });
  });
  // 搜索历史 R-102 并打开
  await p.click('[data-action="search"]');
  await p.waitForTimeout(200);
  await p.fill('#global-query', 'R-102');
  await p.waitForTimeout(300);
  await p.click('#search-results [data-action="search-open"]');
  await p.waitForTimeout(400);
  const state = await p.evaluate(() => {
    const P = window.PFC;
    const run = P.run(P.r());
    const runList = [...document.querySelectorAll('.run-list .btn')].map(x => ({
      t: x.textContent.trim(), primary: x.classList.contains('primary'),
    }));
    return {
      uiRunId: P.s.ui.runId,
      activeRun: run ? run.id : null,
      runList,
      panelTitle: document.querySelector('#panel-term .panel-title, .panel-body h3')?.textContent || '',
    };
  });
  console.log(JSON.stringify(state, null, 1));
  await b.close();
})();
