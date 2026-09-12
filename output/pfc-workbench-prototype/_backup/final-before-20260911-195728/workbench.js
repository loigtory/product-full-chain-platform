(() => {
  const P = window.PFC,
    { esc: e, icon: i, btn: b, badge, card } = P;
  const hints = {
    idea: '先明确目标与边界，再确认需求草案。',
    req: '梳理 CAP / Unit 与验收标准，确认当前需求版本。',
    design: '对齐方案、依赖和实现范围，再发起本地作业。',
    dev: '在同一需求中跟进代码、Shell 和测试输出，随时补充信息或处理异常。',
    test: '把 AC 映射到测试与缺陷，保留失败结果并验证修复。',
    accept: '产品验收需负责人查看实际结果并记录结论。',
    release: '确认准确版本、环境和回滚；审批与执行分别记录。',
    observe: '完成观察窗口，记录实际指标、结论和后续事项。',
  };
  P.artifactCard = (r, stage) => {
    const v = P.latest(r, stage);
    return card(
      i('file') + ' ' + e(v.title),
      `<p class="muted">${e(r.id)} · ${e(v.id)} · 材料基线 ${r.baseline}</p>` +
        `<table class="diff-table"><thead><tr><th>字段</th><th>当前内容</th></tr></thead><tbody>${v.fields.map((f) => `<tr><td class="field">${e(f.name)}</td><td class="doc-body">${e(f.value)}</td></tr>`).join('')}</tbody></table>` +
        `<div class="btn-group">${b('open-artifact', i('eye') + ' 查看 / 比较', { stage })}${b('edit-artifact', i('file') + (v.confirmed ? '创建后续草稿' : '编辑草稿'), { stage, disabled: !P.canWrite() })}${!v.confirmed || v.stale ? b('confirm-artifact', i('check') + ' 确认当前版本', { stage, id: v.id, disabled: !P.canWrite() }, 'primary') : ''}${b('review-artifact', '评审意见', { stage })}</div>` +
        (v.comments.length
          ? `<div class="source-note">最近评审：${e(v.comments.at(-1).text)}</div>`
          : ''),
      badge(
        v.stale
          ? '需重新评审'
          : v.confirmed
            ? '已确认 ' + v.version
            : '待确认 v' + v.version,
        v.confirmed && !v.stale ? 'green' : 'blue',
      ),
    );
  };
  P.terminal = (r, run, panel = false) =>
    `<div class="${panel ? 'panel-term' : 'term-box'}" id="${panel ? 'panel-term' : 'mirror-term'}"><div class="t-head">${i('terminal')} ${e(run?.id || '尚未发起作业')} · ${e(r.workspace)} · ${e(run?.controller || 'Web')}</div>${run ? run.lines.map((l) => `<div class="term-line"><span class="${l.cls}">${e(l.text)}</span></div>`).join('') : '<div class="term-line">连接本地 Bridge 后，命令输出会在这里同步。</div>'}${run?.status === 'RUNNING' ? '<span class="term-cursor"></span>' : ''}<div class="source-note">${e(run ? P.labels[run.status] : '未开始')} · ${run?.exitCode === null || run?.exitCode === undefined ? '尚无退出码' : 'exit ' + run.exitCode} · 原型模拟输出</div></div>`;
  P.runCard = (r) => {
    const run = P.run(r);
    if (!run)
      return card(
        i('cpu') + ' 本地开发作业',
        `<p>将当前需求、已确认方案和工作区交给 Agent，按一次任务范围连续使用 Shell / 文件 / Git。</p><div class="btn-group">${b('plan-run', '准备作业范围', {}, 'primary')}</div>`,
      );
    const steps = [
      '读取需求与代码',
      '检查工作区',
      '实现代码与测试',
      '执行单元测试',
      '构建与预览',
      '汇总变更及证据',
    ];
    let controls = '';
    if (
      ['RUNNING', 'QUEUED', 'WAITING_INPUT', 'WAITING_APPROVAL'].includes(
        run.status,
      )
    )
      controls += b('run-control', '停止运行', {
        control: 'cancel',
        disabled: !P.canWrite(),
      });
    if (['UNKNOWN', 'CANCELLED', 'FAILED'].includes(run.status))
      controls += b('run-control', '核验结果', {
        control: 'verify',
        disabled: !P.canWrite(),
      });
    if (['CANCELLED', 'FAILED'].includes(run.status) && run.verified)
      controls += b('plan-retry', '创建新尝试', { id: run.id }, 'primary');
    if (run.status === 'WAITING_INPUT')
      controls += b('run-input', '补充输入', {}, 'primary');
    if (run.status === 'WAITING_APPROVAL')
      controls += b('scope-approval', '查看新增范围', {}, 'primary');
    if (['RUNNING', 'WAITING_INPUT'].includes(run.status))
      controls += b(
        'run-control',
        run.controller === 'Web' ? '交给 Zed 控制' : '取回 Web 控制',
        { control: 'handoff' },
      );
    if (run.status === 'SUCCEEDED')
      controls +=
        b('plan-run', '发起新作业', {}, 'primary') +
        b('preview-toggle', run.preview ? '停止本地预览' : '启动本地预览');
    if (run.preview) controls += b('preview-open', '查看预览');
    const history = `<div class="run-list">${r.runs.map((x) => b('select-run', e(x.id), { id: x.id }, x.id === run.id ? 'primary' : '')).join('')}</div>`;
    return (
      history +
      card(
        i('cpu') + ' AgentRun #' + e(run.id),
        `<p class="muted">${e(run.operation)} · ${e(r.workspace)} · 控制端 ${e(run.controller)}${run.parentId ? ' · 关联旧作业 ' + e(run.parentId) : ''}</p>` +
          `<div class="progress-row"><div class="progress-bar"><div class="progress-fill" style="width:${run.pct}%"></div></div><span id="run-percent">${run.pct}%</span></div>` +
          `<div class="step-list">${steps.map((s, n) => `<div class="step-item ${n < run.step ? 'done' : n === run.step && run.status === 'RUNNING' ? 'active' : ''}"><span class="step-dot">${n < run.step ? i('check') : i('clock')}</span>${s}</div>`).join('')}</div>` +
          (run.status === 'UNKNOWN'
            ? P.notice('连接或页面中断后无法确认结果。核验旧作业后再决定重试。')
            : run.status === 'CANCELLING'
              ? P.notice('已请求取消，等待执行侧返回最终状态。')
              : '') +
          (run.stamp !== P.stamp(r) || r.rejectedRunIds?.includes(run.id)
            ? P.notice('该作业属于旧材料或方案版本，不能满足当前阶段退出条件。')
            : '') +
          `<div class="btn-group">${controls}${b('panel', '查看证据', { panel: 'evidence' })}</div>`,
        badge(
          P.labels[run.status],
          run.status === 'SUCCEEDED'
            ? 'green'
            : ['FAILED', 'UNKNOWN'].includes(run.status)
              ? 'red'
              : 'cyan',
        ),
      ) +
      card(
        i('terminal') + ' Zed 对话流 · 实时镜像',
        P.terminal(r, run),
        badge(
          run.controller === 'Zed'
            ? 'Zed 控制 / Web 观察'
            : 'Web 控制 / Zed 镜像',
          'cyan',
        ),
      )
    );
  };
  P.testCard = (r) =>
    card(
      i('shield') + ' 测试执行与缺陷',
      `<p class="muted">提测基线 ${e(P.stamp(r))}。每条 AC 保留执行结果与缺陷关系。</p>` +
        P.table(
          ['验收标准', '结果', '实际结果', '执行'],
          (r.tests.length
            ? r.tests
            : r.acs.map((a) => ({ ...a, status: 'NOT_RUN' }))
          ).map((t) => [
            e(t.id + ' · ' + t.text),
            badge(
              t.status,
              t.status === 'PASS'
                ? 'green'
                : t.status === 'FAIL'
                  ? 'red'
                  : 'gray',
            ),
            e(t.actual || '尚未执行'),
            e(t.runId || '—'),
          ]),
        ) +
        `<div class="btn-group">${b('run-tests', '执行测试（演示）', {}, 'primary')}${b('run-tests', '演示测试失败', { fail: '1' })}${b('open-test-cases', '用例与提测说明')}</div>` +
        (r.defects.length
          ? P.table(
              ['缺陷', '关联 AC', '状态', '处理'],
              r.defects.map((d) => [
                e(d.id + ' · ' + d.title),
                e(d.ac),
                badge(d.status, d.status === 'CLOSED' ? 'green' : 'orange'),
                d.status === 'OPEN'
                  ? b('resolve-defect', '登记修复', { id: d.id })
                  : e(d.status === 'RESOLVED' ? '等待重新测试' : '已关闭'),
              ]),
            )
          : ''),
    );
  P.acceptCard = (r) =>
    card(
      i('check') + ' 产品验收',
      `<p>负责人：${e(r.owner)}。测试通过与产品验收分别形成结论。</p>` +
        P.table(
          ['检查项', '证据'],
          [
            [
              '功能与 AC',
              e(
                r.tests.length
                  ? r.tests.map((t) => t.id + ': ' + t.status).join('；')
                  : '尚无测试结果',
              ),
            ],
            ['版本与变更', e(P.stamp(r))],
            [
              '未接受风险',
              e(
                r.defects
                  .filter((d) => d.status !== 'CLOSED')
                  .map((d) => d.title)
                  .join('；') || '无未关闭缺陷',
              ),
            ],
          ],
        ) +
        `<div class="btn-group">${b('accept-review', '填写验收结论', {}, 'primary')}${b('accept-reject', '驳回并返回开发', {}, 'danger')}</div>` +
        (r.accept
          ? `<p class="doc-body">${e(r.accept.status + ' · ' + r.accept.actor + ' · ' + r.accept.note)}</p>`
          : ''),
    );
  P.releaseCard = (r) => {
    const rel = r.release,
      expired = rel && rel.expiresAt <= P.now();
    return card(
      i('shield') + ' 发布准备与审批',
      (rel
        ? P.table(
            ['字段', '本次发布'],
            [
              ['发布记录', e(rel.id)],
              ['环境', e(rel.target)],
              ['范围', e(rel.scope)],
              ['版本', e(rel.stamp)],
              ['回滚', e(rel.rollback)],
              ['观察窗口', rel.hours + ' 小时'],
              [
                '审批有效期',
                expired ? badge('已过期', 'red') : e(P.time(rel.expiresAt)),
              ],
            ],
          )
        : '<p>先填写目标、范围、回滚与观察窗口，提交后由负责人批准。</p>') +
        `<div class="btn-group">${b('release-form', rel ? '重新准备 / 申请' : '填写发布准备')}${rel?.status === 'PENDING' ? b('release-action', '批准范围', { control: 'approve' }, 'primary') + b('release-action', '拒绝', { control: 'reject' }, 'danger') : ''}${rel?.status === 'APPROVED' ? b('release-action', '执行发布（演示）', { control: 'execute', disabled: expired }, 'primary') : ''}${['FAILED', 'SUCCEEDED'].includes(rel?.status) ? b('release-action', '执行回滚（演示）', { control: 'rollback' }, 'danger') : ''}</div>` +
        (rel?.status === 'APPROVED'
          ? P.notice('已批准，尚未执行。执行结果返回后才进入观察。')
          : rel?.status === 'FAILED'
            ? P.notice('发布失败。保留失败证据，可回滚并重新准备发布。')
            : '') +
        (r.releaseHistory.length
          ? `<div class="source-note">历史申请：${r.releaseHistory.map((x) => e(x.id + ' · ' + x.status)).join(' / ')}</div>`
          : ''),
      badge(
        rel
          ? expired && ['PENDING', 'APPROVED'].includes(rel.status)
            ? 'EXPIRED'
            : rel.status
          : '未申请',
        rel?.status === 'SUCCEEDED' ? 'green' : 'orange',
      ),
    );
  };
  P.observeCard = (r) => {
    const o = r.observation,
      elapsed = o ? Math.max(0, (P.now() - o.startedAt) / 3600000) : 0;
    return card(
      i('activity') + ' 观察与复盘',
      `<p>观察窗口：${elapsed.toFixed(1)} / ${o?.hours || 24} 小时。${r.closed ? '本需求已完成复盘。' : '完成窗口并记录指标后，可提交最终结论。'}</p>` +
        P.table(
          ['记录', '内容'],
          [
            ['发布版本', e(r.release?.stamp || '暂无发布记录')],
            ['回滚准备', e(r.release?.rollback || '—')],
            ['指标记录', e(o?.metrics || '等待记录')],
            ['最终结论', e(o?.conclusion || '尚未提交')],
          ],
        ) +
        `<div class="btn-group">${b('observe-form', '记录指标与复盘', {}, 'primary')}${r.release?.status === 'SUCCEEDED' && !r.closed ? b('release-action', '异常：回滚发布', { control: 'rollback' }, 'danger') : ''}</div>` +
        `<p class="source-note">演示时间可在顶部“原型场景”推进；正式产品依照真实观察时间与指标来源判断。</p>`,
      badge(r.closed ? '已完成' : '观察中', r.closed ? 'green' : 'cyan'),
    );
  };
  P.renderWork = () => {
    const r = P.r();
    if (!r) return P.emptySpace();
    const u = P.s.ui,
      stage = u.stage,
      run = P.run(r),
      actual = P.index(r.stage);
    const rail =
      `<aside class="ctx-rail"><div class="rail-section"><div class="req-name">${e(r.name)}</div><p class="muted">${e(r.id)}</p>${badge(P.stageName(r.stage) + (r.closed ? ' · 已完成' : ' · 进行中'), 'orange')}<div class="btn-group">${b('switch-req', i('box') + ' 切换需求')}</div><div class="meta-row">${i('user')} ${e(r.owner)} · 基线 ${r.baseline}</div><div class="stage-rail">${P.D.STAGES.map((s, n) => `<button class="stage-node ${n < actual ? 'passed ' : ''}${s.id === stage ? 'active ' : ''}${s.id === r.stage ? 'current' : ''}" data-action="view-stage" data-stage="${s.id}" aria-current="${s.id === stage ? 'step' : 'false'}"><span class="stage-dot">${s.dot}</span><span>${s.label}</span>${s.id === r.stage ? '<small class="stage-label">当前</small>' : s.id === stage ? '<small class="stage-label">查看</small>' : ''}</button>`).join('')}</div></div>` +
      `<div class="rail-section"><div class="rail-title">上下文 · ${P.stageName(stage)}</div><div class="ctx-list">${r.materials
        .filter((m) => m.status !== '排除')
        .map((m) =>
          b('material-detail', i('file') + ' ' + e(m.name), { id: m.id }),
        )
        .join(
          '',
        )}</div><div class="btn-group">${b('add-material', '添加材料')}</div><p class="rail-title">关联工作区</p><p>${e(r.workspace)}</p><p class="muted">${e(r.capId)} · ${r.units.length} Units</p>${b('space-tab', '关系追踪', { tab: 'trace' })}</div>` +
      `<div class="rail-section"><div class="rail-title">本阶段启用能力</div><div class="bind-cell">${
        P.effective(r, stage)
          .map(
            (c) =>
              `<span class="skill-chip on">${i('check')}${e(c.name)}</span>`,
          )
          .join('') || '<p class="muted">尚未装载能力</p>'
      }</div><div class="btn-group">${b('session-caps', '临时装载 / 调整')}${b('navigate', '治理中心', { route: 'gov' })}</div></div></aside>`;
    let content =
      stage === 'dev'
        ? P.runCard(r)
        : ['idea', 'req', 'design'].includes(stage)
          ? P.artifactCard(r, stage)
          : stage === 'test'
            ? P.testCard(r)
            : stage === 'accept'
              ? P.acceptCard(r)
              : stage === 'release'
                ? P.releaseCard(r)
                : P.observeCard(r);
    if (stage === 'idea')
      content =
        card(
          i('alert') + ' 需要澄清',
          r.questions
            .map(
              (q) =>
                `<div class="clarify-q ${q.answer ? 'picked' : ''}"><span class="num">${q.answer ? i('check') : '?'}</span><div class="txt">${e(q.text)}<p class="muted">${e(q.answer || '待回答')}</p></div>${b('answer-question', q.answer ? '修改回答' : '回答', { id: q.id })}</div>`,
            )
            .join(''),
        ) + content;
    if (stage === 'req')
      content += card(
        i('layers') + ' CAP / Unit 与验收标准',
        P.table(
          ['Unit', '名称', '状态'],
          r.units.map((x) => [e(x.id), e(x.name), e(x.status)]),
        ) +
          `<p class="source-note">${r.acs.map((a) => e(a.id + ' ' + a.text)).join('<br>')}</p><div class="btn-group">${b('edit-scope', '维护拆解与 AC')}</div>`,
      );
    if (stage === 'dev' && run?.status === 'SUCCEEDED')
      content += P.artifactCard(r, 'dev');
    const msgs = r.messages
      .filter((m) => m.stage === stage)
      .map(
        (m) =>
          `<div class="msg ${m.role}"><div class="msg-avatar">${i(m.role === 'user' ? 'user' : 'sparkles')}</div><div class="msg-bubble ${m.typing ? 'typing' : ''}">${e(m.text)}${m.proposal ? `<div class="btn-group">${b(m.proposal.action, m.proposal.label, {}, 'primary')}</div>` : ''}</div></div>`,
      )
      .join('');
    const intro = `<div class="msg ai"><div class="msg-avatar">${i('sparkles')}</div><div class="msg-bubble">${e(hints[stage])}<div class="source-note">${e(P.gates[stage])} · 当前需求 ${e(r.id)}</div></div></div>`;
    const blocks = P.blockers(r),
      isCurrent = stage === r.stage;
    const footer = `<div class="stage-footer"><span>${!isCurrent ? '正在查看 ' + P.stageName(stage) + '，当前阶段仍为 ' + P.stageName(r.stage) : r.closed ? '已完成本需求复盘' : blocks.length ? '待完成：' + e(blocks.join('；')) : '本阶段条件已满足'}</span>${!isCurrent ? b('view-stage', '返回当前阶段', { stage: r.stage }) : P.index(stage) < 6 ? b('advance', '进入' + P.stageName(P.D.STAGES[P.index(stage) + 1].id), { disabled: blocks.length || !P.canWrite(), title: blocks.join('；') }, 'primary') : ''}</div>`;
    return `<div class="work-layout" data-context="${r.id}:${stage}">${rail}<main class="chat-main"><div class="req-context-bar"><strong class="name">${e(r.id + ' · ' + r.name)}</strong>${badge('阶段 · ' + P.stageName(r.stage))}${!isCurrent ? badge('查看 · ' + P.stageName(stage), 'gray') : ''}${badge('Owner ' + r.owner, 'gray')}${b('navigate', '返回工作台', { route: 'home' })}</div><div class="stream" id="stream">${r.impact ? P.notice('材料已有新版本，需评估对当前范围和产物的影响。', 'material-impact', '评估影响') : ''}${intro}${content}${msgs}</div>${footer}<div class="composer"><button class="attch-btn" data-action="add-material" aria-label="添加附件">${i('plus')}</button><div class="composer-box"><textarea id="chat-input" rows="1" aria-label="继续对话" placeholder="继续对话：描述意图、追问、或让 Agent 发起作业…">${e(P.s.ui.drafts[r.id] || '')}</textarea></div><button class="send-btn" data-action="send" aria-label="发送" ${!P.canWrite() ? 'disabled' : ''}>${i('send')}</button></div></main>${P.renderPanel(r)}</div>`;
  };
  P.renderPanel = (r) => {
    const u = P.s.ui,
      run = P.run(r),
      stage = u.artifactStage || u.stage,
      versions = r.artifacts[stage],
      v = versions.find((x) => x.id === u.version) || versions.at(-1);
    let body = '';
    if (u.panel === 'terminal')
      body = `<div class="panel-title">${i('terminal')} 开发终端 · 实时镜像（Codex / Zed）</div>${P.terminal(r, run, true)}<div class="btn-group">${b('panel', '执行范围与证据', { panel: 'evidence' })}</div>`;
    else if (u.panel === 'canvas')
      body = `<div class="panel-title">${i('eye')} ${e(v.title)} · v${v.version}</div><label class="form-field">产物版本<select id="version-select">${versions.map((x) => `<option value="${x.id}" ${x.id === v.id ? 'selected' : ''}>v${x.version} · ${x.confirmed ? '已确认' : '草稿'}</option>`).join('')}</select></label>${badge(v.stale ? '需重新评审' : v.confirmed ? '已确认' : '待确认', v.confirmed && !v.stale ? 'green' : 'blue')}<div class="doc-body">${v.fields.map((f) => `<section class="doc-section"><h3>${e(f.name)}</h3>${e(f.value)}</section>`).join('')}</div><div class="btn-group">${b('focus-artifact', '聚焦阅读', { stage, id: v.id })}${b('compare-artifact', '版本比较', { stage })}${b('edit-artifact', '创建 / 编辑草稿', { stage })}</div>`;
    else
      body = `<div class="panel-title">${i('list')} 当前作业与证据</div>${P.table(
        ['关联', '记录'],
        [
          ['需求', e(r.id)],
          [
            'CAP / Unit',
            e(r.capId + ' / ' + r.units.map((x) => x.id).join(', ')),
          ],
          ['作业', e(run?.id || '未创建')],
          ['基线', e(run?.stamp || P.stamp(r))],
          ['工作区', e(r.workspace)],
          ['状态', e(run ? P.labels[run.status] : '未开始')],
          ['授权范围', e(run?.scope || '尚未授权')],
          [
            '能力快照',
            e(
              run?.snapshot.map((c) => c.name + ' ' + c.version).join('；') ||
                '示例初始作业',
            ),
          ],
          ['退出码', e(run?.exitCode ?? '未知')],
          ['数据源', '原型演示，无真实外部执行'],
        ],
      )}<div class="btn-group">${b('export-evidence', '导出证据摘要')}${b('mcp-read', '调用只读 MCP（演示）')}</div><div class="event-list">${r.timeline
        .slice(-8)
        .reverse()
        .map(
          (x) =>
            `<div class="event"><b>${e(x.action)}</b><small>${e(x.detail)} · ${P.time(x.time)}</small></div>`,
        )
        .join('')}</div>`;
    return `<aside class="side-panel"><div class="panel-tabs" role="tablist">${[
      ['terminal', '终端', 'terminal'],
      ['canvas', '画布', 'eye'],
      ['evidence', '证据', 'list'],
    ]
      .map(
        ([id, l, icon]) =>
          `<button class="panel-tab ${u.panel === id ? 'active' : ''}" role="tab" aria-selected="${u.panel === id}" data-action="panel" data-panel="${id}">${i(icon)}${l}</button>`,
      )
      .join('')}</div><div class="panel-body">${body}</div></aside>`;
  };
})();
