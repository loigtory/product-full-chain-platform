const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('file:///D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/index.html');
  await page.waitForTimeout(600);
  const out = {};
  const P = () => page.evaluate(() => window.PFC);

  // ============ 领域1：文件解析与留存 ============
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'idea', panel: 'terminal' }));
  await page.waitForTimeout(250);
  // text 附件：截断 + meta
  await page.evaluate(() => {
    const P = window.PFC;
    const bag = P.uiBag();
    const long = 'A'.repeat(60000);
    bag.atts.push({ id: 'ATT-TXT', name: '长文.txt', size: '58.6 KB', type: 'text', status: 'ready', content: long.slice(0, 50000), meta: { origin: 'text', charCount: 60000, truncated: true, fullInMemory: true } });
    P.render();
  });
  await page.waitForTimeout(200);
  await page.click('[data-action="open-attachment"][data-id="ATT-TXT"]');
  await page.waitForTimeout(250);
  out.d1_text = await page.evaluate(() => {
    const dlg = document.querySelector('.guide-dialog');
    return dlg ? {
      truncated: dlg.textContent.includes('已截断至 50,000'),
      hasOrigin: dlg.textContent.includes('原件'),
      hasDownload: !!dlg.querySelector('[data-action="download-attachment-text"]'),
      hasCharCount: dlg.textContent.includes('60,000'),
    } : '(none)';
  });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(150);
  // image 附件：原件预览
  await page.evaluate(() => {
    const P = window.PFC;
    const bag = P.uiBag();
    bag.atts.push({ id: 'ATT-IMG', name: '截图.png', size: '1.2 MB', type: 'image', status: 'ready', thumb: 'data:image/png;base64,iVBORw0KGgo=', meta: { origin: 'image', rawInMemory: true } });
    P.raws['ATT-IMG'] = 'data:image/png;base64,iVBORw0KGgo=';
    P.render();
  });
  await page.waitForTimeout(200);
  await page.click('[data-action="open-attachment"][data-id="ATT-IMG"]');
  await page.waitForTimeout(250);
  out.d1_image = await page.evaluate(() => {
    const dlg = document.querySelector('.guide-dialog');
    return dlg ? {
      hasPreview: !!dlg.querySelector('.att-preview-img'),
      hasOriginLabel: dlg.textContent.includes('原件预览'),
    } : '(none)';
  });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(150);
  // pdf 附件：类型化解析摘要
  await page.evaluate(() => {
    const P = window.PFC;
    const bag = P.uiBag();
    bag.atts.push({ id: 'ATT-PDF', name: '需求说明.pdf', size: '880 KB', type: 'pdf', status: 'ready', content: '（演示解析）已接收 PDF，正文提取与结构化属于正式接入。共 12 页，覆盖需求说明、交互流程与验收清单。', meta: { origin: 'binary', pages: 12, fullInMemory: false } });
    P.render();
  });
  await page.waitForTimeout(200);
  await page.click('[data-action="open-attachment"][data-id="ATT-PDF"]');
  await page.waitForTimeout(250);
  out.d1_pdf = await page.evaluate(() => {
    const dlg = document.querySelector('.guide-dialog');
    return dlg ? {
      hasPages: dlg.textContent.includes('12 页'),
      hasDemoLabel: dlg.textContent.includes('演示解析'),
      hasSize: dlg.textContent.includes('880 KB'),
    } : '(none)';
  });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(150);

  // ============ 领域2：对话与差异 ============
  // diff-full 完整视图
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.messages.push({ id: 'M-DIFF', role: 'agent', stage: 'idea', time: Date.now(), text: '建议调整目标描述', diff: { fields: [{ name: '目标', before: '原目标描述…', after: '新目标描述…' }, { name: '范围', before: '原范围…', after: '新范围…' }] }, diffApplied: false, diffRejected: false });
    P.save();
    P.render();
  });
  await page.waitForTimeout(250);
  await page.click('[data-action="diff-full"]');
  await page.waitForTimeout(250);
  out.d2_diff = await page.evaluate(() => {
    const dlg = document.querySelector('.guide-dialog');
    return dlg ? {
      title: dlg.querySelector('h2')?.textContent,
      fieldCount: dlg.querySelectorAll('.diff-block').length,
      hasBefore: dlg.textContent.includes('之前') && dlg.textContent.includes('原目标描述'),
      hasAfter: dlg.textContent.includes('之后') && dlg.textContent.includes('新目标描述'),
      hasAccept: !!dlg.querySelector('[data-action="accept-diff"]'),
    } : '(none)';
  });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(150);
  // msg-source 引用来源
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    if (!q.messages.some(m => m.id === 'M-SRC')) {
      q.messages.push({ id: 'M-SRC', role: 'user', stage: 'idea', time: Date.now() - 3600000, text: '原始想法：会员积分过期要提前提醒', attachments: [{ id: 'A1', name: '调研.docx', size: '10 KB' }] });
      q.messages.push({ id: 'M-REPLY', role: 'agent', stage: 'idea', time: Date.now(), text: '已确认目标', replyTo: 'M-SRC' });
      P.save();
    }
    P.render();
  });
  await page.waitForTimeout(250);
  const quoteInfo = await page.evaluate(() => {
    const b = document.querySelector('button.msg-quote.link');
    return b ? { isButton: true, hasAction: b.dataset.action === 'msg-source', text: b.textContent.slice(0, 20) } : '(none)';
  });
  if (quoteInfo !== '(none)') {
    await page.click('button.msg-quote.link');
    await page.waitForTimeout(250);
    out.d2_source = await page.evaluate((quoteInfo) => {
      const dlg = document.querySelector('.guide-dialog');
      return {
        quote: quoteInfo,
        title: dlg?.querySelector('h2')?.textContent,
        hasStage: dlg?.textContent.includes('想法 阶段'),
        hasText: dlg?.textContent.includes('原始想法'),
        hasAttach: dlg?.textContent.includes('调研.docx'),
      };
    }, quoteInfo);
    await page.evaluate(() => window.PFC.close());
    await page.waitForTimeout(150);
  } else out.d2_source = '(no quote)';

  // ============ 领域3：执行 / 工作区 ============
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'dev', panel: 'terminal' }));
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    if (!q.runs.some(x => x.id === 'R-DEV3')) {
      q.runs.push({ id: 'R-DEV3', parentId: null, status: 'SUCCEEDED', pct: 100, step: 5, operation: '开发实现', controller: 'Web', scope: '项目文件、Git 只读…', snapshot: [], stamp: P.stamp(q), git: P.gitMeta(q, 42), budget: 9000, queuePos: 1, limit: 3, lines: [{ cls: 'info', text: '[bridge] 已绑定' }], verified: true, exitCode: 0, preview: false, scopeId: 'SCOPE-D3', files: [] });
      P.save();
    }
    P.s.ui.runId = 'R-DEV3';
    P.s.ui.panel = 'terminal';
    P.render();
  });
  await page.waitForTimeout(250);
  out.d3_run = await page.evaluate(() => {
    const el = document.querySelector('.rail-run, [data-context]');
    const text = document.body.textContent;
    return {
      hasRepo: text.includes('仓库'),
      hasBranchCommit: /分支 \/ 提交/.test(text) && /feature|main/.test(text),
      hasQueue: text.includes('执行队列') && text.includes('预算'),
      hasDirtyBadge: text.includes('dirty'),
    };
  });
  // open-ws-file before/after
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    const run = q.runs.find(x => x.id === 'R-DEV3');
    if (run) run.files = [{ path: 'src/feature/service.ts', status: 'M', kind: 'code', lines: '+38 −12', before: '旧代码内容', preview: '新代码内容' }];
    P.save();
    P.render();
  });
  await page.waitForTimeout(200);
  const wsBtn = await page.evaluate(() => {
    const b = document.querySelector('[data-action="open-ws-file"]');
    return b ? b.dataset.file : '(none)';
  });
  if (wsBtn !== '(none)') {
    await page.click('[data-action="open-ws-file"]');
    await page.waitForTimeout(250);
    out.d3_file = await page.evaluate(() => {
      const dlg = document.querySelector('.guide-dialog');
      return dlg ? {
        hasBeforeLabel: dlg.textContent.includes('变更前'),
        hasAfterLabel: dlg.textContent.includes('变更后'),
        hasBeforeContent: dlg.textContent.includes('旧代码内容'),
        hasAfterContent: dlg.textContent.includes('新代码内容'),
        hasGitHead: dlg.textContent.includes('@'),
        isTwoCol: !!dlg.querySelector('.diff-cols'),
      } : '(none)';
    });
    await page.evaluate(() => window.PFC.close());
    await page.waitForTimeout(150);
  } else out.d3_file = '(no ws file btn)';

  // ============ 领域4：CAP 与分工 ============
  await page.evaluate(() => window.PFC.go({ route: 'product', req: 'R-1042', productTab: 'trace' }));
  await page.waitForTimeout(250);
  out.d4_trace = await page.evaluate(() => {
    const t = document.querySelector('.data-table');
    return t ? {
      hasOwnerCol: t.textContent.includes('负责人'),
      hasDepCol: t.textContent.includes('依赖'),
      hasUnitBtn: !!document.querySelector('[data-action="unit-owner"]'),
      rowCount: t.querySelectorAll('tbody tr').length,
    } : '(none)';
  });
  await page.click('[data-action="unit-owner"]');
  await page.waitForTimeout(250);
  out.d4_unit = await page.evaluate(() => {
    const dlg = document.querySelector('.guide-dialog');
    return dlg ? {
      title: dlg.querySelector('h2')?.textContent,
      ownerSelects: dlg.querySelectorAll('select[name^="uo"]').length,
      statusSelects: dlg.querySelectorAll('select[name^="us"]').length,
    } : '(none)';
  });
  await page.evaluate(() => {
    const f = document.querySelector('#modal-root form');
    const sel = f.querySelector('select[name="uo0"]');
    sel.value = '李婷';
    f.querySelector('select[name="us0"]').value = '进行中';
  });
  await page.click('[data-action="save-units"]');
  await page.waitForTimeout(250);
  out.d4_saved = await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    return { owner: q.units[0].owner, status: q.units[0].status, timelineLogged: q.timeline.some(t => (t.action || '').includes('Unit')) };
  });
  // governance 角色矩阵
  await page.evaluate(() => window.PFC.go({ route: 'governance', govTab: 'team' }));
  await page.waitForTimeout(250);
  out.d4_governance = await page.evaluate(() => {
    const t = document.querySelectorAll('.data-table');
    const last = t[t.length - 1];
    return {
      hasRoleMatrix: document.body.textContent.includes('角色矩阵'),
      hasExecCol: last ? last.textContent.includes('执行者') : false,
      hasActions: last ? last.textContent.includes('发起 / 停止作业') : false,
    };
  });

  // ============ 领域5：发布快照 ============
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1042', stage: 'release', panel: 'terminal' }));
  await page.waitForTimeout(250);
  // 准备并批准
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.accept = { status: 'ACCEPTED', note: '验收通过（验证用）', actor: '陈立' };
    q.stage = 'release';
    P.s.ui.stage = 'release';
    P.requestRelease(q, { target: '生产', scope: '积分提醒 3 服务', rollback: '回滚开关 + 版本回退', hours: 48 });
    P.save();
    P.render();
  });
  await page.waitForTimeout(250);
  await page.click('[data-action="release-action"][data-control="approve"]');
  await page.waitForTimeout(250);
  out.d5_approve = await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    return {
      status: q.release?.status,
      snapshot: !!q.release?.snapshot,
      snapshotStamp: q.release?.snapshot?.stamp === P.stamp(q),
      hasArtifacts: Object.keys(q.release?.snapshot?.artifacts || {}).length >= 4,
      hasFrozenAt: !!q.release?.snapshot?.frozenAt,
      cardShowsSnapshot: document.body.textContent.includes('冻结基线'),
    };
  });
  // 执行发布
  await page.click('[data-action="release-action"][data-control="execute"]');
  await page.waitForTimeout(300);
  out.d5_execute = await page.evaluate(() => {
    const P = window.PFC;
    return { release: P.r().release?.status, stage: P.r().stage, hasObservation: !!P.r().observation };
  });
  // 再申请 + 审批后产物变化 → 执行被拒
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.stage = 'release';
    P.s.ui.stage = 'release';
    P.requestRelease(q, { target: '生产', scope: '积分提醒 3 服务', rollback: '回滚开关 + 版本回退', hours: 24 });
    P.save();
    P.render();
  });
  await page.waitForTimeout(250);
  await page.click('[data-action="release-action"][data-control="approve"]');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const P = window.PFC;
    P.newVersion(P.r(), 'req', [{ name: '目标', value: '变更后的目标（验证审批失效）' }]);
    P.save();
    P.go({ route: 'work', req: 'R-1042', stage: 'req', panel: 'terminal' });
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const P = window.PFC;
    P.s.ui.stage = 'release';
    P.go({ route: 'work', req: 'R-1042', stage: 'release', panel: 'terminal' });
  });
  await page.waitForTimeout(250);
  out.d5_staleReject = await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    return {
      releaseStale: q.release?.status === 'STALE',
      noticeShown: document.body.textContent.includes('原审批已失效'),
      noExecuteBtn: !document.querySelector('[data-action="release-action"][data-control="execute"]'),
    };
  });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(150);
  // release-snapshot 历史记录
  out.d5_history = await page.evaluate(() => {
    const P = window.PFC;
    return { historyLen: P.r().releaseHistory.length, hasSnapshotRow: !!document.querySelector('[data-action="release-snapshot"]') };
  });

  // ============ 领域6：观察复盘 ============
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.r();
    q.stage = 'observe';
    P.s.ui.stage = 'observe';
    q.release = { id: 'REL-OBS', status: 'SUCCEEDED', target: '生产', scope: 'x', rollback: 'y', hours: 24, stamp: P.stamp(q), expiresAt: Date.now() + 3600000, actor: '陈立', snapshot: { stamp: P.stamp(q), artifacts: { idea: 'a', req: 'b', design: 'c', dev: 'd', test: 'e', accept: 'f', release: 'g', observe: 'h' }, runId: 'R1', testRunId: 'T1', acceptId: 'ACCEPTED@陈立', target: '生产', frozenAt: new Date().toISOString() } };
    q.observation = { startedAt: Date.now() - 1 * 3600000, hours: 24, metrics: '', conclusion: '', entries: [], anomaly: null, followups: [], releaseSnapshot: q.release.snapshot };
    P.save();
    P.go({ route: 'work', req: 'R-1042', stage: 'observe', panel: 'terminal' });
  });
  await page.waitForTimeout(250);
  await page.click('[data-action="observe-form"]');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const f = document.querySelector('#modal-root form');
    f.querySelector('[name="metrics"]').value = '首日转化 +12%（模拟指标）';
    f.querySelector('[name="followups"]').value = '灰度观察一周 | 李婷 | 进行中\n沉淀提醒触达规则 | 陈立 | 待处理';
    f.querySelector('[name="conclusion"]').value = '结论：提醒触达有效，可全量';
  });
  await page.click('[data-action="save-observation"]');
  await page.waitForTimeout(300);
  out.d6_entry = await page.evaluate(() => {
    const P = window.PFC;
    const o = P.r().observation;
    return { entryCount: o.entries.length, hasFollowups: o.followups.length === 2, hasOwner: o.followups[0]?.owner === '李婷', cardShowsEntries: document.body.textContent.includes('观测记录') };
  });
  // 再次追加（多轮）
  await page.click('[data-action="observe-form"]');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const f = document.querySelector('#modal-root form');
    f.querySelector('[name="metrics"]').value = '次日留存 +6%（模拟指标）';
  });
  await page.click('[data-action="save-observation"]');
  await page.waitForTimeout(300);
  out.d6_multi = await page.evaluate(() => window.PFC.r().observation.entries.length === 2);
  // finish：窗口未结束被拒
  await page.click('[data-action="observe-form"]');
  await page.waitForTimeout(250);
  await page.click('[data-action="finish-observation"]');
  await page.waitForTimeout(300);
  out.d6_finishBlocked = await page.evaluate(() => {
    const err = document.querySelector('#form-error')?.textContent || '';
    return { blocked: err.includes('观察窗口尚未结束'), err: err.slice(0, 30) };
  });
  await page.evaluate(() => window.PFC.close());
  await page.waitForTimeout(150);
  // 推进时间后完成（finish 需要窗口结束：startedAt 前移）
  await page.evaluate(() => {
    const P = window.PFC;
    P.r().observation.startedAt = Date.now() - 50 * 3600000;
    P.save();
  });
  await page.click('[data-action="observe-form"]');
  await page.waitForTimeout(250);
  await page.click('[data-action="finish-observation"]');
  await page.waitForTimeout(300);
  out.d6_finish = await page.evaluate(() => {
    const P = window.PFC;
    return { closed: P.r().closed, conclusion: P.r().observation.conclusion.includes('可全量') };
  });

  // ============ 领域7：文档与门禁 ============
  // 交付中心唯一当前结论
  await page.evaluate(() => window.PFC.go({ route: 'delivery' }));
  await page.waitForTimeout(250);
  out.d7_delivery = await page.evaluate(() => {
    const t = document.querySelector('.data-table');
    return t ? {
      hasConclusionCol: t.textContent.includes('当前结论'),
      rows: t.querySelectorAll('tbody tr').length,
      hasUniq: /已复盘|观察中|已验收|待发布|测试待通过|待验收|开发/.test(t.textContent),
    } : '(none)';
  });
  // 验收卡一致性：R-1031 验收已通过 + 测试通过，无矛盾提示
  await page.evaluate(() => window.PFC.go({ route: 'work', req: 'R-1031', stage: 'accept', panel: 'terminal' }));
  await page.waitForTimeout(250);
  out.d7_accept = await page.evaluate(() => {
    const P = window.PFC;
    const q = P.s.reqs['R-1031'];
    return {
      acceptStatus: q.accept?.status,
      testsPass: q.tests.length > 0 && q.tests.every(x => x.status === 'PASS'),
      noContradiction: !document.body.textContent.includes('验收结论与测试记录不一致'),
      acceptShown: document.body.textContent.includes('已通过') || document.body.textContent.includes('ACCEPTED'),
    };
  });
  // 矛盾防御：造一个无测试但已通过的 → 显示提示
  await page.evaluate(() => {
    const P = window.PFC;
    const q = P.s.reqs['R-1031'];
    const saved = q.tests;
    q.tests = [];
    q.accept.status = 'ACCEPTED';
    P.save();
    P.render();
  });
  await page.waitForTimeout(250);
  out.d7_defense = await page.evaluate(() => document.body.textContent.includes('需补测试门禁证据'));
  // 还原
  await page.evaluate(() => {
    const P = window.PFC;
    P.s.reqs['R-1031'].tests = [];
    P.save();
  });

  console.log(JSON.stringify(out, null, 1));
  console.log('LOGS:');
  logs.forEach(l => console.log('  ' + l));
  if (!logs.length) console.log('  (no console errors)');
  await browser.close();
})();
