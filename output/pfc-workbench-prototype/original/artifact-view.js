(() => {
  'use strict';
  const P = window.PFC,
    A = P.artifactClient,
    e = (v) => P.esc(v),
    b = (...args) => P.btn(...args);
  const V = (P.artifactView = {});
  V.source = (s) =>
    ({ manual: '手工整理', import: '文件导入', template: '平台模板' })[
      s?.kind
    ] || '来源待核验';
  V.part = (kind, value, rules = []) => {
    if (!value) return '<p class="empty-stage">尚未补齐</p>';
    if (kind === 'prototype')
      return value.representation === 'spec'
        ? `<p>${e(value.spec.title)} · ${value.spec.pages.length} 页</p><div id="r2-preview"></div>`
        : '<p>原件已保存，交互运行尚未接入。确认前需记录原件评审与接受的预览限制。</p>' +
            b('r2-original', '查看原件 / 下载', {
              id: value.materialId,
              version: value.version,
            });
    if (kind === 'prd')
      return (
        `<h3>${e(value.title)}</h3>` +
        value.fields
          .map(
            (f, i) =>
              `<section class="doc-section" id="r2-rule-${i}"><h3>${e(f.name)}</h3><small>${e(
                rules
                  .filter((r) => r.fieldIndex === i)
                  .map((r) => r.ruleId)
                  .join('、'),
              )}</small><p>${e(f.value)}</p></section>`,
          )
          .join('')
      );
    return P.table(
      ['验收项 / 规则', '场景与步骤', '预期'],
      value.items.map((a) => [
        e(a.acId) + '<br>' + b('r2-rule', e(a.ruleId), { rule: a.ruleId }),
        e(a.scenario) +
          '<br>' +
          e(a.precondition) +
          '<ol>' +
          a.steps.map((s) => '<li>' + e(s) + '</li>').join('') +
          '</ol>',
        e(a.expected),
      ]),
    );
  };
  V.body = (q) => {
    const w = A.states[q.id];
    if (A.errors[q.id])
      return P.notice(
        '成果读取失败：' + A.errors[q.id],
        'r2-refresh',
        '重试读取',
      );
    if (!w)
      return (
        '<p role="status">正在读取关联成果…</p>' + b('r2-refresh', '重新读取')
      );
    const s = A.selections[q.id] || {},
      g = w.currentGroup,
      kind = s.kind || 'prototype';
    const blockers = [
      ...w.blockers,
      ...w.questions.map((x) => '待决定：' + x.text),
    ];
    let html =
      '<div class="panel-title">关联成果' +
      (g ? ' · 第 ' + g.version + ' 组' : ' · 尚未采纳') +
      '</div>';
    html +=
      P.badge(
        w.businessConfirmation ? '业务已确认' : '业务待确认',
        w.businessConfirmation ? 'green' : 'blue',
      ) +
      ' ' +
      P.badge(
        w.designConfirmation ? '设计已确认' : '设计待确认',
        w.designConfirmation ? 'green' : 'blue',
      );
    html +=
      '<p class="muted">原型、PRD与验收项共同演进；可先体验候选，再补齐规则。</p>';
    html +=
      '<div class="btn-group">' +
      (q.stage === 'dev'
        ? b('edit-artifact', '编辑开发记录', { stage: 'dev' })
        : '') +
      b('r2-edit', '整理候选', {}, 'primary') +
      b('r2-template', '从模板开始') +
      b('r2-import', '导入原件') +
      b('r2-history', '版本与确认历史') +
      b('r2-refresh', '刷新成果') +
      '</div>';
    if (A.draft(q.id).pending)
      html += P.notice(
        '上次提交结果待核验，输入与提交编号已保留。',
        'r2-retry',
        '核验原提交',
      );
    if (blockers.length)
      html +=
        '<details open><summary>需要处理 ' +
        blockers.length +
        ' 项</summary><ul>' +
        blockers.map((x) => '<li>' + e(x) + '</li>').join('') +
        '</ul></details>';
    if (w.impacts[0])
      html += P.notice(
        w.impacts[0].reason +
          '；从' +
          P.stageName(w.impacts[0].return_stage) +
          '继续。',
        'r2-return',
        '返回处理',
      );
    html += P.tabs(
      [
        ['prototype', '原型'],
        ['prd', 'PRD'],
        ['acceptance', '验收项'],
      ],
      kind,
      'r2-tab',
    );
    if (g) {
      html +=
        '<p>' +
        e(g[kind].id) +
        ' · v' +
        g[kind].version +
        (kind === 'prd' ? '' : ' · ' + V.source(g[kind].source)) +
        '</p>';
      html += V.part(kind, g[kind].content, g.rules);
    } else
      html +=
        '<div class="empty-stage">可以先保存只有原型的候选。完整三项与规则关联齐全后再采纳。</div>';
    html +=
      '<div class="btn-group">' +
      (q.stage === 'req'
        ? b('r2-confirm-business', '确认业务方案并进入设计', {}, 'primary')
        : q.stage === 'design'
          ? b('r2-confirm-design', '确认实施设计并进入开发', {}, 'primary')
          : '') +
      b('r2-inputs', '查看下一阶段输入') +
      '</div>';
    html +=
      '<h3>候选方案</h3>' +
      P.table(
        ['候选 / 来源', '状态', '处理'],
        w.proposals.map((p) => [
          e(p.id) + '<br>' + V.source(p.source),
          e(p.state) + (p.stale ? ' · 基线已变化' : ''),
          b('r2-proposal', '比较与处理', { id: p.id }),
        ]),
      );
    if (w.proposals.length === 20)
      html += b('r2-more', '查看更早候选', { offset: 20 });
    return html;
  };
  V.decorate = () => {
    if (document.querySelector('#modal-root iframe')) return;
    P.prototypePreview.destroy();
    if (
      !P.domainView.pg() ||
      P.s.ui.route !== 'work' ||
      document.querySelector('#modal-root [role="dialog"]')
    )
      return;
    const q = P.r(),
      w = A.states[q?.id],
      host = document.querySelector('#app #r2-preview');
    if (host && w?.currentGroup?.prototype.content.representation === 'spec')
      P.prototypePreview.mount(host, w.currentGroup.prototype.content.spec);
    for (const button of document.querySelectorAll('[data-action^="r2-"]'))
      if (
        [
          'r2-edit',
          'r2-template',
          'r2-import',
          'r2-confirm-business',
          'r2-confirm-design',
        ].includes(button.dataset.action)
      ) {
        button.disabled = !w?.actions.canEdit;
        button.setAttribute('aria-disabled', String(button.disabled));
      }
  };
  V.install = () => {
    const panel = P.renderPanel;
    P.renderPanel = (q) =>
      A.enabled() && P.s.ui.panel === 'canvas'
        ? P.workbenchShell.panel({ selected: 'canvas', body: V.body(q) })
        : panel(q);
  };
})();
