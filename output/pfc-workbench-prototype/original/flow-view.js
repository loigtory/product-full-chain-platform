(() => {
  const P = window.PFC,
    D = window.PFCFlowData,
    M = window.PFCFlow;
  const e = P.esc,
    i = P.icon,
    b = P.btn,
    badge = P.badge;
  const names = {
    idea: '想法',
    req: '需求',
    design: '设计',
    dev: '开发',
    test: '测试',
    accept: '验收',
    release: '发布',
    observe: '观察复盘',
  };
  const types = { prototype: '原型', prd: 'PRD', design: '方案', ac: '验收项' };
  const command = (type, label, primary = false, disabled = false) =>
    b(
      'flow-command',
      label,
      { command: type, disabled },
      primary ? 'primary' : '',
    );
  function next(r) {
    const v = M.latest(r);
    if (
      r.proposal?.status === 'pending' &&
      !['RUNNING', 'PAUSED', 'UNKNOWN'].includes(r.run?.status)
    )
      return [
        'apply-proposal',
        r.stage === 'req' ? '采纳为新草稿' : '查看影响并采纳新草稿',
        '请比较关联变化；采纳后回到业务确认，历史证据保留。',
      ];
    if (v?.complete && r.question && !r.question.answer)
      return [
        'answer',
        '确认仅站内提醒',
        '需要你的决定；独立的验收项准备可以继续。',
      ];
    if (r.closed)
      return [
        r.followupId ? '' : 'create-followup',
        r.followupId ? '后续建议已采纳' : '采纳后续需求建议',
        '演练已完成，所有发布和观察记录均为合成数据。',
      ];
    if (r.stage === 'idea')
      return [
        'generate',
        '生成可体验草案',
        '从目标直接得到原型、PRD 和验收项草稿。',
      ];
    if (r.stage === 'req') {
      if (!v?.complete)
        return [
          'complete-generation',
          '补齐失败部分',
          '原型候选已保留；PRD 和验收项需要补齐。',
        ];
      if (r.question && !r.question.answer)
        return [
          'answer',
          '确认仅站内提醒',
          '需要你的决定；已授权的验收项准备可以继续。',
        ];
      if (r.proposal?.status === 'pending')
        return [
          'apply-proposal',
          '采纳为新草稿',
          '请比较原型、PRD 与验收项的关联差异。',
        ];
      return [
        'confirm-business',
        '确认当前业务方案',
        '确认体验和规则后，直接承接到实施设计。',
      ];
    }
    if (r.stage === 'design')
      return [
        'confirm-design',
        '确认设计并进入开发',
        '本次仅演练：规则筛选、消息去重、站内提醒；不执行真实工具。',
      ];
    if (r.stage === 'dev') {
      if (!r.run)
        return [
          'start-run',
          '开始开发演练',
          '已承接业务方案、实施范围和验收项。',
        ];
      if (r.run.status === 'UNKNOWN')
        return [
          'verify-run',
          '核验运行结果',
          '结果尚不明确；先核验，避免重复执行。',
        ];
      if (r.run.status === 'PAUSED')
        return [
          'resume',
          '从断点继续',
          '继续同一运行，不重新生成已经完成的结果。',
        ];
      if (r.run.status === 'CANCELLED')
        return [
          '',
          '运行已停止',
          '证据已保留。可调整规则，形成新的已确认基线后继续。',
        ];
      return [
        'step-run',
        '继续演练下一步',
        '按步骤查看确定性模拟输出；没有实际代码或 Shell 执行。',
      ];
    }
    if (r.stage === 'test')
      return r.tests?.status === 'FAIL'
        ? [
            'fix-tests',
            '修复失败项（演练）',
            '保留失败记录，仅修复受影响的去重场景，再验证。',
          ]
        : [
            'run-tests',
            '运行关联测试（演练）',
            '使用当前业务基线与代码候选，逐项核对验收标准。',
          ];
    if (r.stage === 'accept')
      return [
        'accept',
        '接受当前演练版本',
        '请体验原型并核对差异；此操作记录你的演练验收决定。',
      ];
    if (r.stage === 'release')
      return !r.release
        ? [
            'approve-release',
            '批准模拟发布',
            '目标：合成演练环境；回退：恢复上一合成版本。',
          ]
        : r.release.status === 'FAILED'
          ? [
              'retry-release',
              '重试模拟发布',
              '失败记录保留，最多演练 3 次；无外部发布。',
            ]
          : [
              'execute-release',
              '执行已批准的模拟发布',
              '批准与执行分别记录，当前仅进行本地演练。',
            ];
    return r.observation
      ? [
          'finish',
          '完成演练复盘',
          '固定样本已采集，复盘后续建议需要你确认才创建。',
        ]
      : [
          'collect-observation',
          '采集合成观察样本',
          '尚无真实运行指标；此按钮推进模拟时钟并填入固定样本。',
        ];
  }
  function prototype(v, u, readonly) {
    const days = u.previewDays ?? v.prototype.days,
      enabled = u.previewEnabled ?? true;
    return `<div class="flow-business"><div class="flow-business-head">${i('bell')}<div><strong>积分到期提醒</strong><p>管理你的提醒偏好</p></div>${badge('合成样例', 'gray')}</div><label class="flow-switch"><span>站内消息提醒<small>积分即将到期时提醒我</small></span><input id="flow-enabled" type="checkbox" aria-label="站内消息提醒" ${enabled ? 'checked' : ''} ${readonly ? 'disabled' : ''}></label><label class="form-field">提前提醒天数<div class="flow-input-unit"><input id="flow-days" type="number" min="1" max="30" value="${e(days)}" ${readonly ? 'disabled' : ''} aria-describedby="flow-days-help"><span>天</span></div></label><p id="flow-days-help" class="muted">支持 1–30 天，当前基线为提前 ${v.prototype.days} 天。</p><div id="flow-preview-error" class="flow-error" role="alert"></div><div class="flow-message-preview"><div class="flow-preview-label">${i('eye')} 消息预览</div>${!enabled ? '<p>提醒已关闭，不产生站内消息。</p>' : u.empty ? '<p>当前没有即将到期的积分。</p>' : `<strong>你的积分将在 ${e(days)} 天后到期</strong><p>查看即将到期的积分，安排使用计划。</p><span class="link">查看积分明细 →</span>`}</div><div class="btn-group">${b('flow-preview', '更新预览', { disabled: readonly })}${b('flow-empty', u.empty ? '查看有数据状态' : '查看空状态', {})}</div><p class="source-note">仅预览，不保存业务规则。通过下方“提出关联变更”更新方案。</p>${b('flow-propose', '提出关联变更', { disabled: readonly })}</div>`;
  }
  function canvas(s, u, r) {
    const v = r.versions.find((v) => v.id === u.version) || M.latest(r);
    if (!v)
      return `<div class="flow-canvas-empty">${i('eye')}<h3>先看到体验，再完善方案</h3><p>输入目标后生成合成候选。原型、PRD 和验收项会出现在这里。</p><p class="source-note">确定性演练 · 尚未调用 AI</p></div>`;
    const historical = v.id !== M.latest(r).id,
      readonly = historical || s.role === 'viewer';
    const tabs = `<div class="flow-artifact-tabs" role="tablist" aria-label="成果类型">${Object.entries(
      types,
    )
      .map(
        ([id, label]) =>
          `<button role="tab" aria-selected="${u.tab === id}" data-action="flow-tab" data-tab="${id}">${label}</button>`,
      )
      .join('')}</div>`;
    const version = `<div class="flow-version-bar"><label>关联基线<select id="flow-version" aria-label="关联基线">${r.versions.map((x) => `<option value="${e(x.id)}" ${x.id === v.id ? 'selected' : ''}>第 ${x.version} 组${x.id === M.latest(r).id ? ' · 当前' : ' · 历史'}</option>`).join('')}</select></label>${badge(historical ? '历史快照' : v.businessConfirmed ? '业务已确认' : '草稿', historical ? 'gray' : v.businessConfirmed ? 'green' : 'blue')}</div>`;
    let body;
    if (u.tab === 'prototype') body = prototype(v, u, readonly);
    else if (!v.complete && ['prd', 'ac'].includes(u.tab))
      body = P.notice('此部分生成失败，已保留可用原型。请补齐后确认。');
    else if (u.tab === 'prd')
      body = `<div class="doc-body"><h3>积分提醒 · PRD v${v.prd.version}</h3><section class="doc-section"><h3>目标</h3>${e(r.goal)}</section><section class="doc-section"><h3>规则</h3>${e(v.prd.text)}</section><section class="doc-section"><h3>范围与异常</h3>站内提醒；关闭时不发消息；无到期积分为空态。邮件、短信与真实消息中心未接入。</section><p class="source-note">来源：${e(r.materials[0].name)} · 关联原型 v${v.prototype.version}</p></div>`;
    else if (u.tab === 'design')
      body = `<div class="doc-body"><h3>实施设计 v${v.design.version}</h3><section class="doc-section">${e(v.design.text)}</section><section class="doc-section"><h3>实施范围</h3>读取合成到期记录 → 校验提醒开关 → 去重 → 输出站内消息候选。</section><section class="doc-section"><h3>验证与回退</h3>三个关联验收场景；模拟失败保留证据，恢复上一合成版本。</section>${badge(v.designApproved ? '设计已确认' : '设计准备稿', v.designApproved ? 'green' : 'orange')}</div>`;
    else
      body = `<div class="doc-body"><h3>验收项 v${v.ac.version}</h3>${v.ac.items.map((t, n) => `<div class="flow-ac"><span>AC-${n + 1}</span><p>${e(t)}</p>${badge(r.tests?.baselineId === v.id ? r.tests.items[n].result : '待验证', r.tests?.baselineId === v.id && r.tests.items[n].result === 'PASS' ? 'green' : 'gray')}</div>`).join('')}<p class="source-note">测试与原型指向同一组业务版本；测试结果为演练数据。</p></div>`;
    return (
      tabs +
      version +
      `<div class="flow-canvas-content">${body}</div><div class="btn-group flow-canvas-footer">${b('flow-expand', u.expanded ? '收起体验' : '展开体验', { id: 'flow-expand' })}${b('flow-diff', '查看关联差异', {})}</div>`
    );
  }
  function terminal(r, id) {
    return `<div class="terminal flow-terminal" id="${id}" tabindex="0" aria-label="模拟终端"><div class="flow-terminal-head">${i('terminal')} 合成演练 · 未连接实际终端</div>${(r.run?.lines || ['尚未启动开发演练。']).map((t) => `<div class="term-line">${e(t)}</div>`).join('')}</div>`;
  }
  function diff(r) {
    const v = M.latest(r),
      p = r.proposal;
    if (!p || p.status !== 'pending')
      return '<p class="muted">没有待采纳的关联变更。历史版本可以从右侧基线选择器查看。</p>';
    return `<div class="flow-diff"><h3>关联变更 · 待采纳</h3><p class="muted">基于第 ${v.version} 组版本，采纳后生成新草稿。</p>${['原型提醒设置', 'PRD 业务规则', '验收时间边界'].map((t) => `<div class="flow-diff-row"><span>${t}</span><del>提前 ${v.prototype.days} 天</del><strong>提前 ${p.days} 天</strong></div>`).join('')}<p class="source-note">原始材料和历史证据保留；设计及受影响结果需要重新确认。</p>${command('reject', '拒绝建议')}${b('flow-tab', '调整建议', { tab: 'prototype' })}</div>`;
  }
  function render(s, u, notice = '', busy = false) {
    const r = M.current(s),
      v = M.latest(r),
      isCurrent = u.stage === r.stage,
      readonly = s.role === 'viewer';
    const [type, label, summary] = next(r);
    const rail = `<aside class="ctx-rail"><div class="rail-section"><div class="req-name">${e(r.title)}</div><p class="source-note">合成演练 · ${r.id.endsWith('-A') ? 'A' : 'B'}</p>${badge(names[r.stage] + (r.closed ? ' · 演练完成' : ' · 进行中'), 'orange')}<label class="form-field flow-req-select">切换演练需求<select id="flow-req">${s.reqs.map((x) => `<option value="${e(x.id)}" ${x.id === r.id ? 'selected' : ''}>${e(x.title)}</option>`).join('')}</select></label><div class="stage-rail">${D.stages.map((st, n) => `<button class="stage-node ${n < D.stages.indexOf(r.stage) ? 'passed ' : ''}${st === u.stage ? 'active ' : ''}${st === r.stage ? 'current' : ''}" data-action="flow-stage" data-stage="${st}" aria-current="${st === u.stage ? 'step' : 'false'}"><span class="stage-dot">${P.D.STAGES[n].dot}</span><span>${names[st]}</span>${st === r.stage ? '<small class="stage-label">当前</small>' : n < D.stages.indexOf(r.stage) ? '<small class="stage-label">已承接</small>' : ''}</button>`).join('')}</div></div><div class="rail-section"><div class="rail-title">已承接上下文</div><div class="ctx-list">${r.materials.map((m) => b('flow-material', i('file') + ' ' + e(m.name), {})).join('')}</div><p class="muted">原始材料 1 项 · 不重复上传</p>${v ? `<div class="flow-context-version">${badge('第 ' + v.version + ' 组版本')}<p>原型 v${v.prototype.version} · PRD v${v.prd.version}<br>验收项 v${v.ac.version} · 方案 v${v.design.version}</p></div>` : ''}</div><div class="rail-section"><div class="rail-title">演练边界</div><p class="muted">本地合成数据<br>未调用 AI / Shell / CI<br>不会写入原需求或 API</p>${b('flow-options', '异常与角色演练', {})}${b('flow-clear', '清除此演练', {}, 'ghost')}</div></aside>`;
    let content = `<div class="flow-banner">${i('sparkles')} 连续协作演练 · 固定业务模板与模拟结果</div>`;
    if (notice)
      content += `<div class="flow-notice" role="alert">${e(notice)}<div class="btn-group">${b('flow-reload', '载入最新并核对', {})}${b('flow-retry', '重试上次保存', {})}</div></div>`;
    if (readonly)
      content += P.notice(
        '当前为只读演练身份，可浏览；在“异常与角色演练”中恢复负责人。',
      );
    content += P.card(
      i('sparkles') + ' 接下来做什么',
      `<p>${e(isCurrent ? summary : '正在查看' + names[u.stage] + '；当前仍在' + names[r.stage] + '。查看不会推进阶段。')}</p><div class="flow-ready"><span>${i('check')} 材料已关联</span><span>${v ? '第 ' + v.version + ' 组成果' : '候选待生成'}</span><span>${r.question && !r.question.answer ? '1 项待决定' : '无阻塞问题'}</span></div>`,
      badge(isCurrent ? names[r.stage] : '查看 · ' + names[u.stage]),
    );
    if (isCurrent && r.stage === 'idea')
      content += `<div class="card"><h3>描述你希望达成的目标</h3><label class="form-field">目标<textarea id="flow-goal" rows="3" maxlength="2000" ${readonly ? 'disabled' : ''}>${e(u.goals?.[r.id] ?? r.goal)}</textarea></label><p class="source-note">本轮使用“会员积分提醒”固定模板。自由输入仅作为文本保存，不声称已由 AI 分析。</p></div>`;
    if (v)
      content += `<div class="card flow-result"><div><h3>${i('layers')} ${v.complete ? '可体验候选已就绪' : '候选部分生成'}</h3><p class="muted">原型、PRD 与验收项共享业务基线，修改时一起核对。</p></div><div class="btn-group">${b('flow-tab', '体验原型', { tab: 'prototype' })}${b('flow-tab', '阅读 PRD', { tab: 'prd' })}${b('flow-tab', '查看验收项', { tab: 'ac' })}</div></div>`;
    if (r.question && !r.question.answer)
      content += `<div class="card"><h3>需要你决定</h3><p>${e(r.question.text)}</p><p class="muted">推荐仅演练站内提醒。邮件和短信会扩大本轮范围。</p>${command('prepare', r.prepared ? '验收项准备已完成' : '先完成独立的验收项准备', false, readonly || r.prepared)}</div>`;
    if (r.proposal?.status === 'pending' || u.showDiff)
      content += `<div class="card">${diff(r)}</div>`;
    if (r.impact)
      content += `<div class="flow-impact"><strong>变化已承接</strong><p>需复核：${e(r.impact.affected.join('、'))}</p><p>已保留：${e(r.impact.preserved.join('、'))}</p></div>`;
    if (
      r.run &&
      ['dev', 'test', 'accept', 'release', 'observe'].includes(u.stage)
    )
      content += `<div class="card"><h3>开发对话流 · ${e(r.run.status)}</h3>${terminal(r, 'flow-mirror-term')}<div class="btn-group">${r.run.status === 'RUNNING' ? command('pause', '暂停演练', false, readonly) : ''}${['RUNNING', 'PAUSED', 'UNKNOWN'].includes(r.run.status) ? command('cancel-run', '停止本次运行', false, readonly) : ''}</div></div>`;
    if (r.tests)
      content += `<div class="card"><h3>测试证据 · ${r.tests.status}（模拟）</h3>${r.tests.items.map((t) => `<div class="flow-test-row"><span>${e(t.text)}</span>${badge(t.result, t.result === 'PASS' ? 'green' : 'red')}</div>`).join('')}</div>`;
    if (r.stage === 'accept' && isCurrent)
      content += `<div class="card"><p>请基于当前第 ${v.version} 组原型与测试结果验收。</p>${command('return-acceptance', '退回去重问题（演练）', false, readonly)}</div>`;
    if (r.release)
      content += `<div class="card"><h3>发布记录 · ${e(r.release.status)}（模拟）</h3><p>${e(r.release.target)} · ${e(r.release.rollback)}</p><p class="source-note">批准、执行与结果分别留痕；未进行实际部署。</p></div>`;
    if (r.observation)
      content += `<div class="card"><h3>观察样本（合成）</h3><p>固定样本 ${r.observation.samples} 条 · 重复提醒 ${r.observation.duplicates} 条</p><p class="source-note">模拟观察窗口，不代表真实业务效果。</p></div>`;
    const lastHandoff = r.events.filter((x) => x.action === '阶段承接').at(-1);
    if (lastHandoff)
      content += `<details class="flow-handoff"><summary>${i('check')} 已自动承接 · 无需搬运材料</summary><p>${e(lastHandoff.detail)}</p><p>授权与退出条件按当前阶段分别核对。</p></details>`;
    content += r.messages
      .slice(-20)
      .map(
        (m) =>
          `<div class="msg ${m.role}"><div class="msg-avatar">${i(m.role === 'ai' ? 'sparkles' : 'user')}</div><div class="msg-bubble"><div class="msg-text">${e(m.text)}</div></div></div>`,
      )
      .join('');
    const footer = `<div class="stage-footer"><span>${busy ? '正在保存…' : !isCurrent ? '查看历史/准备阶段' : readonly ? '只读演练' : r.closed ? '演练完成 · 下一建议待确认' : '当前成果和下一动作会连续承接'}</span>${!isCurrent ? b('flow-stage', '返回当前阶段', { stage: r.stage }, 'primary') : type ? command(type, label, true, readonly || busy) : ''}</div>`;
    const composer = `<div class="composer"><div class="composer-row">${b('flow-material', i('clip') + ' 引用', {})}<div class="composer-box"><textarea id="flow-chat" rows="2" maxlength="2000" aria-label="演练反馈" placeholder="例如：提醒时间改成提前 3 天…" ${readonly ? 'disabled' : ''}>${e(u.drafts?.[r.id] ?? r.draft)}</textarea></div>${b('flow-send', '发送反馈', { disabled: readonly || busy }, 'primary')}</div><p class="source-note" id="flow-draft-state">${e(u.draftNote || '反馈仅保存在本地演练中')}</p></div>`;
    const heading = `<div class="req-context-bar"><strong class="name">${e(r.title)}</strong>${badge('阶段 · ' + names[r.stage])}${badge('演练身份 · ' + (readonly ? '只读' : '负责人'), 'gray')}${b('flow-exit', '返回原工作区', {})}</div>`;
    const body =
      u.panel === 'canvas'
        ? canvas(s, u, r)
        : u.panel === 'terminal'
          ? terminal(r, 'flow-panel-term')
          : `<div class="panel-title">演练证据与版本</div><p class="source-note">${e(r.id)} · 本地 revision ${s.revision}</p><p>数据源：固定模板 / 合成演练</p>${r.events
              .slice()
              .reverse()
              .map(
                (x) =>
                  `<div class="event"><b>${e(x.action)}</b><small>${e(x.detail)}</small></div>`,
              )
              .join('')}`;
    return P.workbenchShell.frame({
      context: r.id + ':' + u.stage,
      className: 'flow-room' + (u.expanded ? ' is-expanded' : ''),
      rail,
      main: `<main class="chat-main" aria-busy="${busy}">${heading}<div class="stream" id="stream">${content}</div>${footer}${composer}</main>`,
      panel: P.workbenchShell.panel({
        selected: u.panel,
        body,
        action: 'flow-panel',
      }),
    });
  }
  window.PFCFlowView = { render, next, names, types };
})();
