(() => {
  'use strict';
  const P = window.PFC,
    G = P.governanceDomain,
    { esc: e, btn: b, card, badge } = P;
  const names = { owner: '负责人', executor: '执行者', viewer: '只读成员' };
  const tabs = [
    ['catalog', '能力目录'],
    ['bind', '阶段绑定'],
    ['team', '团队角色'],
    ['workspace', '项目 / Bridge'],
    ['knowledge', '知识库'],
    ['audit', '审计'],
    ['budget', '预算'],
  ];
  const owner = () => P.s.role === 'owner' && !G.denied,
    write = () => ['owner', 'executor'].includes(P.s.role) && !G.denied;
  const action = (id, text, data = {}, kind = '', ownerOnly = false) =>
    b(
      id,
      text,
      {
        ...data,
        disabled: !!data.disabled || !(ownerOnly ? owner() : write()),
        title: (ownerOnly ? owner() : write()) ? '' : '当前角色无操作权限',
      },
      kind,
    );
  const page = (tab) =>
    G.pages[tab] || { items: [], total: 0, limit: 20, offset: 0 };
  const paging = (tab) => {
    const p = page(tab);
    return `<div class="btn-group"><span>共 ${p.total} 条 · ${p.total ? Math.min(p.offset + 1, p.total) : 0}–${Math.min(p.offset + p.items.length, p.total)}</span>${b('gov-page', '上一页', { tab, offset: Math.max(0, p.offset - p.limit), disabled: p.offset === 0 })}${b('gov-page', '下一页', { tab, offset: p.offset + p.limit, disabled: p.offset + p.limit >= p.total || p.offset + p.limit > 10000 })}</div>`;
  };
  const filter = (tab) => {
    const f = G.filter(tab);
    return `<form id="gov-filter"><div class="actions">${tab === 'audit' ? P.field('actor', '操作人', f.actor || '') + P.field('action', '动作', f.action || '') : P.field('q', tab === 'knowledge' ? '标题 / 标签' : '名称', f.q || '')}${tab === 'knowledge' ? P.select('type', '类型', [['', '全部'], ...['复盘结论', '组件规范', '接口契约', '踩坑记录', 'Playbook'].map((t) => [t, t])], f.type || '') : ''}${b('gov-filter', '筛选', { tab })}</div></form>`;
  };
  const catalog = () =>
    card(
      '能力目录',
      `<p class="muted">登记元数据 → 复核 → 显式启用。名称与版本不可变；登记本身不会安装、连接或执行工具。</p>${filter('catalog')}` +
        P.table(
          ['能力 / 版本', '协议与来源', '描述', '状态', '操作'],
          page('catalog').items.map((c) => [
            e(c.name) + `<p class="muted">${e(c.id)} · ${e(c.ver)}</p>`,
            badge(c.type, 'purple') +
              `<p>${e(c.src || '未填写')}</p><small>${e(c.endpoint || '未填写连接描述')}</small>`,
            e(c.desc),
            badge(
              c.pending ? '待复核' : c.enabled ? '已启用' : '已停用',
              c.pending ? 'orange' : c.enabled ? 'green' : 'gray',
            ),
            b('cap-detail', '详情', { id: c.id }) +
              (c.pending
                ? action('review-cap', '复核通过', { id: c.id }, '', true)
                : action(
                    'toggle-cap',
                    c.enabled ? '停用' : '启用',
                    { id: c.id },
                    c.enabled ? '' : 'primary',
                    true,
                  )),
          ]),
        ) +
        paging('catalog'),
      action('register-cap', '登记能力', {}, 'primary', true),
    );
  const bindGroups = [
    ['Skill', 'Skills'],
    ['终端工具', '终端工具'],
    ['MCP', 'MCP 连接器'],
  ];
  const bindings = () =>
    card(
      '阶段默认能力',
      '<p class="muted">新配置用于新计划。既有计划保留原集合，但所用能力停用后不可启动。</p>' +
        P.table(
          ['阶段 / 修订', 'Skills', '终端工具', 'MCP 连接器', '模型'],
          G.bindings.map((s) => {
            const bound = (s.caps || []).filter((c) => s.capIds.includes(c.id));
            const col = (type) => {
              const items = bound.filter((c) => c.type === type);
              const cells = items
                .map((c) =>
                  '<span class="chip chip-bound">' +
                    action('cap-detail', e(c.name), { id: c.id }, '', true) +
                    action(
                      'unbind-binding',
                      '×',
                      { stage: s.stage, id: c.id, name: c.name },
                      '',
                      true,
                    ) +
                  '</span>',
                )
                .join('');
              const avail = page('catalog').items.filter(
                (c) => c.type === type && !s.capIds.includes(c.id) && c.enabled !== false,
              ).length;
              const plus = owner()
                ? action(
                    'bind-pick',
                    '＋ 添加',
                    { stage: s.stage, type },
                    '',
                    true,
                  ) + '<span class="chip-src">' + avail + ' 可选</span>'
                : '';
              return (
                '<div class="bind-cell">' +
                (cells || '<span class="muted">—</span>') +
                plus +
                '</div>'
              );
            };
            return [
              '<b class="bind-stage-name">' + e(P.stageName(s.stage)) + '</b>' +
                '<p class="muted">修订 ' + s.revision + ' · ' + bound.length + ' 项</p>',
              col('Skill'),
              col('终端工具'),
              col('MCP'),
              col('模型'),
            ];
          }),
        ) +
        '<p class="source-note">已绑定能力为浅蓝标签，点击解除；点「＋」弹窗按类型选择可添加能力。更多能力请在能力目录登记后使用。</p>',
    );
  const team = () =>
    card(
      '当前身份与团队',
      P.table(
        ['当前账号', '稳定身份', '角色', '身份来源'],
        [
          [
            e(window.PFCAPI.api.user?.name),
            e(window.PFCAPI.api.user?.id || '—'),
            e(names[P.s.role]),
            '本机开发允许名单 · 非生产认证',
          ],
        ],
      ) +
        P.table(
          ['成员', '角色', '状态 / 修订', '操作'],
          page('team').items.map((m) => [
            e(m.name) + `<p class="muted">${e(m.id)}</p>`,
            e(names[m.role]),
            badge(m.active ? '有效' : '已停用', m.active ? 'green' : 'gray') +
              ` · ${m.revision}`,
            m.active
              ? action('edit-member', '改角色', { id: m.id }, '', true) +
                action('remove-member', '停用', { id: m.id }, 'danger', true)
              : '历史身份保留',
          ]),
        ) +
        paging('team') +
        '<p class="source-note">最后一位有效负责人不能停用或降权。旧登录使用数据库中的当前权限。</p>',
      action('add-member', '登记成员', {}, 'primary', true),
    );
  const projects = () =>
    card(
      '项目登记',
      filter('workspace') +
        P.table(
          ['项目', '路径 / 仓库', '分支 / 技术栈', '登记状态'],
          page('workspace').items.map((p) => [
            e(p.name) + `<p class="muted">${e(p.id)}</p>`,
            e(p.path) + `<p>${e(p.repo || '未登记仓库')}</p>`,
            e(p.branch || '未登记分支') + `<p>${e(p.tech.join(' / '))}</p>`,
            badge('已登记，未扫描', 'cyan') + `<p>${e(P.time(p.loadedAt))}</p>`,
          ]),
        ) +
        paging('workspace') +
        '<p class="source-note">项目路径与仓库只作为上下文元数据。此操作不获取目录执行权，也不建立真实 Bridge 连接。</p>',
      action('load-project', '登记项目', {}, 'primary'),
    );
  const knowledge = () =>
    card(
      '组织知识库',
      `<p class="muted">手工登记文本。新需求按标题、标签匹配，最多保存三个版本化引用；后续读取保留创建时的引用。</p>${filter('knowledge')}` +
        P.table(
          ['条目 / 版本', '类型', '标签', '内容', '操作'],
          page('knowledge').items.map((k) => [
            e(k.title) + `<p class="muted">${e(k.id)} · v${k.version}</p>`,
            badge(k.type, 'purple'),
            e(k.tags.join('、')),
            e(k.content.slice(0, 80)),
            b('gov-knowledge-detail', '查看全文', { id: k.id }),
          ]),
        ) +
        paging('knowledge'),
      action('add-knowledge', '登记条目', {}, 'primary'),
    );
  const audit = () =>
    owner()
      ? card(
          '治理与执行审计',
          filter('audit') +
            P.table(
              ['时间 / 操作人', '实体', '动作', '记录'],
              page('audit').items.map((a) => [
                e(P.time(a.time)) + `<p>${e(a.actor)}</p>`,
                e(a.entityType + ' · ' + (a.entityId || '需求')),
                e(a.action),
                e(a.detail),
              ]),
            ) +
            paging('audit') +
            '<p class="source-note">导出使用相同筛选的完整快照，最多10,000条 / 5 MiB，超限需缩小范围。导出准备行为留痕，下载结果以浏览器为准。</p>',
          b('export-audit', '导出筛选结果'),
        )
      : card(
          '审计访问',
          '<p>仅负责人可以查询和导出团队审计。当前角色无权访问。</p>',
        );
  const budget = () => {
    const v = G.budget;
    return card(
      '预算与计量',
      P.table(
        ['周期', '状态', '额度', '已用', '剩余', '来源'],
        [
          [
            e(v?.period || '—'),
            v?.configured ? '已配置' : '未配置',
            v?.quota == null ? '—' : e(String(v.quota)),
            v?.used == null ? '—' : e(String(v.used)),
            v?.remaining == null ? '—' : e(String(v.remaining)),
            e(v?.source || 'unconfigured'),
          ],
        ],
      ) +
        '<p class="source-note">未接入真实模型计量；模拟作业不会产生真实扣费。本页只读。</p>',
    );
  };
  G.render = () => {
    const selected = new URLSearchParams(location.hash.split('?')[1] || '').get(
      'govTab',
    );
    if (tabs.some(([id]) => id === selected)) P.s.ui.govTab = selected;
    const tab = P.s.ui.govTab,
      body = (
        {
          catalog,
          bind: bindings,
          team,
          workspace: projects,
          knowledge,
          audit,
          budget,
        }[tab] || catalog
      )();
    return `<main class="guide-page"><div class="page-head"><div><h1>治理中心</h1><p>成员、项目与执行输入 · 当前权限 ${e(names[P.s.role])}</p></div>${b('gov-refresh', '刷新配置与身份')}</div>${G.error ? P.notice('配置回读失败：' + G.error + '。已保留输入，请恢复连接后重试。', 'gov-refresh', '重试') : ''}${G.loading ? '<p role="status">正在读取配置…</p>' : ''}${P.tabs(tabs, tab, 'gov-tab')}${body}</main>`;
  };
  G.showSession = () => {
    const s = G.session,
      caps = [
        ...new Map(
          [...P.s.caps, ...s.effectiveCaps].map((c) => [c.id, c]),
        ).values(),
      ];
    G.formKey = null;
    P.modal(
      '本需求阶段能力',
      `<p>${e(s.reqId)} · ${e(P.stageName(s.stage))} · 需求修订 ${s.revision}</p><p>新配置用于新计划，现有计划输入保持不变。</p>` +
        P.table(
          ['能力', '版本', '本需求选择'],
          caps.map((c) => [
            e(c.name),
            e(c.ver),
            action(
              'toggle-session',
              s.effectiveCaps.some((x) => x.id === c.id)
                ? '已装载 · 移除'
                : '装载',
              { id: c.id, disabled: !write() || !c.enabled || c.pending },
              s.effectiveCaps.some((x) => x.id === c.id) ? 'primary' : '',
            ),
          ]),
        ) +
        '<p class="muted">更多能力可在治理目录筛选后返回调整。</p>',
      action('reset-session', '恢复阶段默认') + b('close-modal', '完成'),
    );
  };
  G.snapshot = (plan) => {
    const s = plan?.contextSnapshot;
    if (!s)
      return '<p>历史计划无上下文快照。待启动计划需要重新创建并批准。</p>';
    return (
      `<div data-plan-fingerprint="${e(plan.contextFingerprint)}"><p>${badge('服务端已保存输入', 'cyan')} ${e(s.requirement.id)} · ${e(P.stageName(s.requirement.stage))}</p>` +
      P.table(
        ['输入', '本计划使用'],
        [
          [
            '项目',
            s.project
              ? e(s.project.name + ' · ' + s.project.branch) +
                `<p>${e(s.project.path)}</p>`
              : '未关联项目',
          ],
          [
            '确认版本',
            s.artifacts
              .map((v) =>
                e(P.stageName(v.stage) + ' v' + v.version + ' · ' + v.id),
              )
              .join('<br>'),
          ],
          [
            '材料',
            s.materials
              .map((m) =>
                e(
                  m.name +
                    ' v' +
                    m.version +
                    ' · ' +
                    m.status +
                    (m.allowed ? '' : ' · 禁止使用'),
                ),
              )
              .join('<br>') || '无材料',
          ],
          [
            '能力',
            s.capabilities.effectiveCaps
              .map((c) => e(c.name + ' · ' + c.ver))
              .join('<br>') || '未装载能力',
          ],
          [
            '绑定基线',
            '修订 ' +
              s.capabilities.bindingRevision +
              ' · ' +
              s.capabilities.overrides.length +
              ' 项覆盖',
          ],
          [
            '知识引用',
            s.knowledgeRefs
              .map((k) => e(k.title + ' v' + k.version + ' · ' + k.reason))
              .join('<br>') || '无命中',
          ],
          [
            '批准',
            plan.approvedAt
              ? e(
                  plan.approvedBy +
                    ' · ' +
                    plan.approvedMemberId +
                    ' · ' +
                    names[plan.approvedRole],
                ) +
                '<p>' +
                e(P.time(plan.approvedAt)) +
                '</p>'
              : '待当前有权限成员批准',
          ],
        ],
      ) +
      `<p class="source-note">输入指纹 ${e(plan.contextFingerprint)}<br>新配置用于新计划；启动仍检查版本、所用能力和审批人当前权限。执行来源为模拟。</p></div>`
    );
  };
  G.planCard = (run) =>
    card(
      '本次作业输入',
      run.contextPlan?.contextSnapshot
        ? `<p>${e(run.contextPlan.contextSnapshot.project?.name || '未关联项目')} · ${run.contextPlan.contextSnapshot.artifacts.length} 个确认版本 · ${run.contextPlan.contextSnapshot.capabilities.effectiveCaps.length} 项能力</p><p class="muted">${e(run.contextPlan.contextFingerprint)}</p>`
        : '<p>历史计划无上下文快照</p>',
      b(
        'gov-plan-context',
        run.status === 'WAITING_APPROVAL' ? '查看输入 / 批准' : '查看冻结输入',
        { id: run.id },
      ),
    );
  G.decorate = () => {
    if (!P.domainView.pg()) return;
    const avatar = document.querySelector('.avatar');
    if (avatar) {
      avatar.textContent = (window.PFCAPI.api.user?.name || '用').slice(0, 1);
      avatar.title =
        (window.PFCAPI.api.user?.name || '未登录') + ' · ' + names[P.s.role];
    }
    const fakeRole = document.querySelector('#app [data-action="scenarios"]');
    if (fakeRole) {
      fakeRole.dataset.action = 'gov-refresh';
      fakeRole.textContent = '刷新当前权限';
      const text = fakeRole.parentElement.querySelector('span');
      if (text) text.textContent = '当前数据库角色为只读成员，修改操作不可用。';
    }
    const ownerActions = new Set(
      'register-cap save-cap review-cap toggle-cap toggle-binding bind-pick bind-cap-pick add-member save-member edit-member save-member-role remove-member gov-disable-member export-audit'.split(
        ' ',
      ),
    );
    const writeActions = new Set(
      'load-project save-project attach-project pick-project add-knowledge save-knowledge toggle-session reset-session plan-run start-run reject-plan'.split(
        ' ',
      ),
    );
    for (const el of document.querySelectorAll('button[data-action]'))
      if (
        (ownerActions.has(el.dataset.action) && !owner()) ||
        (writeActions.has(el.dataset.action) && !write())
      ) {
        el.disabled = true;
        el.title = '当前角色无操作权限';
      }
  };
})();
