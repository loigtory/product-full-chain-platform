(() => {
  'use strict';
  const P = window.PFC,
    A = P.verificationClient,
    X = P.testingActions,
    V = P.testingView,
    e = (v) => P.esc(v),
    b = (...v) => P.btn(...v);
  P.acceptanceActions = {
    actions: {
      'r3-accept-view': () => {
        delete A.tabs[X.current().id];
        P.go({ stage: X.current().stage, panel: 'canvas' });
      },
      'r3-accept-open': () => {
        const q = X.current(),
          w = A.states[q.id];
        P.assert(w.actions.canAccept, '仅当前Owner可在测试完成后登记产品验收');
        X.open(
          'acceptance',
          '登记产品验收',
          V.source +
            P.select(
              'decision',
              '结论',
              [
                ['ACCEPTED', '通过'],
                ['REJECTED', '驳回'],
              ],
              'ACCEPTED',
            ) +
            '<fieldset><legend>本次验收检查</legend>' +
            [
              ['functionality', '功能与验收项'],
              ['exceptions', '权限及异常场景'],
              ['evidence', '版本和附件证据'],
            ]
              .map(
                ([key, label]) =>
                  '<label><input type="checkbox" name="checks" value="' +
                  key +
                  '"> 已检查' +
                  label +
                  '</label><br>',
              )
              .join('') +
            '</fieldset>' +
            P.field('comment', '结论 / 驳回原因', '', 'textarea') +
            P.field('risks', '风险说明（可明确填无）', '', 'textarea'),
          b('r3-accept-save', '冻结产品验收结论', {}, 'primary'),
          {
            baselineId: w.currentDelivery?.id,
            batchId: w.currentTest?.id,
            expectedRevision: q.revision,
          },
        );
      },
      'r3-accept-save': () => {
        const v = X.values(),
          checked = v.checks || [];
        return X.submit('/product-acceptances', {
          ...X.meta(),
          decision: v.decision,
          checks: Object.fromEntries(
            ['functionality', 'exceptions', 'evidence'].map((k) => [
              k,
              checked.includes(k),
            ]),
          ),
          comment: v.comment,
          risks: v.risks,
        });
      },
      'r3-release-inputs': async () => {
        const r = await X.read('/release-inputs');
        X.open(
          'release-inputs',
          '发布准备输入',
          P.badge(
            r.inputsReady ? '输入已就绪' : '输入待补齐',
            r.inputsReady ? 'green' : 'blue',
          ) +
            '<p>仅汇总准备输入，发布评审、执行和观察尚未接入。</p>' +
            r.blockers.map((x) => '<p>' + e(x) + '</p>').join('') +
            P.table(
              ['输入', '版本'],
              [
                ['交付', e(r.delivery?.id)],
                ['测试报告', e(r.test?.reportVersionId)],
                ['产品验收', e(r.acceptance?.id)],
                ['风险', e(r.risk)],
              ],
            ) +
            V.evidence(r.delivery?.evidence),
        );
      },
    },
  };
})();
