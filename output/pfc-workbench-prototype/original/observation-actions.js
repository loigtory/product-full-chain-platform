(() => {
  'use strict';
  const P = window.PFC,
    A = P.releaseClient,
    X = P.releaseActions,
    V = P.releaseView,
    e = (v) => P.esc(v),
    b = (...v) => P.btn(...v);
  const target = async (id) =>
    (await X.read('/observations/' + id)).observation;
  const fields = (v, items) =>
    items
      .map(([name, label, type]) =>
        X.field(name, label, v?.[name] || '', type || 'text'),
      )
      .join('');
  P.observationActions = {
    actions: {
      'm4-entry-new': async (d) => {
        const o = await target(d.id);
        X.open(
          'entry:' + o.id,
          '登记实际观测',
          V.source +
            '<p>采样区间须从本次实际发布之后开始，最终覆盖 ' +
            e(o.endsAt) +
            ' 或更晚。</p>' +
            P.select(
              'kind',
              '记录类型',
              [
                ['METRIC', '指标采样'],
                ['ISSUE', '异常 / 处理记录'],
              ],
              'METRIC',
            ) +
            P.select(
              'metricId',
              '对应指标',
              o.plan.metrics.map((m) => [
                m.metricId,
                m.metricId + ' ' + m.name,
              ]),
              o.plan.metrics[0]?.metricId,
            ) +
            X.field('issueId', '异常稳定编号（异常记录必填）') +
            P.select(
              'status',
              '实际状态',
              [
                ['MET', '指标达标'],
                ['NOT_MET', '指标未达标'],
                ['UNKNOWN', '指标未知'],
                ['OPEN', '异常未处理'],
                ['RESOLVED', '异常已解决'],
              ],
              'UNKNOWN',
            ) +
            fields(null, [
              ['sampledFrom', '实际采样开始（UTC）'],
              ['sampledTo', '实际采样结束（UTC）'],
              ['actual', '实际值 / 结果', 'textarea'],
              ['sourceDescription', '数据来源说明', 'textarea'],
              ['impact', '影响说明', 'textarea'],
              ['responsible', '异常责任人（当前成员）'],
            ]) +
            P.testingView.evidenceFields(),
          b('m4-entry-save', '保存观测记录', {}, 'primary'),
          { observationId: o.id, entryHeads: o.latestEntries },
        );
      },
      'm4-entry-save': () => {
        const v = X.values(),
          prior = X.meta().entryHeads?.find(
            (e) =>
              e.kind === v.kind &&
              (v.kind === 'METRIC'
                ? e.metricId === v.metricId
                : e.issueId === v.issueId),
          );
        return X.submit(
          '/observations/' + X.meta().observationId + '/entries',
          {
            ...v,
            sequence: (prior?.sequence || 0) + 1,
            previousRecordId: prior?.id || null,
            source: 'USER_REPORTED',
            evidence: X.evidence(v.evidence),
          },
        );
      },
      'm4-followup-new': async (d) => {
        const o = await target(d.id);
        X.open(
          'followup:' + o.id,
          '登记遗留项',
          V.source +
            fields(null, [
              ['title', '遗留事项', 'textarea'],
              ['owner', '当前有权负责人'],
              ['dueAt', '截止时间（UTC）'],
              ['metricId', '关联指标编号（可选）'],
              ['issueId', '关联异常编号（可选）'],
            ]) +
            P.select(
              'blocking',
              '是否阻断最终验收',
              [
                ['true', '阻断'],
                ['false', '非阻断，需Owner接受风险'],
              ],
              'true',
            ),
          b('m4-followup-save', '保存遗留项', {}, 'primary'),
          { observationId: o.id },
        );
      },
      'm4-followup-save': () => {
        const v = X.values();
        return X.submit(
          '/observations/' + X.meta().observationId + '/followups',
          { ...v, blocking: v.blocking === 'true' },
        );
      },
      'm4-followup-event': async (d) => {
        const page = await X.read(
            '/observations/' + d.id + '/followups?limit=100',
          ),
          f = page.items.find((f) => f.id === d.fid);
        P.assert(f, '遗留项已变化');
        X.open(
          'followup-event:' + f.id,
          '追加遗留项处理 · ' + f.id,
          '<p>' +
            e(f.title) +
            '</p>' +
            P.select(
              'status',
              '当前处理状态',
              [
                ['OPEN', '待处理'],
                ['IN_PROGRESS', '处理中'],
                ['DONE', '已完成'],
              ],
              f.status,
            ) +
            fields(f, [
              ['owner', '当前有权负责人'],
              ['dueAt', '截止时间（UTC）'],
              ['comment', '实际处理 / 完成说明', 'textarea'],
            ]) +
            P.testingView.evidenceFields(),
          b('m4-followup-event-save', '追加处理记录', {}, 'primary'),
          {
            observationId: d.id,
            followupId: f.id,
            sequence: f.sequence + 1,
            previousRecordId: f.previousRecordId,
          },
        );
      },
      'm4-followup-event-save': () => {
        const v = X.values(),
          m = X.meta();
        return X.submit(
          '/observations/' +
            m.observationId +
            '/followups/' +
            m.followupId +
            '/events',
          {
            ...v,
            sequence: m.sequence,
            previousRecordId: m.previousRecordId,
            evidence: X.evidence(v.evidence),
            source: 'USER_REPORTED',
          },
        );
      },
      'm4-final-new': async (d) => {
        const o = await target(d.id),
          followups = (
            await X.read('/observations/' + o.id + '/followups?limit=100')
          ).items;
        X.open(
          'final:' + o.id,
          '最终验收与复盘',
          V.source +
            '<p>此结论独立于产品验收。通过后结案，后续业务变更新建关联需求。</p>' +
            '<p>冻结业务目标：' +
            e(o.basis.goal) +
            '</p>' +
            P.table(
              ['验收项', '预期结果'],
              o.basis.acceptanceCriteria.map((a) => [
                e(a.acId) + ' ' + e(a.scenario),
                e(a.expected),
              ]),
            ) +
            P.table(
              ['指标 / 目标', '最近实际 / 状态'],
              o.plan.metrics.map((m) => {
                const v = o.latestEntries.find(
                  (v) => v.metricId === m.metricId,
                );
                return [
                  e(m.name) + ' / ' + e(m.target) + ' ' + e(m.unit),
                  e(v?.actual || '尚未登记') +
                    ' / ' +
                    e(v?.status || 'UNKNOWN'),
                ];
              }),
            ) +
            P.table(
              ['遗留 / 阻断', '负责 / 截止 / 状态'],
              followups.map((f) => [
                e(f.title) + ' / ' + (f.blocking ? '阻断' : '非阻断'),
                e(f.owner) + ' / ' + e(f.dueAt) + ' / ' + e(f.status),
              ]),
            ) +
            o.blockers.map((v) => '<p>当前阻断：' + e(v) + '</p>').join('') +
            P.select(
              'decision',
              '最终结论',
              [
                ['REJECTED', '驳回，继续观察或返回修复'],
                ['ACCEPTED', '通过并结案'],
              ],
              'REJECTED',
            ) +
            '<fieldset><legend>Owner最终核对</legend>' +
            [
              ['goals', '目标与实际值'],
              ['evidence', '当前可用证据'],
              ['followups', '遗留项及风险'],
            ]
              .map(
                ([key, label]) =>
                  '<label><input type="checkbox" name="checks" value="' +
                  key +
                  '">已核对' +
                  label +
                  '</label><br>',
              )
              .join('') +
            '</fieldset>' +
            fields(null, [
              ['actual', '目标与实际对照', 'textarea'],
              ['conclusion', '最终结论', 'textarea'],
              ['retrospective', '复盘结论与改进', 'textarea'],
              ['risks', '遗留风险接受说明（可填无）', 'textarea'],
            ]),
          b('m4-final-save', '冻结最终验收结论', {}, 'primary'),
          { observationId: o.id },
        );
      },
      'm4-final-save': () => {
        const v = X.values();
        return X.submit(
          '/observations/' + X.meta().observationId + '/final-acceptances',
          {
            ...v,
            checks: Object.fromEntries(
              ['goals', 'evidence', 'followups'].map((k) => [
                k,
                (v.checks || []).includes(k),
              ]),
            ),
            source: 'USER_REPORTED',
          },
        );
      },
      'm4-observation-detail': async (d) => {
        const o = await target(d.id);
        X.open(
          'observation-detail',
          '观察记录 · ' + o.id,
          V.source +
            V.status(o.state) +
            '<p>' +
            e(o.releaseId) +
            ' · ' +
            e(o.startedAt) +
            ' ～ ' +
            e(o.endsAt) +
            '</p><p>' +
            e(o.stopReason || '') +
            '</p>',
          b('m4-observation-history', '观测记录', {
            id: o.id,
            kind: 'entries',
            offset: 0,
          }) +
            b('m4-observation-history', '最终验收', {
              id: o.id,
              kind: 'final-acceptances',
              offset: 0,
            }),
        );
      },
      'm4-observation-history': async (d) => {
        P.assert(
          ['entries', 'followups', 'final-acceptances'].includes(d.kind),
          '记录类型无效',
        );
        const r = await X.read(
          '/observations/' +
            d.id +
            '/' +
            d.kind +
            '?offset=' +
            (Number(d.offset) || 0),
        );
        X.open(
          'observation-history',
          '观察记录',
          r.items
            .map((v) =>
              P.card(
                v.id,
                V.status(v.status || v.decision) +
                  '<p>' +
                  e(v.actual || v.title || v.conclusion || '') +
                  '</p>' +
                  (v.sampledFrom
                    ? '<p>' +
                      e(v.sampledFrom) +
                      ' ～ ' +
                      e(v.sampledTo) +
                      '</p>'
                    : '') +
                  (v.retrospective
                    ? '<p>复盘：' +
                      e(v.retrospective) +
                      '</p><p>风险：' +
                      e(v.risks) +
                      '</p>'
                    : '') +
                  (d.kind === 'followups'
                    ? '<p>' +
                      e(v.owner) +
                      ' / 截止 ' +
                      e(v.dueAt) +
                      ' / ' +
                      (v.blocking ? '阻断' : '非阻断') +
                      '</p>' +
                      b('m4-followup-event', '追加处理', {
                        id: d.id,
                        fid: v.id,
                        disabled:
                          !A.states[P.r().id].actions.canWrite ||
                          (!!A.states[P.r().id].closedAt && v.blocking),
                      }) +
                      b('m4-followup-history', '处理历史', {
                        id: d.id,
                        fid: v.id,
                        offset: 0,
                      })
                    : V.evidence(v.evidence)),
              ),
            )
            .join('') +
            X.paging('m4-observation-history', r, { id: d.id, kind: d.kind }),
        );
      },
      'm4-followup-history': async (d) => {
        const r = await X.read(
          '/observations/' +
            d.id +
            '/followups/' +
            d.fid +
            '/events?offset=' +
            (Number(d.offset) || 0),
        );
        X.open(
          'followup-history',
          '遗留项处理历史',
          r.items
            .map((v) =>
              P.card(
                v.id,
                V.status(v.status) +
                  '<p>' +
                  e(v.comment) +
                  '</p><p>' +
                  e(v.owner) +
                  ' / ' +
                  e(v.dueAt) +
                  '</p>' +
                  V.evidence(v.evidence),
              ),
            )
            .join('') +
            X.paging('m4-followup-history', r, { id: d.id, fid: d.fid }),
        );
      },
      'm4-knowledge': async (d) => {
        const q = X.current(),
          rows = await X.read(
            '/observations/' + d.id + '/final-acceptances?limit=100',
          ),
          accepted = rows.items.find((a) => a.decision === 'ACCEPTED');
        P.assert(accepted && A.states[q.id].closedAt, '先完成最终验收');
        P.domainActions.remote['add-knowledge']();
        const values = {
          'k-title': q.name + ' · 最终复盘',
          'k-type': '复盘结论',
          'k-tags': q.id + ',发布复盘',
          'k-content': [
            '来源需求：' + q.id,
            '观察：' + d.id,
            '最终验收：' + accepted.id,
            '来源：人工登记，未外部核验',
            accepted.actual,
            accepted.conclusion,
            accepted.retrospective,
            '风险：' + accepted.risks,
          ].join('\n'),
        };
        for (const [name, value] of Object.entries(values)) {
          const n = document.querySelector('#modal-root [name="' + name + '"]');
          P.assert(n, '知识表单字段不可用');
          n.value = value;
          n.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
      'm4-new-req': () => {
        const q = X.current();
        P.assert(A.states[q.id].closedAt, '结案后创建后续需求');
        P.domainActions.remote['new-requirement']();
        for (const [name, value] of Object.entries({
          name: q.name + ' · 后续改进',
          goal: '关联已结案需求 ' + q.id + '；后续目标待补充',
          scope: '后续范围待确认，不继承原需求验收结论',
        })) {
          const n = document.querySelector('#modal-root [name="' + name + '"]');
          if (n) {
            n.value = value;
            n.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      },
    },
  };
})();
