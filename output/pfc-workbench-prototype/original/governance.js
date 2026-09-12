(() => {
  const P = window.PFC,
    { esc: e, btn: b, card, badge, icon: i } = P;
  P.renderGovernance = () => {
    if (P.domainView?.pg()) return P.governanceDomain.render();
    const tab = P.s.ui.govTab;
    let body = '';
    if (tab === 'catalog')
      body = card(
        '能力目录 · Skill / MCP / 终端工具（开放协议）',
        `<p class="muted">登记来源与版本后复核启用；阶段默认和会话临时选择共同决定新作业可用能力。已执行作业保存原能力快照。协议：原生 Skill / MCP / ACP（agent 端点）均为可插拔接入。</p>` +
          P.s.caps
            .map(
              (c) =>
                `<div class="cap-row"><span class="cap-ico" style="background:${e(c.color)}">${i(c.ico)}</span><div class="cap-main"><b>${e(c.name)}</b> ${badge(c.type, 'purple')}${badge(c.protocol || (c.type === 'MCP' ? 'MCP' : c.type === '终端工具' ? '终端' : '原生 Skill'), 'cyan')}<p class="muted">${e(c.desc)}</p><small>${e(c.src)} · ${e(c.ver)} · ${e(c.perm)}${c.endpoint ? ' · ' + e(c.endpoint) : ''} ${c.pending ? '· 待复核' : ''}</small></div><div class="actions">${b('cap-detail', '详情', { id: c.id })}${c.pending ? b('review-cap', '复核通过', { id: c.id }) : b('toggle-cap', P.s.enabled.includes(c.id) ? '停用' : '启用', { id: c.id }, P.s.enabled.includes(c.id) ? '' : 'primary')}</div></div>`,
            )
            .join('') +
          `<div class="btn-group">${b('register-cap', '登记新能力（Skill / MCP / ACP）', {}, 'primary')}</div>`,
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
      body =
        card(
          '身份与访问（IAM · 演示）',
          P.table(
            ['项', '值'],
            [
              [
                '当前用户',
                '陈立（负责人）' + badge('企业 SSO 已登录', 'green'),
              ],
              ['租户', 'PFC-DEMO · 单租户隔离' + badge('内网部署', 'cyan')],
              ['成员数', String(P.s.team.members.length) + ' · 含只读观察员'],
              [
                '正式接入',
                '企业 SSO / SCIM 身份源与租户数据隔离由服务端处理；原型为单机演示',
              ],
            ],
          ),
        ) +
        card(
          '团队与角色',
          `<p>当前团队：${e(P.s.team.name)}</p>` +
            P.table(
              ['成员', '角色', '分工', '操作'],
              P.s.team.members.map((m) => [
                e(m.name),
                e(m.role),
                m.role === '负责人'
                  ? '产品、研发、测试与发布确认'
                  : m.role === '执行者'
                    ? '开发作业控制、测试执行、缺陷修复'
                    : '查看需求、版本及执行记录',
                b('edit-member', '改角色', { name: m.name }) +
                  (m.name !== '陈立'
                    ? b('remove-member', '移除', { name: m.name }, 'danger')
                    : ''),
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
              ].map((row) =>
                row.map((c) =>
                  c === '—' ? '<span class="muted">—</span>' : e(c),
                ),
              ),
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
          `<div class="btn-group">${b('pair-bridge', '配对本地电脑', {}, 'primary')}${b('edit-workspace', '登记 / 修改工作区')}</div>` +
          `<div class="rail-title">本地项目库（现有系统迭代）</div>` +
          P.table(
            ['项目', '路径 / 分支', '技术栈', '加载'],
            P.s.projects.map((pj) => [
              e(pj.name) +
                badge(pj.source === 'existing' ? '现有系统' : '全新', 'cyan'),
              e(pj.path) + '<br>' + e(pj.branch),
              e(pj.tech.join(' / ')),
              e(P.time(pj.loadedAt)) +
                '<br>' +
                (pj.files ? pj.files + ' 个文件' : '待 Bridge 扫描'),
            ]),
          ) +
          `<div class="btn-group">${b('load-project', '加载本地项目')}</div>` +
          `<p class="source-note">Bridge 在选定电脑执行 Shell、文件与 Git。浏览器呈现结果；此原型不会连接真实电脑，项目加载为模拟登记。</p>`,
      );
    if (tab === 'knowledge')
      body = card(
        '组织知识库 · 复盘 / 规范 / 契约沉淀',
        `<p class="muted">来源：复盘结论自动沉淀 + 手动登记。新需求创建时按关键词自动检索引用，形成组织复利。</p>` +
          P.table(
            ['条目', '类型', '来源需求', '内容', '沉淀时间'],
            P.s.knowledge.map((k) => [
              e(k.title) + badge(k.id, 'cyan'),
              badge(k.type, 'purple'),
              e(k.sourceReq || '—'),
              e((k.content || '').slice(0, 46)),
              e(P.time(k.at)),
            ]),
          ) +
          `<div class="btn-group">${b('add-knowledge', '手动登记条目', {}, 'primary')}</div>` +
          `<p class="source-note">复盘表单选择「沉淀到知识库」即自动入库；正式平台支持全文检索与向量召回。</p>`,
      );
    if (tab === 'plugins')
      body = card(
        '生态插件市场 · 安装即登记',
        `<p class="muted">安装后进入「能力目录」待复核，复核通过即可在阶段绑定中装载。正式平台经签名校验与安全审核后分发。</p>` +
          P.s.plugins
            .map(
              (p) =>
                `<div class="cap-row"><span class="cap-ico" style="background:${e(p.color)}">${i(p.ico)}</span><div class="cap-main"><b>${e(p.name)}</b> ${badge(p.protocol, 'cyan')}${P.s.caps.some((c) => c.name === p.name && !c.pending) ? badge('已安装', 'green') : P.s.caps.some((c) => c.name === p.name) ? badge('待复核', 'orange') : ''}<p class="muted">${e(p.desc)}</p><small>${e(p.author)} · ${e(p.ver)}${p.endpoint ? ' · ' + e(p.endpoint) : ''}</small></div><div class="actions">${P.s.caps.some((c) => c.name === p.name) ? '' : b('install-plugin', '安装', { id: p.id }, 'primary')}</div></div>`,
            )
            .join('') +
          `<p class="source-note">演示插件清单为合成样例，不声称真实分发渠道；正式平台支持社区提交、审核与版本签名。</p>`,
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
        ) +
          `<div class="btn-group">${b('export-audit', '导出审计 CSV（演示）')}</div>` +
          `<p class="source-note">正式平台支持按范围/时间过滤导出与留存策略；此处为浏览器本地下载演示。</p>`,
      );
    return `<main class="guide-page"><div class="page-head"><div><h1>治理中心 · 能力配置</h1><p>团队、设备、工具与执行范围在同一处管理。</p></div>${b('navigate', '返回工作台', { route: 'home' })}</div>${P.tabs(
      [
        ['catalog', '能力目录'],
        ['bind', '阶段绑定'],
        ['team', '团队角色'],
        ['workspace', '工作区 / Bridge'],
        ['knowledge', '知识库'],
        ['plugins', '插件市场'],
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
