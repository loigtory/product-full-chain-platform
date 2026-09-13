(() => {
  'use strict';
  const P = window.PFC,
    A = P.verificationClient,
    e = (v) => P.esc(v),
    b = (...v) => P.btn(...v);
  const V = (P.testingView = {});
  V.labels = {
    READY: '完整',
    INCOMPLETE: '待补齐',
    OPEN: '进行中',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
    RESOLVED: '已声明修复',
    REOPEN: '重新打开',
    CLOSED: '已关闭',
    PASS: '通过',
    FAIL: '失败',
    NOT_RUN: '未执行',
    BLOCKED: '阻塞',
    ACCEPTED: '验收通过',
    REJECTED: '验收驳回',
  };
  V.status = (value) =>
    P.badge(
      V.labels[value] || value,
      ['PASS', 'READY', 'CLOSED', 'COMPLETED', 'ACCEPTED'].includes(value)
        ? 'green'
        : 'blue',
    );
  V.source =
    '<p class="muted">具名人工登记 · 请填实际执行结果并关联证据。平台尚未执行真实测试，模拟质量门不计入测试通过。</p>';
  V.controls = (q, w) =>
    '<div class="btn-group">' +
    b(
      'r3-suite-new',
      '从验收项准备测试',
      { disabled: !w?.actions.canWrite || !w?.actions.canPrepare },
      'primary',
    ) +
    b('r3-suite-edit', '编辑测试套件', {
      disabled: !w?.actions.canWrite || !w?.currentSuite,
    }) +
    b('r3-history', '套件与交付历史', { kind: 'test-suites', offset: 0 }) +
    b('r3-handoff', '登记交付并提测', {
      disabled: !w?.actions.canWrite || q.stage !== 'dev',
    }) +
    b('r3-refresh', '刷新状态') +
    (P.releaseClient?.enabled() ? b('m4-open', '提前准备发布') : '') +
    '</div>';
  V.body = (q) => {
    const w = A.states[q.id];
    if (A.errors[q.id])
      return (
        P.notice('读取失败：' + A.errors[q.id], 'r3-refresh', '重试读取') +
        (A.draft(q.id).pending
          ? P.notice(
              '已提交待核实，输入与提交编号已保留。',
              'r3-retry',
              '核验原提交',
            )
          : '')
      );
    if (!w)
      return '<p role="status">正在读取测试准备…</p>' + b('r3-refresh', '读取');
    let html =
      '<div class="panel-title">测试准备与执行记录</div>' +
      V.source +
      V.controls(q, w);
    if (A.draft(q.id).pending)
      html += P.notice(
        '上次提交结果待核实，输入与提交编号已保留。',
        'r3-retry',
        '核验原提交',
      );
    if (w.blockers.length)
      html +=
        '<details open><summary>提测与验收条件</summary><ul>' +
        w.blockers.map((v) => '<li>' + e(v) + '</li>').join('') +
        '</ul></details>';
    const suite = w.currentSuite;
    html += P.card(
      '当前采用套件',
      suite
        ? '<p>' +
            e(suite.id) +
            ' · v' +
            suite.version +
            ' · ' +
            V.status(suite.status) +
            (suite.casesPartial
              ? ' · 共' + suite.caseCount + '例，完整内容请打开套件详情'
              : '') +
            '</p>' +
            b('r3-suite-review', '查看完整套件', { id: suite.id }) +
            P.table(
              ['用例 / 验收项', '场景与预期', '负责 / 数据策略'],
              suite.cases.map((c) => [
                e(c.caseId) + '<br>' + e(c.acIds.join('、')),
                e(c.title) + '<br>' + e(c.expected),
                e(c.owner) + '<br>' + e(c.dataPolicy),
              ]),
            )
        : '<p>还未采用套件。可先保存待完善草稿，再逐项补齐边界与数据。</p>',
    );
    html += P.card(
      '当前交付',
      w.currentDelivery
        ? '<p>' +
            e(w.currentDelivery.id) +
            ' · ' +
            e(w.currentDelivery.subject.versionRef) +
            '</p><p>' +
            e(w.currentDelivery.subject.changes) +
            '</p>' +
            b('r3-detail', '查看冻结依据', {
              kind: 'delivery-baselines',
              id: w.currentDelivery.id,
            })
        : '<p>开发完成后，登记版本、变更和证据即可交接。</p>',
    );
    html += P.card(
      '测试批次',
      P.table(
        ['批次', '状态', '操作'],
        w.history.batches.items.map((x) => [
          e(x.id),
          V.status(x.state),
          b('r3-batch', '查看结果', { id: x.id }),
        ]),
      ) +
        '<div class="btn-group">' +
        b(
          'r3-batch-new',
          '新建人工测试批次',
          {
            disabled:
              !w.actions.canWrite ||
              !w.ready ||
              !['test', 'accept', 'release'].includes(q.stage),
          },
          'primary',
        ) +
        b('r3-history', '全部批次', { kind: 'test-batches', offset: 0 }) +
        '</div>',
    );
    html += P.card(
      '缺陷与回归',
      P.table(
        ['缺陷', '状态', '操作'],
        w.history.defects.items.map((x) => [
          e(x.id) + ' ' + e(x.title),
          V.status(x.state),
          b('r3-defect', '查看与处理', { id: x.id }),
        ]),
      ) + b('r3-history', '全部缺陷', { kind: 'defects', offset: 0 }),
    );
    return (
      html +
      b('r3-artifacts', '返回关联成果') +
      (['accept', 'release'].includes(q.stage)
        ? b('r3-accept-view', '查看产品验收')
        : '')
    );
  };
  V.evidenceFields = (name = 'evidence') => {
    const attachments = P.r().attachments.filter(
      (a) => a.allowed && a.materialStatus === '已纳入',
    );
    return (
      '<fieldset data-r3-evidence><legend>附件证据（当前需求版本，最多20份）</legend>' +
      (attachments.length
        ? attachments
            .map(
              (a) =>
                '<label><input type="checkbox" name="' +
                name +
                '" value="' +
                e(a.id) +
                '"> ' +
                e(a.name) +
                ' · v' +
                a.version +
                '</label><br>',
            )
            .join('')
        : '<p>请先在聊天区上传实际测试证据，再回来登记。</p>') +
      '</fieldset>'
    );
  };
  V.evidence = (refs) =>
    P.table(
      ['附件 / 版本', '操作'],
      (refs || []).map((r) => [
        e(r.id) + ' · v' + r.version,
        b('download-attachment-text', '下载证据', {
          id: r.id,
          version: r.version,
        }),
      ]),
    );
  V.install = () => {
    const blockers = P.blockers;
    P.blockers = (q) =>
      A.enabled() && ['dev', 'test', 'accept', 'release'].includes(q.stage)
        ? [
            {
              dev: '登记本次交付并提测',
              test: '从批次完成必测结果与缺陷回归',
              accept: '由Owner核对并登记产品验收',
              release: '核对发布准备输入',
            }[q.stage],
          ]
        : blockers(q);
    for (const [name, title, action, label] of [
      ['testCard', '测试执行与缺陷', 'r3-tests', '查看测试与缺陷'],
      ['acceptCard', '产品验收', 'r3-accept-open', '登记产品验收'],
      ['releaseCard', '发布准备', 'r3-release-inputs', '核对发布准备输入'],
    ]) {
      const old = P[name];
      P[name] = (q) => {
        if (!A.enabled()) return old(q);
        const w = A.states[q.id];
        return P.card(
          title,
          V.source +
            P.table(
              ['当前依据', '记录'],
              [
                ['交付', e(w?.currentDelivery?.id || '待登记')],
                ['采用套件', e(w?.currentSuite?.id || '待准备')],
                ['测试报告', e(w?.currentTest?.reportVersionId || '待完成')],
              ],
            ) +
            b(
              action,
              label,
              { disabled: name === 'acceptCard' && !w?.actions.canAccept },
              'primary',
            ),
        );
      };
    }

    const panel = P.renderPanel;
    P.renderPanel = (q) =>
      A.enabled() &&
      P.s.ui.panel === 'canvas' &&
      A.tabs[q.id] !== 'artifacts' &&
      (A.tabs[q.id] === 'testing' ||
        ['test', 'accept', 'release'].includes(P.s.ui.stage))
        ? P.workbenchShell.panel({
            selected: 'canvas',
            body:
              A.tabs[q.id] !== 'testing' &&
              ['accept', 'release'].includes(P.s.ui.stage)
                ? P.acceptanceView.body(q)
                : V.body(q),
          })
        : panel(q);
  };
})();
