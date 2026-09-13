(() => {
  'use strict';
  const P = window.PFC,
    A = P.releaseClient,
    V = (P.observationView = {}),
    R = P.releaseView,
    e = (v) => P.esc(v),
    b = (...v) => P.btn(...v);
  V.body = (q) => {
    A.ensure(q.id);
    const w = A.states[q.id],
      o = w?.currentObservation;
    let html =
      '<div class="panel-title">观察与最终验收</div>' +
      R.source +
      R.controls(w);
    if (A.errors[q.id])
      html += P.notice('读取失败：' + A.errors[q.id], 'm4-refresh', '重试');
    if (A.draft(q.id).pending)
      html += P.notice(
        '已提交待核实，输入和编号已保留。',
        'm4-retry',
        '核验原提交',
      );
    if (!o) return html + '<p>当前没有已登记成功发布对应的观察。</p>';
    const can = w.actions.canWrite && o.state === 'OPEN' && !w.closedAt;
    html += P.card(
      '本次观察',
      R.status(o.state) +
        P.table(
          ['观察依据', '记录'],
          [
            ['发布计划', e(o.releaseId)],
            ['实际开始（UTC）', e(o.startedAt.replace('T', ' ').slice(0, 19))],
            ['服务端截止（UTC）', e(o.endsAt.replace('T', ' ').slice(0, 19))],
            ['窗口', e(o.plan.hours) + '小时'],
            [
              '剩余（服务端读取时）',
              o.remainingSeconds
                ? Math.ceil(o.remainingSeconds / 60) + '分钟'
                : '窗口已结束',
            ],
          ],
        ) +
        (w.closedAt ? '<p>结案时间：' + e(w.closedAt) + '</p>' : '') +
        (w.closedAt ? [] : o.blockers)
          .map(
            (v) =>
              '<p>' +
              e(
                {
                  OBSERVATION_WINDOW_OPEN: '观察窗口尚未结束',
                  OBSERVATION_INCOMPLETE: '指标、异常或阻断遗留项尚未完成',
                  RELEASE_EVIDENCE_UNAVAILABLE: '证据不可用，需核对原件或权限',
                  RELEASE_RESULT_UNKNOWN: '发布或回退结果未知',
                  RELEASE_RECORD_REQUIRED: '发布/回退记录不支持最终验收',
                  RELEASE_APPROVAL_REQUIRED: '批准人权限已变化',
                }[v] || v,
              ) +
              '</p>',
          )
          .join(''),
    );
    html += P.card(
      '冻结指标与口径',
      P.table(
        ['指标与口径', '冻结内容'],
        o.plan.metrics.flatMap((m) => [
          ['指标', e(m.metricId) + ' ' + e(m.name)],
          ['目标 / 单位', e(m.target) + ' ' + e(m.unit)],
          ['来源 / 采样', e(m.source) + ' / ' + e(m.sampling)],
          ['责任人', e(m.owner)],
        ]),
      ) +
        b(
          'm4-entry-new',
          '登记指标 / 异常',
          { id: o.id, disabled: !can },
          'primary',
        ) +
        b('m4-observation-history', '观测记录', {
          id: o.id,
          kind: 'entries',
          offset: 0,
        }),
    );
    html += P.card(
      '遗留项与处理',
      b('m4-followup-new', '登记遗留项', { id: o.id, disabled: !can }) +
        b('m4-observation-history', '遗留项与处理历史', {
          id: o.id,
          kind: 'followups',
          offset: 0,
        }),
    );
    html += P.card(
      '最终验收与复盘',
      b(
        'm4-final-new',
        '登记最终验收',
        { id: o.id, disabled: !w.actions.canFinalize || o.state !== 'OPEN' },
        'primary',
      ) +
        b('m4-observation-history', '最终验收历史', {
          id: o.id,
          kind: 'final-acceptances',
          offset: 0,
        }) +
        b('m4-return', '返回修复', {
          id: o.releaseId,
          disabled: !w.actions.canReview || !!w.closedAt,
        }) +
        b('m4-knowledge', '复盘预填知识', {
          id: o.id,
          disabled: !w.closedAt || !w.actions.canWrite,
        }) +
        b('m4-new-req', '创建关联新需求', {
          disabled: !w.closedAt || !w.actions.canWrite,
        }),
    );
    return html;
  };
})();
