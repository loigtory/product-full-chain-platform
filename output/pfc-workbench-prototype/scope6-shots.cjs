const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.accept = { status: 'ACCEPTED', note: 'x', actor: '陈立' };
    q.stage = 'release';
    P.s.ui.stage = 'release';
    P.requestRelease(q, { target: '生产', scope: '积分提醒 3 服务', rollback: '回滚开关 + 版本回退', hours: 48 });
    P.save();
    P.go({ route: 'work', req: 'R-1042', stage: 'release', panel: 'terminal' });
  });
  await page.waitForTimeout(400);
  await page.click('[data-action="release-action"][data-control="approve"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-01-release-snapshot.png', fullPage: true });

  // 执行发布 → observe 卡
  await page.click('[data-action="release-action"][data-control="execute"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.observation.startedAt = Date.now() - 30 * 3600000;
    q.observation.entries = [
      { at: new Date(Date.now() - 2 * 3600000).toISOString(), metrics: '首日转化 +12%（模拟指标）', source: '成员录入', releaseStamp: q.release.snapshot.stamp },
      { at: new Date(Date.now() - 1 * 3600000).toISOString(), metrics: '次日留存 +6%（模拟指标）', source: '成员录入', releaseStamp: q.release.snapshot.stamp },
    ];
    q.observation.followups = [{ text: '灰度观察一周', owner: '李婷', status: '进行中' }, { text: '沉淀提醒触达规则', owner: '陈立', status: '待处理' }];
    P.save();
    P.go({ route: 'work', req: 'R-1042', stage: 'observe', panel: 'terminal' });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-02-observe.png', fullPage: true });

  // runCard（git 行 + 队列）
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.stage = 'dev';
    P.s.ui.stage = 'dev';
    if (!q.runs.some(x => x.id === 'R-DEV6')) {
      q.runs.push({ id: 'R-DEV6', parentId: null, status: 'SUCCEEDED', pct: 100, step: 5, operation: '开发实现', controller: 'Web', scope: '项目文件、Git 只读…', snapshot: [], stamp: P.stamp(q), git: P.gitMeta(q, 7), budget: 9000, queuePos: 1, limit: 3, lines: [{ cls: 'info', text: '[bridge] 已绑定 pfc-notify · main · c1a2b3c · 工作区干净' }], verified: true, exitCode: 0, preview: false, scopeId: 'SCOPE-D6', files: [{ path: 'src/feature/service.ts', status: 'M', kind: 'code', lines: '+38 −12', before: 'export async function handleExpiryNotify(userId: string) {\n  const plan = await loadPlan(userId);\n  if (!plan?.expiresAt) return;\n  if (hours <= 24 && plan.notified) return;\n}', preview: 'export async function handleExpiryNotify(userId: string) {\n  const plan = await loadPlan(userId);\n  if (!plan?.expiresAt) return;\n  const hours = diffHours(plan.expiresAt, new Date());\n  if (hours <= 24 && !plan.notifiedAt) {\n    await enqueueReminder(userId, { hours });\n  }\n}' }, { path: 'src/feature/expiry.test.ts', status: 'A', kind: 'test', lines: '+86 −0', before: '//（新增测试文件，无前置版本）', preview: "describe('expiry notify', () => {\n  it('enqueues within 24h', async () => { expect(1).toBe(1); });\n});\n" }] });
      P.save();
    }
    P.s.ui.runId = 'R-DEV6';
    P.s.ui.panel = 'terminal';
    P.go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-03-run-git.png', fullPage: true });
  await page.click('[data-action="open-ws-file"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-04-file-diff.png', fullPage: true });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(200);

  // trace 分工矩阵
  await page.evaluate(() => window.PFC.go({ route: 'product', req: 'R-1042', productTab: 'trace' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-05-trace-units.png', fullPage: true });
  await page.click('[data-action="unit-owner"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-06-unit-owner.png', fullPage: true });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(200);

  // governance 角色矩阵
  await page.evaluate(() => window.PFC.go({ route: 'governance', govTab: 'team' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-07-role-matrix.png', fullPage: true });

  // 交付中心当前结论
  await page.evaluate(() => window.PFC.go({ route: 'delivery' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-08-delivery.png', fullPage: true });

  // 附件解析视图
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'terminal' }));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const P = window.PFC;
    const bag = P.uiBag();
    bag.atts = [
      { id: 'S-1', name: '需求说明.pdf', size: '880 KB', type: 'pdf', status: 'ready', content: '（演示解析）已接收 PDF，正文提取与结构化属于正式接入。共 12 页，覆盖需求说明、交互流程与验收清单。', meta: { origin: 'binary', pages: 12, fullInMemory: false } },
      { id: 'S-2', name: '长文.txt', size: '58.6 KB', type: 'text', status: 'ready', content: 'A'.repeat(2000), meta: { origin: 'text', charCount: 60000, truncated: true, fullInMemory: true } },
      { id: 'S-3', name: '截图.png', size: '1.2 MB', type: 'image', status: 'ready', thumb: 'data:image/png;base64,iVBORw0KGgo=', meta: { origin: 'image', rawInMemory: true } },
    ];
    P.raws['S-3'] = 'data:image/png;base64,iVBORw0KGgo=';
    P.save();
    P.render();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-09-attach-tray.png', fullPage: true });
  await page.click('[data-action="open-attachment"][data-id="S-1"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-10-attach-pdf.png', fullPage: true });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(200);

  // diff-full 完整视图
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.messages.push({ id: 'M-S6', role: 'agent', stage: 'idea', time: Date.now(), text: '建议调整目标描述', diff: { fields: [{ name: '目标', before: '原目标描述较泛，缺少衡量标准', after: '提前触达积分即将过期的会员，减少积分浪费，提升 App 活跃与满意度' }, { name: '范围', before: '仅短信通道', after: 'App 推送 + 短信双通道' }] }, diffApplied: false, diffRejected: false });
    P.save();
    P.render();
  });
  await page.waitForTimeout(300);
  await page.click('[data-action="diff-full"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-11-diff-full.png', fullPage: true });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(200);

  // msg-source 引用来源
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.messages.push({ id: 'M-S6B', role: 'user', stage: 'idea', time: Date.now() - 3600000, text: '原始想法：会员积分过期要提前提醒', attachments: [{ id: 'A1', name: '调研.docx', size: '10 KB' }] });
    q.messages.push({ id: 'M-S6C', role: 'agent', stage: 'idea', time: Date.now(), text: '已确认目标', replyTo: 'M-S6B' });
    P.save();
    P.render();
  });
  await page.waitForTimeout(300);
  await page.click('button.msg-quote.link');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-review/s6-12-msg-source.png', fullPage: true });

  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
