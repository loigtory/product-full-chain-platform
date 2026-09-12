(() => {
  const P = window.PFC,
    { esc: e, btn: b, card, badge, icon: i } = P;
  P.emptySpace = () =>
    `<div class="guide-page">${card('开始第一条需求', '<p>登记一个想法，逐步澄清、设计并交付。</p><div class="btn-group">' + b('new-requirement', '创建需求', {}, 'primary') + '</div>')}</div>`;
  const open = (r) =>
    b('open-work', '进入工作区', { req: r.id, stage: r.stage });
  P.renderHome = () => {
    const rs = Object.values(P.s.reqs);
    if (!rs.length) return P.emptySpace();
    const pending = rs.filter((r) => !r.closed),
      runs = rs
        .flatMap((r) => r.runs.map((run) => ({ r, run })))
        .filter(
          (x) => !['SUCCEEDED', 'CANCELLED', 'FAILED'].includes(x.run.status),
        );
    return (
      `<main class="guide-page"><div class="page-head"><div><h1>早上好，陈立</h1><p>围绕需求继续推进。${pending.length} 条需求待处理，${runs.length} 个作业需关注。</p></div><div class="actions">${b('new-requirement', i('plus') + ' 创建需求')}${P.r() ? b('open-work', i('terminal') + ' 继续作业：' + e(P.r().id), { req: P.r().id }, 'primary') : ''}</div></div><div class="guide-grid">` +
      card(
        i('clock') + ' 我的待办',
        pending
          .map(
            (r) =>
              `<div class="event"><div class="page-head"><div><b>${e(r.id + ' · ' + r.name)}</b><p class="muted">${P.stageName(r.stage)} · ${e(P.blockers(r).join('；') || '可推进下一阶段')}</p></div>${open(r)}</div></div>`,
          )
          .join('') || '<div class="empty-stage">当前没有待办</div>',
      ) +
      card(
        i('activity') + ' 运行与恢复',
        runs
          .map(
            ({ r, run }) =>
              `<div class="event"><b>${e(run.id)} · ${badge(P.labels[run.status], run.status === 'UNKNOWN' ? 'orange' : 'cyan')}</b><p>${e(r.name)} · ${run.pct}% · ${e(run.controller)} 控制</p>${open(r)}</div>`,
          )
          .join('') || '<div class="empty-stage">没有运行中的作业</div>',
      ) +
      card(
        i('sparkles') + ' Agent 简报',
        `<div class="event">${rs.filter((r) => r.impact).length} 条材料影响待处理</div><div class="event">${rs.reduce((n, r) => n + r.defects.filter((d) => d.status !== 'CLOSED').length, 0)} 个缺陷待关闭</div><div class="event">${rs.filter((r) => r.release?.status === 'PENDING').length} 条发布审批待处理</div><p class="source-note">由当前原型记录汇总，不生成未经执行的成功结论。</p>`,
      ) +
      card(
        i('list') + ' 最近需求',
        P.table(
          ['需求', '阶段', '状态', ''],
          rs.map((r) => [
            e(r.id + ' · ' + r.name),
            P.stageName(r.stage),
            badge(r.closed ? '已完成' : '进行中', r.closed ? 'green' : 'blue'),
            open(r),
          ]),
        ),
      ) +
      `</div></main>`
    );
  };
  P.renderProduct = () => {
    const r = P.r(),
      u = P.s.ui,
      rs = Object.values(P.s.reqs),
      filtered = rs.filter((x) =>
        (x.id + x.name + x.owner)
          .toLowerCase()
          .includes(u.search.toLowerCase()),
      );
    if (!r) return P.emptySpace();
    let body = '';
    if (u.productTab === 'requirements')
      body = P.table(
        ['需求 / 负责人', 'CAP / Unit', '阶段', '待完成', '操作'],
        filtered.map((x) => [
          e(x.id + ' · ' + x.name) + '<p class="muted">' + e(x.owner) + '</p>',
          e(x.capId) + '<br>' + x.units.length + ' Units',
          P.stageName(x.stage),
          e(x.closed ? '已完成' : P.blockers(x).join('；') || '可推进'),
          open(x),
        ]),
      );
    if (u.productTab === 'materials')
      body = card(
        e(r.id) + ' · 来源材料',
        P.table(
          ['材料', '版本 / 基线', '使用范围', '状态', ''],
          r.materials.map((m) => [
            e(m.name),
            `v${m.version} / ${r.baseline}`,
            e(
              m.classification +
                ' · ' +
                (m.allowed ? '本需求可用' : '禁止用于 AI'),
            ),
            badge(m.status, m.status === '已纳入' ? 'green' : 'orange'),
            b('material-detail', '查看', { id: m.id }),
          ]),
        ) +
          `<div class="btn-group">${b('add-material', '登记 / 上传材料', {}, 'primary')}${r.impact ? b('material-impact', '处理影响') : ''}</div>`,
      );
    if (u.productTab === 'artifacts')
      body = P.table(
        ['阶段', '产物', '最新版本', '评审', '操作'],
        P.D.STAGES.map((st) => {
          const v = P.latest(r, st.id);
          return [
            P.stageName(st.id),
            e(v.title),
            e(v.id),
            badge(
              v.stale ? '需重新评审' : v.confirmed ? '已确认' : v.review,
              v.confirmed && !v.stale ? 'green' : 'orange',
            ),
            b('open-artifact', '打开', { stage: st.id }),
          ];
        }),
      );
    if (u.productTab === 'trace')
      body = card(
        e(r.id) + ' · 关系追踪',
        `<p class="muted">需求 → CAP → Unit → AC → 产物版本 → 作业/测试 → 证据。下方引用可定位同一条需求。</p>` +
          P.table(
            ['CAP / Unit', 'AC', '当前产物', '执行 / 测试', '操作'],
            r.units.map((unit, n) => [
              e(r.capId + ' / ' + unit.id),
              e(r.acs[n % r.acs.length]?.id || '待关联'),
              e(P.latest(r, 'req').id),
              e(r.runs.at(-1)?.id || '未执行') +
                ' / ' +
                e(r.tests[n % Math.max(1, r.tests.length)]?.runId || '未测试'),
              b('open-artifact', '需求版本', { stage: 'req' }) +
                b('open-work', '执行证据', { req: r.id, panel: 'evidence' }),
            ]),
          ) +
          `<div class="btn-group">${b('edit-scope', '维护 Unit 与 AC')}${b('export-evidence', '导出关系与证据')}</div>`,
      );
    if (u.productTab === 'timeline')
      body = card(
        e(r.id) + ' · 决策与时间线',
        `<div class="event-list">${r.timeline
          .slice()
          .reverse()
          .map(
            (x) =>
              `<div class="event"><b>${e(x.action)}</b><p>${e(x.detail)}</p><small>${e(x.id)} · ${P.time(x.time)} · ${e(x.actor)}</small>${b('open-work', '定位阶段', { req: r.id, stage: x.stage })}</div>`,
          )
          .join('')}</div>`,
      );
    return `<main class="guide-page"><div class="page-head"><div><h1>产品空间</h1><p>${e(P.s.team.name)} · 需求与产物的统一入口</p></div>${b('new-requirement', i('plus') + ' 创建需求', {}, 'primary')}</div>${P.tabs(
      [
        ['requirements', '需求清单'],
        ['materials', '来源材料'],
        ['artifacts', '产物版本'],
        ['trace', '关系追踪'],
        ['timeline', '决策时间线'],
      ],
      u.productTab,
      'product-tab',
    )}<div class="filter-bar">${u.productTab === 'requirements' ? `<input class="filter-input" id="requirement-filter" aria-label="筛选需求" placeholder="按编号、名称或负责人筛选" value="${e(u.search)}">` : `<span>${e(r.id + ' · ' + r.name)}</span>${b('switch-req', '切换需求')}`}</div>${body}</main>`;
  };
  P.renderDelivery = () =>
    `<main class="guide-page"><div class="page-head"><div><h1>交付中心</h1><p>按同一需求汇总开发、测试、验收、发布和观察，完成状态以关联记录为准。</p></div>${b('open-work', '继续当前作业', { req: P.r()?.id }, 'primary')}</div>${card(
      '交付概览',
      P.table(
        ['需求', '开发', '测试', '验收', '发布', '观察', ''],
        Object.values(P.s.reqs).map((r) => [
          e(r.id + ' · ' + r.name),
          badge(r.runs.at(-1) ? P.labels[r.runs.at(-1).status] : '未开始'),
          badge(
            r.tests.length
              ? r.tests.every((x) => x.status === 'PASS')
                ? 'PASS'
                : 'FAIL'
              : '未执行',
            r.tests.every((x) => x.status === 'PASS') && r.tests.length
              ? 'green'
              : 'gray',
          ),
          e(r.accept?.status || '待验收'),
          e(r.release?.status || '待准备'),
          e(r.closed ? '已复盘' : r.observation ? '观察中' : '未开始'),
          open(r),
        ]),
      ),
    )}</main>`;
})();
