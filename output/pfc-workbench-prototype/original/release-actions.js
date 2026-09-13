(() => {
  'use strict';
  const P = window.PFC,
    A = P.releaseClient,
    V = P.releaseView,
    e = (v) => P.esc(v),
    b = (...v) => P.btn(...v),
    X = (P.releaseActions = {});
  let form = null;
  X.current = () => {
    const q = P.r();
    P.assert(q && A.states[q.id], '请先读取当前发布工作区');
    return q;
  };
  X.values = () => {
    const node = document.querySelector('#modal-root form');
    P.assert(node, '请重新打开登记窗口');
    const v = Object.fromEntries(new FormData(node));
    for (const name of new Set(
      [...node.querySelectorAll('[type="checkbox"]')].map((n) => n.name),
    ))
      v[name] = [...node.querySelectorAll('[type="checkbox"]')]
        .filter((n) => n.name === name && n.checked)
        .map((n) => n.value);
    return v;
  };
  X.remember = () => {
    if (
      !form ||
      form.identity !== A.key(form.id) ||
      !document.querySelector('#modal-root form [name]')
    )
      return;
    const d = A.draft(form.id);
    d.forms = {
      ...d.forms,
      [form.key]: { values: X.values(), meta: form.meta, proofs: form.proofs },
    };
    A.save(form.id, d);
  };
  X.meta = () => {
    P.assert(
      form && form.id === P.r()?.id && form.identity === A.key(form.id),
      '需求或身份已切换，请重新打开',
    );
    return form.meta;
  };
  X.open = (key, title, body, footer = '', meta = {}) => {
    const q = X.current();
    P.modal(
      title,
      '<form>' + body + '</form>',
      footer +
        (footer ? b('m4-check-current', '核对最新依据') : '') +
        b('close-modal', '关闭'),
      true,
    );
    const saved = document.querySelector('#modal-root form [name]')
      ? A.draft(q.id).forms?.[key]
      : null;
    form = {
      id: q.id,
      key,
      identity: A.key(q.id),
      meta: saved?.meta || { expectedRevision: q.revision, ...meta },
      proofs:
        saved?.proofs ||
        Object.fromEntries(q.attachments.map((a) => [a.id, a.version])),
    };
    A.activeForm = { id: q.id, key };
    for (const input of document.querySelectorAll('#modal-root [name]')) {
      const value = saved?.values?.[input.name];
      if (value === undefined) continue;
      if (input.type === 'checkbox')
        input.checked = Array.isArray(value) && value.includes(input.value);
      else input.value = value;
    }
  };
  X.evidence = (v) =>
    (v || []).map((id) => {
      const a = X.current().attachments.find((a) => a.id === id);
      P.assert(
        a && form?.proofs[id] === a.version,
        '附件版本变化，请核对依据后重新选择',
      );
      return { id, version: a.version };
    });
  X.submit = async (path, input, global = false) => {
    const q = X.current();
    X.remember();
    const r = await A.write(
      q.id,
      path,
      { expectedRevision: X.meta().expectedRevision, ...input },
      global,
    );
    if (form?.id === q.id) {
      form = null;
      A.activeForm = null;
      P.close();
    }
    if (P.r()?.id === q.id) {
      const stage = P.s.reqs[q.id].stage;
      P.go({ stage, panel: 'canvas' });
    }
    return r;
  };
  X.read = async (path) => A.request(X.current().id, path);
  X.field = (name, label, value = '', type = 'text') =>
    P.field(name, label, value ?? '', type);
  const fields = (prefix, items, values = {}) =>
    items
      .map(([name, label, type]) =>
        X.field(prefix + name, label, values[name], type || 'text'),
      )
      .join('');
  X.planEditor = (p = null, extra = {}) => {
    const q = X.current(),
      c = p?.content || {},
      saved = A.draft(q.id).forms?.plan,
      smoke = Array.from(
        { length: saved?.meta.smokeCount ?? (c.smoke?.length || 1) },
        (_, i) => c.smoke?.[i] || { checkId: 'SMOKE_' + (i + 1), title: '' },
      ),
      metrics = Array.from(
        { length: saved?.meta.metricCount ?? (c.metrics?.length || 1) },
        (_, i) =>
          c.metrics?.[i] || {
            metricId: 'METRIC_' + (i + 1),
            owner: window.PFCAPI.api.user.name,
          },
      ),
      meta = {
        basePlanId: p?.id || null,
        smokeCount: smoke.length,
        metricCount: metrics.length,
        ...extra,
      };
    X.open(
      'plan',
      '完善发布准备',
      V.source +
        fields(
          '',
          [
            ['target', '唯一目标 / 环境'],
            ['scope', '准确发布范围', 'textarea'],
            ['versionRef', '交付版本 / 对象'],
            ['releaseOwner', '发布负责人（当前成员）'],
            ['dependencies', '依赖与影响（可填无）', 'textarea'],
            ['risks', '风险（可填无）', 'textarea'],
            ['monitoring', '监控来源'],
            ['alertOwner', '告警负责人（当前成员）'],
            ['hours', '观察小时数（1–168）', 'number'],
          ],
          {
            hours: 24,
            releaseOwner: window.PFCAPI.api.user.name,
            alertOwner: window.PFCAPI.api.user.name,
            ...c,
          },
        ) +
        '<details open><summary>回退准备</summary>' +
        fields(
          'rollback_',
          [
            ['target', '回退目标版本'],
            ['steps', '回退步骤', 'textarea'],
            ['trigger', '触发条件', 'textarea'],
          ],
          c.rollback,
        ) +
        '</details>' +
        '<details open><summary>授权声明（不代表平台授权执行）</summary>' +
        fields(
          'auth_',
          [
            ['id', '授权编号'],
            ['target', '授权目标'],
            ['scope', '授权范围'],
            ['versionRef', '授权版本'],
            ['from', '授权起始时间（UTC，如2026-09-13T00:00:00Z）'],
            ['until', '授权截止时间（UTC）'],
            ['actor', '授权责任人'],
          ],
          c.authorization,
        ) +
        '<label><input type="checkbox" name="authActions" value="DEPLOY">发布</label> <label><input type="checkbox" name="authActions" value="ROLLBACK">回退</label>' +
        P.testingView.evidenceFields('authEvidence') +
        '</details>' +
        '<details open><summary>冒烟清单</summary>' +
        smoke
          .map(
            (v, i) =>
              '<fieldset><legend>冒烟 ' +
              (i + 1) +
              '</legend>' +
              fields(
                'smoke_' + i + '_',
                [
                  ['checkId', '稳定编号'],
                  ['title', '检查内容'],
                ],
                v,
              ) +
              '</fieldset>',
          )
          .join('') +
        b('m4-plan-add', '增加冒烟项', { kind: 'smoke' }) +
        '</details>' +
        '<details open><summary>观察指标与口径</summary>' +
        metrics
          .map(
            (v, i) =>
              '<fieldset><legend>指标 ' +
              (i + 1) +
              '</legend>' +
              fields(
                'metric_' + i + '_',
                [
                  ['metricId', '稳定编号'],
                  ['name', '指标名称'],
                  ['target', '预期目标'],
                  ['unit', '统计口径 / 单位'],
                  ['source', '数据来源'],
                  ['sampling', '采样方法'],
                  ['owner', '当前负责人'],
                  ['baseline', '当前基线'],
                ],
                v,
              ) +
              '</fieldset>',
          )
          .join('') +
        b('m4-plan-add', '增加指标', { kind: 'metric' }) +
        '</details>' +
        P.testingView.evidenceFields(),
      b('m4-plan-save', '保存准备草稿', {}, 'primary'),
      meta,
    );
    if (p && !A.draft(q.id).forms?.plan)
      for (const input of document.querySelectorAll(
        '#modal-root [type="checkbox"]',
      ))
        input.checked =
          input.name === 'authActions'
            ? c.authorization.actions.includes(input.value)
            : (input.name === 'authEvidence'
                ? c.authorization.evidence
                : c.evidence
              ).some((r) => r.id === input.value);
  };
  X.planValues = () => {
    const v = X.values(),
      m = X.meta(),
      take = (prefix, names) =>
        Object.fromEntries(names.map((n) => [n, v[prefix + n] || '']));
    return {
      ...take('', [
        'target',
        'scope',
        'versionRef',
        'releaseOwner',
        'dependencies',
        'risks',
        'monitoring',
        'alertOwner',
      ]),
      hours: Number(v.hours),
      rollback: take('rollback_', ['target', 'steps', 'trigger']),
      authorization: {
        ...take('auth_', [
          'id',
          'target',
          'scope',
          'versionRef',
          'from',
          'until',
          'actor',
        ]),
        actions: v.authActions || [],
        evidence: X.evidence(v.authEvidence),
      },
      smoke: Array.from({ length: m.smokeCount }, (_, i) =>
        take('smoke_' + i + '_', ['checkId', 'title']),
      ),
      metrics: Array.from({ length: m.metricCount }, (_, i) =>
        take('metric_' + i + '_', [
          'metricId',
          'name',
          'target',
          'unit',
          'source',
          'sampling',
          'owner',
          'baseline',
        ]),
      ),
      evidence: X.evidence(v.evidence),
      source: 'USER_REPORTED',
      basePlanId: m.basePlanId,
    };
  };
  X.resultEditor = async (d) => {
    const { release: p } = await X.read('/releases/' + d.id);
    let prior = null;
    if (d.record) {
      prior = (
        await X.read(
          '/releases/' +
            p.id +
            '/reported-results?limit=100&offset=' +
            (Number(d.offset) || 0),
        )
      ).items.find((r) => r.id === d.record);
      P.assert(prior?.status === 'UNKNOWN', '原未知记录已变化，请重新读取');
    }
    const kind = prior?.kind || d.kind || 'DEPLOY';
    X.open(
      'result:' + p.id + ':' + (prior?.id || kind),
      prior
        ? '核实原记录'
        : kind === 'ROLLBACK'
          ? '登记回退结果'
          : '登记发布结果',
      V.source +
        '<p>批准计划 ' +
        e(p.id) +
        ' · ' +
        e(p.content.target) +
        ' / ' +
        e(
          kind === 'ROLLBACK'
            ? p.content.rollback.target
            : p.content.versionRef,
        ) +
        '</p>' +
        P.select(
          'status',
          '实际结果',
          [
            ['UNKNOWN', '未知，需核实原记录'],
            ['SUCCESS', '成功'],
            ['FAILED', '失败'],
          ],
          prior?.status || 'UNKNOWN',
        ) +
        fields(
          '',
          [
            ['startedAt', '实际开始时间（UTC）'],
            ['endedAt', '实际结束时间（未知可留空）'],
            ['checkedAt', '最近核查时间（UTC）'],
            ['actual', '实际结果说明', 'textarea'],
            ['locator', '未知结果定位线索'],
            ['responsible', '未知结果责任人'],
          ],
          prior || {},
        ) +
        (kind === 'DEPLOY'
          ? p.content.smoke
              .map(
                (s, i) =>
                  '<fieldset><legend>' +
                  e(s.checkId) +
                  ' ' +
                  e(s.title) +
                  '</legend>' +
                  P.select(
                    'smoke_' + i,
                    '结果',
                    [
                      ['NOT_RUN', '未执行'],
                      ['PASS', '通过'],
                      ['FAIL', '失败'],
                    ],
                    prior?.smoke?.find((v) => v.checkId === s.checkId)
                      ?.status || 'NOT_RUN',
                  ) +
                  X.field(
                    'smokeActual_' + i,
                    '实际结果',
                    prior?.smoke?.find((v) => v.checkId === s.checkId)
                      ?.actual || '',
                  ) +
                  '</fieldset>',
              )
              .join('')
          : '') +
        P.testingView.evidenceFields(),
      b(
        'm4-result-save',
        prior ? '追加核验结果' : '保存人工结果',
        {},
        'primary',
      ),
      { release: p, previous: prior, kind },
    );
  };
  X.actions = {
    'm4-tests': async () => {
      const id = P.r().id;
      await P.verificationClient.load(id);
      P.verificationClient.tabs[id] = 'testing';
      P.go({ panel: 'canvas' });
    },
    'm4-artifacts': async () => {
      const id = P.r().id;
      await P.artifactClient.load(id);
      P.verificationClient.tabs[id] = 'artifacts';
      P.go({ panel: 'canvas' });
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
          '<p>此页核对交付、测试和产品验收输入。请在发布工作区完善计划并送审。</p>' +
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
          P.testingView.evidence(r.delivery?.evidence),
      );
    },
    'm4-open': async () => {
      const id = P.r().id;
      await A.load(id);
      delete P.verificationClient.tabs[id];
      P.s.ui.panel = 'canvas';
      A.tabs[id] = true;
      P.render();
    },
    'm4-observe': async () => {
      const id = P.r().id;
      await A.load(id);
      delete P.verificationClient.tabs[id];
      P.go({ stage: 'observe', panel: 'canvas' });
    },
    'm4-refresh': async () => {
      await A.load(P.r().id);
      P.render();
    },
    'm4-retry': async () => {
      await A.retry(P.r().id);
      form = null;
      A.activeForm = null;
      P.close();
      P.render();
    },
    'm4-plan-new': async () => {
      const plans = (await X.read('/release-plans?limit=1')).items;
      X.planEditor(
        plans.length
          ? (await X.read('/release-plans/' + plans[0].id)).release
          : null,
      );
    },
    'm4-plan-save': () => X.submit('/release-plans', X.planValues()),
    'm4-plan-add': (d) => {
      const value = X.planValues(),
        meta = X.meta();
      P.assert(d.kind === 'smoke' || d.kind === 'metric', '字段无效');
      const key = d.kind === 'metric' ? 'metrics' : 'smoke';
      P.assert(
        value[key].length < (d.kind === 'metric' ? 20 : 40),
        '已达条数上限',
      );
      value[key].push(
        d.kind === 'metric'
          ? { metricId: 'METRIC_' + (value[key].length + 1) }
          : { checkId: 'SMOKE_' + (value[key].length + 1) },
      );
      X.remember();
      const saved = A.draft(P.r().id);
      delete saved.forms.plan;
      A.save(P.r().id, saved);
      form = null;
      X.planEditor({ id: meta.basePlanId, content: value });
    },
    'm4-plan-detail': async (d) => {
      const { release: p } = await X.read('/releases/' + d.id),
        reviews = await X.read('/releases/' + d.id + '/reviews?limit=100');
      const w = A.states[P.r().id];
      X.open(
        'plan-detail',
        '发布准备 · ' + p.id,
        V.source +
          V.plan(p) +
          P.table(
            ['准备项', '内容'],
            [
              ['依赖', e(p.content.dependencies)],
              ['风险', e(p.content.risks)],
              ['监控', e(p.content.monitoring)],
              ['回退版本', e(p.content.rollback.target)],
              ['回退步骤', e(p.content.rollback.steps)],
              ['回退触发', e(p.content.rollback.trigger)],
              ['授权编号', e(p.content.authorization.id)],
              [
                '授权窗口',
                e(p.content.authorization.from) +
                  ' ～ ' +
                  e(p.content.authorization.until),
              ],
              ['授权范围', e(p.content.authorization.scope)],
            ],
          ) +
          P.table(
            ['评审', '意见', '当前评审人状态'],
            reviews.items.map((r) => [
              V.status(r.decision),
              e(r.comment),
              e(r.actor?.name) +
                ' / ' +
                e(r.actor?.role) +
                (r.actor?.active ? '' : ' / 已停用'),
            ]),
          ) +
          V.evidence(p.evidence) +
          (p.canReReview
            ? '<p>如存在待核实结果，本次重评将沿用冻结验收 ' +
              e(p.snapshot.acceptanceId) +
              '，仅用于核实原尝试。业务版本和证据仍须有效；不会发起新的发布。</p>'
            : '') +
          X.field('comment', '评审意见', '', 'textarea'),
        b('m4-plan-submit', '送Owner评审', {
          disabled:
            !w.actions.canWrite ||
            p.reviewState !== 'NOT_SUBMITTED' ||
            p.completeness !== 'READY',
        }) +
          b(
            'm4-plan-review',
            p.canReReview ? '重新评审原计划' : '批准准备',
            {
              decision: 'APPROVED',
              disabled:
                !w.actions.canReview ||
                (p.reviewState !== 'PENDING' && !p.canReReview),
            },
            'primary',
          ) +
          b('m4-plan-review', '驳回', {
            decision: 'REJECTED',
            disabled: !w.actions.canReview || p.reviewState !== 'PENDING',
          }),
        { release: p },
      );
    },
    'm4-plan-submit': () =>
      X.submit('/releases', { planId: X.meta().release.id }),
    'm4-plan-review': (d) =>
      X.submit(
        '/api/releases/' +
          X.meta().release.id +
          '/' +
          (d.decision === 'APPROVED' ? 'approve' : 'reject'),
        { comment: X.values().comment },
        true,
      ),
    'm4-result-new': (d) => X.resultEditor(d),
    'm4-result-save': () => {
      const v = X.values(),
        m = X.meta(),
        p = m.release;
      return X.submit(
        '/releases/' +
          p.id +
          (m.kind === 'ROLLBACK' ? '/reported-rollbacks' : '/reported-results'),
        {
          ...v,
          checkedAt: v.checkedAt || new Date().toISOString(),
          target: p.content.target,
          versionRef:
            m.kind === 'ROLLBACK'
              ? p.content.rollback.target
              : p.content.versionRef,
          source: 'USER_REPORTED',
          previousRecordId: m.previous?.id || null,
          evidence: X.evidence(v.evidence),
          smoke:
            m.kind === 'DEPLOY'
              ? p.content.smoke.map((s, i) => ({
                  checkId: s.checkId,
                  status: v['smoke_' + i],
                  actual: v['smokeActual_' + i],
                }))
              : [],
        },
      );
    },
    'm4-results': async (d) => {
      const offset = Number(d.offset) || 0,
        r = await X.read(
          '/releases/' + d.id + '/reported-results?offset=' + offset,
        );
      X.open(
        'results',
        '发布 / 回退记录',
        V.source +
          r.items
            .map((v) =>
              P.card(
                v.id + ' · ' + v.kind,
                V.status(v.status) +
                  '<p>' +
                  e(v.actual) +
                  '</p><p>' +
                  e(v.startedAt) +
                  ' ～ ' +
                  e(v.endedAt || '待核实') +
                  '</p>' +
                  (v.reconciliation
                    ? '<p>沿用冻结验收 ' +
                      e(v.reconciliation.acceptanceId) +
                      ' · 重评依据 ' +
                      e(v.reconciliation.reviewId) +
                      '</p>'
                    : '') +
                  V.evidence(v.evidence) +
                  (v.status === 'UNKNOWN'
                    ? b('m4-result-new', '核实原记录', {
                        id: d.id,
                        record: v.id,
                        offset,
                      })
                    : ''),
              ),
            )
            .join('') +
          X.paging('m4-results', r, { id: d.id }),
        b('m4-result-new', '登记回退结果', {
          id: d.id,
          kind: 'ROLLBACK',
          disabled:
            !A.states[P.r().id].actions.canWrite ||
            !!A.states[P.r().id].closedAt,
        }),
      );
    },
    'm4-history': async (d) => {
      P.assert(
        ['release-plans', 'observations'].includes(d.kind),
        '历史类型无效',
      );
      const r = await X.read(
        '/' + d.kind + '?offset=' + (Number(d.offset) || 0),
      );
      X.open(
        'history',
        '历史记录',
        P.table(
          ['编号', '状态', '查看'],
          r.items.map((v) => [
            e(v.id),
            V.status(v.status),
            b(
              d.kind === 'release-plans'
                ? 'm4-plan-detail'
                : 'm4-observation-detail',
              '查看',
              { id: v.id },
            ),
          ]),
        ) + X.paging('m4-history', r, { kind: d.kind }),
      );
    },
    'm4-return': (d) =>
      X.open(
        'return',
        '由Owner返回修复',
        V.source +
          '<p>原报告和记录保留。新交付必须重新测试、验收及发布评审。</p>' +
          P.select(
            'returnStage',
            '返回阶段',
            [
              ['dev', '开发'],
              ['design', '设计'],
              ['req', '需求'],
            ],
            'dev',
          ) +
          X.field('comment', '返回原因', '', 'textarea'),
        b('m4-return-save', '确认返回修复', {}, 'primary'),
        { releaseId: d.id },
      ),
    'm4-return-save': () =>
      X.submit(
        '/releases/' + X.meta().releaseId + '/return-to-repair',
        X.values(),
      ),
    'm4-check-current': async () => {
      X.remember();
      const q = P.r(),
        old = form;
      P.assert(
        q && old?.id === q.id && old.identity === A.key(q.id),
        '身份或窗口变化',
      );
      const w = await A.load(q.id);
      P.assert(
        w && form === old && old.identity === A.key(q.id),
        '身份或窗口变化，请重新核对',
      );
      const d = A.draft(q.id);
      X.open(
        'compare',
        '比较当前依据',
        P.table(
          ['依据', '打开时', '当前'],
          [
            ['需求修订', e(old.meta.expectedRevision), e(w.revision)],
            [
              '当前发布',
              e(old.meta.release?.id || old.meta.releaseId || '准备草稿'),
              e(w.currentRelease?.id || '无'),
            ],
          ],
        ) + '<p>原输入已保留。确认后请重新打开原表单，重新选择变化的证据。</p>',
        b('m4-use-current', '确认使用当前依据', {}, 'primary'),
        { old, key: old.key, draft: d },
      );
    },
    'm4-use-current': async () => {
      const m = X.meta(),
        id = P.r().id,
        d = A.draft(id),
        saved = d.forms?.[m.key];
      if (saved) {
        if (m.key === 'plan')
          saved.meta.basePlanId = A.states[id]?.plans.items[0]?.id || null;
        saved.meta.entryHeads = A.states[id]?.currentObservation?.latestEntries;
        if (saved.meta.followupId) {
          const result = await X.read(
              '/observations/' +
                saved.meta.observationId +
                '/followups?limit=100',
            ),
            followup = result.items.find((f) => f.id === saved.meta.followupId);
          P.assert(followup, '遗留项不可用');
          saved.meta.sequence = followup.sequence + 1;
          saved.meta.previousRecordId = followup.previousRecordId;
        }
        saved.meta.expectedRevision = P.r().revision;
        saved.proofs = Object.fromEntries(
          P.r().attachments.map((a) => [a.id, a.version]),
        );
        if (saved.values) {
          saved.values.evidence = [];
          saved.values.authEvidence = [];
        }
        A.save(id, d);
      }
      P.close();
      P.toast('已核对当前修订，请重新打开原表单确认后提交');
    },
  };
  X.paging = (action, r, data) =>
    '<div class="btn-group">' +
    (r.offset
      ? b(action, '上一页', {
          ...data,
          offset: Math.max(0, r.offset - r.limit),
        })
      : '') +
    '<span>' +
    e(r.total) +
    '条</span>' +
    (r.offset + r.limit < r.total
      ? b(action, '下一页', { ...data, offset: r.offset + r.limit })
      : '') +
    '</div>';
  X.install = (remote) => {
    A.install();
    V.install();
    Object.assign(X.actions, P.observationActions.actions);
    for (const [name, fn] of Object.entries(X.actions))
      remote[name] = async (...args) => {
        try {
          return await fn(...args);
        } catch (err) {
          X.remember();
          queueMicrotask(() => {
            const n = document.querySelector('#form-error');
            if (n) {
              n.tabIndex = -1;
              n.focus();
            }
          });
          throw err;
        }
      };
    const modal = P.modal,
      close = P.close;
    P.modal = (...args) => {
      X.remember();
      form = null;
      A.activeForm = null;
      return modal(...args);
    };
    P.close = (...args) => {
      X.remember();
      form = null;
      A.activeForm = null;
      return close(...args);
    };
    for (const name of ['input', 'change'])
      document.addEventListener(name, (ev) => {
        if (ev.target.closest('#modal-root form')) X.remember();
      });
  };
})();
