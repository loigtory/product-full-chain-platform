(() => {
  const P = window.PFC,
    { esc: e, btn: b, card, badge, icon: i } = P;
  P.renderGovernance = () => {
    const tab = P.s.ui.govTab;
    let body = '';
    if (tab === 'catalog')
      body = card(
        '能力目录 · Skill / MCP / 终端工具',
        `<p class="muted">登记来源与版本后复核启用；阶段默认和会话临时选择共同决定新作业可用能力。已执行作业保存原能力快照。</p>` +
          P.s.caps
            .map(
              (c) =>
                `<div class="cap-row"><span class="cap-ico" style="background:${e(c.color)}">${i(c.ico)}</span><div class="cap-main"><b>${e(c.name)}</b> ${badge(c.type, 'purple')}<p class="muted">${e(c.desc)}</p><small>${e(c.src)} · ${e(c.ver)} · ${e(c.perm)} ${c.pending ? '· 待复核' : ''}</small></div><div class="actions">${b('cap-detail', '详情', { id: c.id })}${c.pending ? b('review-cap', '复核通过', { id: c.id }) : b('toggle-cap', P.s.enabled.includes(c.id) ? '停用' : '启用', { id: c.id }, P.s.enabled.includes(c.id) ? '' : 'primary')}</div></div>`,
            )
            .join('') +
          `<div class="btn-group">${b('register-cap', '登记新能力', {}, 'primary')}</div>`,
      );
    if (tab === 'bind')
      body = card(
        '阶段默认能力',
        `<p class="muted">配置只影响后续回合或新作业；绑定不自动启用被团队停用的能力。</p>` +
          P.table(
            ['阶段', '默认装载'],
            P.D.STAGES.map((st) => [
              P.stageName(st.id),
              `<div class="bind-cell">${P.s.caps
                .filter((c) => !c.pending)
                .map((c) =>
                  b(
                    'toggle-binding',
                    e(c.name) +
                      (P.s.enabled.includes(c.id) ? '' : '（团队停用）'),
                    { stage: st.id, id: c.id },
                    P.s.bindings[st.id]?.includes(c.id) ? 'primary' : '',
                  ),
                )
                .join('')}</div>`,
            ]),
          ),
      );
    if (tab === 'team')
      body = card(
        '团队与角色',
        `<p>当前团队：${e(P.s.team.name)}</p>` +
          P.table(
            ['成员', '角色', '分工'],
            P.s.team.members.map((m) => [
              e(m.name),
              e(m.role),
              m.role === '负责人'
                ? '产品、研发、测试与发布确认'
                : m.role === '执行者'
                  ? '开发作业控制、测试执行、缺陷修复'
                  : '查看需求、版本及执行记录',
            ]),
          ) +
          `<div class="btn-group">${b('add-member', '登记成员')}</div>` +
          `<div class="rail-title">角色矩阵 · 可执行动作</div>` +
          P.table(
            ['动作', '负责人', '执行者', '只读'],
            [
              ['发起 / 停止作业', '✓', '✓', '—'],
              ['采纳建议 / 编辑产物', '✓', '✓', '—'],
              ['确认版本 / 推进阶段', '✓', '—', '—'],
              ['测试执行 / 缺陷处理', '✓', '✓', '—'],
              ['产品验收 / 发布审批', '✓', '—', '—'],
              ['治理中心配置', '✓', '—', '—'],
              ['查看全部记录', '✓', '✓', '✓'],
            ].map((row) => row.map((c) => (c === '—' ? '<span class="muted">—</span>' : e(c)))),
          ) +
          `<p class="source-note">原型使用单团队演示；切换只读角色可在“原型场景”验证。正式成员邀请与身份由服务端处理。</p>`,
      );
    if (tab === 'workspace')
      body = card(
        '仓库工作区与本地 Bridge',
        P.table(
          ['设备', '工作区', '连接', '操作'],
          P.s.bridges.map((br) => [
            e(br.id + ' · ' + br.name),
            e(br.workspace),
            badge(br.status, br.status === 'ONLINE' ? 'green' : 'orange'),
            b(
              'bridge-toggle',
              br.status === 'ONLINE' ? '断开（演示）' : '重新连接',
              { id: br.id },
            ) + b('bridge-revoke', '撤销配对', { id: br.id }, 'danger'),
          ]),
        ) +
          `<div class="btn-group">${b('pair-bridge', '配对本地电脑', {}, 'primary')}${b('edit-workspace', '登记 / 修改工作区')}</div><p class="source-note">Bridge 在选定电脑执行 Shell、文件与 Git。浏览器呈现结果；此原型不会连接真实电脑。</p>`,
      );
    if (tab === 'audit')
      body = card(
        '权限、能力与执行审计',
        P.table(
          ['时间 / 人员', '范围', '动作', '记录'],
          P.s.audit.map((a) => [
            e(P.time(a.time) + ' · ' + a.actor),
            e(a.req),
            e(a.action),
            e(a.detail),
          ]),
        ),
      );
    return `<main class="guide-page"><div class="page-head"><div><h1>治理中心 · 能力配置</h1><p>团队、设备、工具与执行范围在同一处管理。</p></div>${b('navigate', '返回工作台', { route: 'home' })}</div>${P.tabs(
      [
        ['catalog', '能力目录'],
        ['bind', '阶段绑定'],
        ['team', '团队角色'],
        ['workspace', '工作区 / Bridge'],
        ['audit', '装载与审计'],
      ],
      tab,
      'gov-tab',
    )}${body}</main>`;
  };
  P.sessionCaps = () => {
    const r = P.r(),
      stage = P.s.ui.stage;
    P.modal(
      '当前会话 · ' + P.stageName(stage) + '能力',
      `<p class="muted">仅作用于 ${e(r.id)} 当前阶段的新回合；团队禁用优先，运行中的快照不变。</p>` +
        P.s.caps
          .filter((c) => !c.pending)
          .map(
            (c) =>
              `<div class="cap-row"><div class="cap-main"><b>${e(c.name)}</b><p class="muted">${e(c.type + ' · ' + c.ver)}</p></div>${b('toggle-session', P.effective(r, stage).some((x) => x.id === c.id) ? '已装载 · 移除' : '临时装载', { id: c.id, disabled: !P.s.enabled.includes(c.id), title: P.s.enabled.includes(c.id) ? '' : '团队已停用' }, P.effective(r, stage).some((x) => x.id === c.id) ? 'primary' : '')}</div>`,
          )
          .join(''),
      b('reset-session', '恢复阶段默认') +
        b('close-modal', '完成', {}, 'primary'),
    );
  };
})();
