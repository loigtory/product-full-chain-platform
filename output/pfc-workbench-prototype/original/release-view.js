(() => {
  'use strict';
  const P = window.PFC,
    A = P.releaseClient,
    V = (P.releaseView = {}),
    e = (v) => P.esc(v),
    b = (...v) => P.btn(...v);
  V.source =
    '<p class="muted">人工登记 · 平台未执行发布、回退或核验外部效果。授权依据由成员提供，未外部核验；请勿填写凭据。</p>';
  V.labels = {
    DRAFT: '待补齐',
    READY: '准备完整',
    NOT_SUBMITTED: '尚未送审',
    PENDING: '待Owner评审',
    APPROVED: '已批准准备',
    REJECTED: '已驳回',
    SUPERSEDED: '已被替代',
    SUCCESS: '成功（人工登记）',
    FAILED: '失败（人工登记）',
    UNKNOWN: '结果待核实',
    OPEN: '观察中',
    STOPPED: '观察已停止',
    CLOSED: '已结案',
    ACCEPTED: '最终验收通过',
  };
  V.status = (s) =>
    P.badge(
      V.labels[s] || s,
      ['READY', 'APPROVED', 'SUCCESS', 'ACCEPTED', 'CLOSED'].includes(s)
        ? 'green'
        : 'blue',
    );
  V.evidence = (refs) =>
    P.table(
      ['附件 / 冻结版本', '可用性'],
      (refs || []).map((r) => [
        e(r.id) + ' · v' + r.version,
        r.available === false
          ? e(r.reason || '不可用')
          : b('download-attachment-text', '下载证据', {
              id: r.id,
              version: r.version,
            }),
      ]),
    );
  V.controls = (w) =>
    '<div class="btn-group">' +
    b(
      'm4-plan-new',
      '完善发布准备',
      { disabled: !w?.actions.canWrite || !w?.actions.canPrepare },
      'primary',
    ) +
    b('m4-refresh', '刷新状态') +
    b('r3-release-inputs', '核对发布输入') +
    b('m4-tests', '查看上游测试') +
    b('m4-artifacts', '查看关联成果') +
    b('m4-history', '发布准备历史', { kind: 'release-plans', offset: 0 }) +
    b('m4-history', '观察历史', { kind: 'observations', offset: 0 }) +
    '</div>';
  V.body = (q) => {
    A.ensure(q.id);
    const w = A.states[q.id];
    let html =
      '<div class="panel-title">发布准备与结果</div>' +
      V.source +
      V.controls(w);
    if (A.errors[q.id])
      html += P.notice('读取失败：' + A.errors[q.id], 'm4-refresh', '重新读取');
    if (A.draft(q.id).pending)
      html += P.notice(
        '上次提交结果待核实，输入及编号已保留。',
        'm4-retry',
        '核验原提交',
      );
    if (!w) return html + '<p role="status">正在读取发布工作区…</p>';
    if (w.inputs)
      html += P.card(
        '发布前置依据',
        P.table(
          ['交付', '测试报告', '产品验收'],
          [
            [
              e(w.inputs.delivery?.id || '待登记'),
              e(w.inputs.test?.reportVersionId || '待完成'),
              e(w.inputs.acceptance?.id || '待验收'),
            ],
          ],
        ) + w.blockers.map((x) => '<p>' + e(x) + '</p>').join(''),
      );
    const p = w.currentRelease;
    html += P.card(
      '当前批准计划',
      p
        ? V.plan(p) +
            b('m4-plan-detail', '查看计划与评审', { id: p.id }) +
            b(
              'm4-result-new',
              '登记发布结果',
              { id: p.id, disabled: !w.actions.canWrite || !!w.closedAt },
              'primary',
            ) +
            b('m4-results', '结果 / 未知核验 / 回退', { id: p.id }) +
            b('m4-return', '返回修复', {
              id: p.id,
              disabled: !w.actions.canReview || !!w.closedAt,
            })
        : '<p>准备草稿可以先保存，条件齐备后再送审。</p>',
    );
    html += P.card(
      '准备版本',
      P.table(
        ['版本', '完整度 / 评审', '操作'],
        w.plans.items.map((p) => [
          e(p.id) + ' · v' + p.version,
          V.status(p.completeness) + ' ' + V.status(p.status),
          b('m4-plan-detail', '查看 / 送审', { id: p.id }),
        ]),
      ),
    );
    if (w.currentObservation)
      html += P.card(
        '观察与最终验收',
        V.status(w.currentObservation.state) +
          ' ' +
          b('m4-observe', '进入观察工作区'),
      );
    return html;
  };
  V.plan = (p) =>
    V.status(p.reviewState) +
    (p.stale ? P.badge('基线已变化', 'blue') : '') +
    P.table(
      ['目标 / 版本', '范围', '负责人', '观察窗口'],
      [
        [
          e(p.content.target) + ' / ' + e(p.content.versionRef),
          e(p.content.scope),
          e(p.content.releaseOwner),
          e(p.content.hours) + '小时',
        ],
      ],
    ) +
    p.missingFields.map((v) => '<p>待补齐：' + e(v) + '</p>').join('');
  V.install = () => {
    const panel = P.renderPanel,
      release = P.releaseCard,
      observe = P.observeCard,
      advance = P.domainActions.advance;
    P.renderPanel = (q) =>
      A.enabled() &&
      P.s.ui.panel === 'canvas' &&
      (A.tabs[q.id] || ['release', 'observe'].includes(P.s.ui.stage))
        ? P.workbenchShell.panel({
            selected: 'canvas',
            body: ['testing', 'artifacts'].includes(
              P.verificationClient.tabs[q.id],
            )
              ? '<div class="btn-group">' +
                b(
                  P.s.ui.stage === 'observe' ? 'm4-observe' : 'm4-open',
                  '返回发布 / 观察工作区',
                ) +
                '</div>' +
                (P.verificationClient.tabs[q.id] === 'testing'
                  ? P.testingView.body(q)
                  : P.artifactView.body(q))
              : P.s.ui.stage === 'observe'
                ? P.observationView.body(q)
                : V.body(q),
          })
        : panel(q);
    P.releaseCard = (q) =>
      A.enabled()
        ? P.card(
            '发布准备与结果',
            V.source + b('m4-open', '打开发布工作区', {}, 'primary'),
          )
        : release(q);
    if (observe)
      P.observeCard = (q) =>
        A.enabled()
          ? P.card(
              '观察与最终复盘',
              V.source + b('m4-observe', '打开观察工作区', {}, 'primary'),
            )
          : observe(q);
    P.domainActions.advance = (q) =>
      A.enabled() && ['release', 'observe'].includes(q.stage)
        ? P.releaseActions.actions[
            q.stage === 'observe' ? 'm4-observe' : 'm4-open'
          ]()
        : advance(q);
  };
})();
