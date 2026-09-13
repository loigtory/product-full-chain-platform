(() => {
  'use strict';
  const P = window.PFC,
    A = P.verificationClient,
    V = P.testingView,
    e = (v) => P.esc(v),
    b = (...v) => P.btn(...v);
  const X = (P.acceptanceView = {});
  X.body = (q) => {
    const w = A.states[q.id];
    if (!w)
      return (
        '<p role="status">正在读取产品验收…</p>' + b('r3-refresh', '重试读取')
      );
    let html = '<div class="panel-title">产品验收与发布准备</div>' + V.source;
    if (A.draft(q.id).pending)
      html += P.notice(
        '提交结果待核实，原输入与编号已保留。',
        'r3-retry',
        '核验原提交',
      );
    html += P.table(
      ['依据', '当前记录'],
      [
        ['交付', e(w.currentDelivery?.id || '尚未提测')],
        ['测试报告', e(w.currentTest?.reportVersionId || '尚无有效完成报告')],
        ['测试批次', e(w.currentTest?.id || '待完成')],
        ['套件', e(w.currentSuite?.id || '待采用')],
      ],
    );
    html +=
      '<p>仅当前 Owner 可以登记产品通过或驳回。全部必测通过、证据有效、缺陷关闭后才能通过；结论和风险将随版本冻结。</p>';
    html +=
      '<div class="btn-group">' +
      b(
        'r3-accept-open',
        '登记产品验收',
        { disabled: !w.actions.canAccept },
        'primary',
      ) +
      (P.releaseClient?.enabled()
        ? b('m4-open', '完善发布准备')
        : b('r3-release-inputs', '核对发布准备输入')) +
      b('r3-tests', '返回测试与缺陷') +
      b('r3-artifacts', '查看关联成果') +
      '</div>';
    html += P.table(
      ['验收记录', '结论', '操作'],
      w.history.acceptances.items.map((a) => [
        e(a.id),
        V.status(a.state),
        b('r3-detail', '查看冻结记录', {
          kind: 'product-acceptances',
          id: a.id,
        }),
      ]),
    );
    html += b('r3-history', '全部验收历史', {
      kind: 'product-acceptances',
      offset: 0,
    });
    if (q.stage === 'release' && !P.releaseClient?.enabled())
      html += P.notice(
        '当前仅准备发布输入。发布评审、执行和观察待后续版本接入。',
      );
    return html;
  };
})();
