(() => {
  'use strict';
  const {
    ICONS,
    STAGES,
    CAPABILITIES,
    CONVO,
    CONVO1031,
    CONVO1018,
    REQS,
    STAGE_BIND,
  } = window.PFC_PROTOTYPE_DATA;
  const KEY = 'pfc.prototype.v3';
  const app = document.querySelector('#app');
  const dialog = document.querySelector('#dialog');
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const icon = (name) =>
    `<span class="v3-icon" aria-hidden="true">${ICONS[name] || ICONS.file}</span>`;
  const stageIndex = (id) => STAGES.findIndex((s) => s.id === id);
  const stageName = (id) => STAGES.find((s) => s.id === id)?.label || '想法';
  const button = (action, label, attrs = '', kind = '') =>
    `<button type="button" class="btn ${kind}" data-action="${action}" ${attrs}>${label}</button>`;
  const badge = (label, color = 'blue') =>
    `<span class="badge badge-${color}">${esc(label)}</span>`;
  const templates = {
    'R-1042': CONVO,
    'R-1031': CONVO1031,
    'R-1018': CONVO1018,
  };
  const hints = {
    idea: '先把目标、范围和关键规则说清楚，确认后进入需求阶段。',
    req: '核对需求文档与验收标准，确认本次做什么、做到什么程度。',
    design: '比较实现方案并确认边界，让后续开发有明确依据。',
    dev: '围绕已确认方案跟进任务；可以停止、恢复，并查看同一任务的记录。',
    test: '检查验收标准对应的测试结果，失败项处理后再推进。',
    accept: '逐项核对交付结果，确认验收清单后进入发布准备。',
    release: '先确认发布范围与回滚，再执行发布；批准和执行分别记录。',
    observe: '对照目标查看观察结果，记录结论与后续行动。',
  };

  function fresh() {
    const definitions = [
      ...REQS,
      { id: 'R-1056', name: '保单到期提醒', stage: 'idea' },
    ];
    const requirements = Object.fromEntries(
      definitions.map((meta) => {
        const source = clone(templates[meta.id] || {});
        const artifacts = {};
        for (const stage of STAGES) {
          const draft = source[stage.id]?.find((x) => x.t === 'draft');
          if (draft) {
            artifacts[stage.id] = [
              {
                id: `${meta.id}-${stage.id}-v1`,
                version: 1,
                title: draft.title,
                fields: draft.fields.map((f) => ({
                  name: f.f,
                  value: f.after,
                  before: f.before,
                })),
                confirmed: stageIndex(stage.id) < stageIndex(meta.stage),
              },
            ];
          }
        }
        // 每个文档单独从 v1 计数；历史种子只作为示例快照。
        const fallbackFields = {
          idea: [
            ['需求名称', meta.name],
            ['目标', '在保单到期前提醒用户及时处理续保'],
            ['范围', '到期前 30 天与 7 天触发；支持关闭提醒'],
            ['非目标', '本次不涉及自动续保或自动扣款'],
            ['验收标准', '规则命中时按所选渠道提醒；关闭后不再发送'],
          ],
          req: [
            ['背景', '用户容易遗漏保单到期时间'],
            ['用户故事', '作为投保人，我希望提前收到提醒，留出处理时间'],
            ['功能需求', '识别到期保单、生成提醒、尊重渠道偏好和退订'],
            [
              '验收标准',
              '30 / 7 天各提醒一次；同一保单同一节点不重复；退订立即生效',
            ],
          ],
          design: [
            [
              '方案比较',
              'A：独立提醒服务；B：复用消息中心。选择 B，减少重复建设',
            ],
            ['处理顺序', '筛选保单 → 检查偏好 → 去重 → 创建提醒'],
            ['失败处理', '失败保留原因，允许人工查看和重试'],
            ['本次边界', '仅覆盖提醒流程，不涉及支付与续保交易'],
          ],
          accept: [
            ['规则验收', '核对 30 / 7 天提醒节点与去重行为'],
            ['退订验收', '关闭提醒后不再创建发送任务'],
            ['使用体验', '能看到当前状态、失败原因和处理入口'],
          ],
        };
        if (meta.id !== 'R-1056') {
          const reqFields =
            source.req?.find((x) => x.t === 'draft')?.fields || [];
          fallbackFields.idea = [
            ['需求名称', meta.name],
            [
              '目标',
              reqFields.find((f) => f.f === '目标')?.after ||
                `明确「${meta.name}」的目标与边界`,
            ],
            [
              '范围',
              reqFields.find((f) => f.f === '范围')?.after ||
                '以已确认需求文档为准',
            ],
            [
              '验收标准',
              reqFields.find((f) => f.f === '验收标准')?.after ||
                '核对需求文档中列出的验收项',
            ],
          ];
          fallbackFields.design = [
            [
              '方案',
              source.design?.find((x) => x.t === 'ai')?.text ||
                '以当前需求的已确认方案为准',
            ],
            ['实现范围', `${meta.name}相关流程与交互`],
            ['验证要求', '覆盖已确认的验收标准并记录结果'],
          ];
          fallbackFields.accept = [
            ['功能验收', `逐项核对「${meta.name}」的验收标准`],
            ['使用体验', '核对主要操作、状态提示与异常反馈'],
            ['交付材料', '确认需求、设计和测试结果关联到同一需求'],
          ];
        }
        for (const [stage, fields] of Object.entries(fallbackFields)) {
          if (!artifacts[stage])
            artifacts[stage] = [
              {
                id: `${meta.id}-${stage}-v1`,
                version: 1,
                title: `${stageName(stage)}文档 · ${meta.name}`,
                confirmed: stageIndex(stage) < stageIndex(meta.stage),
                fields: fields.map(([name, value]) => ({
                  name,
                  value,
                  before: '（空）',
                })),
              },
            ];
        }
        // 未来验收清单表达待核对事项，不预先宣称结果通过。
        if (stageIndex(meta.stage) <= stageIndex('accept')) {
          artifacts.accept[0].fields = artifacts.accept[0].fields.map((f) => ({
            ...f,
            value:
              f.name === '视觉验收'
                ? '核对 1280 / 1440 / 1920 桌面布局、操作反馈与主要流程'
                : f.value.replace(/——\s*通过/g, '（待核对）'),
          }));
        }
        const runSeed = source.dev?.find((x) => x.t === 'progress');
        const run = {
          id: runSeed?.title.replace('AgentRun #', '') || 'R-156',
          workspace: runSeed?.workspace.split(' · ')[0] || 'pfc-policy',
          status:
            stageIndex(meta.stage) > 3
              ? 'done'
              : meta.stage === 'dev'
                ? 'running'
                : 'pending',
          pct: stageIndex(meta.stage) > 3 ? 100 : meta.stage === 'dev' ? 8 : 0,
          steps: runSeed?.steps.map((s) => s.label) || [
            '确认开发范围',
            '完成提醒规则',
            '核对交互与测试',
            '整理结果',
          ],
        };
        const questions =
          meta.id === 'R-1042'
            ? [
                {
                  id: 'q1',
                  text: '过期积分如何处理？',
                  answer: '自动清零，不提供兑换或延期。',
                },
                {
                  id: 'q2',
                  text: '提醒触达哪些渠道？',
                  answer: 'App 推送 + 短信双渠道。',
                },
              ]
            : [
                {
                  id: 'q1',
                  text: '提前多久提醒用户？',
                  answer: '到期前 30 天和 7 天各提醒一次。',
                },
                {
                  id: 'q2',
                  text: '本次使用哪些提醒渠道？',
                  answer: 'App 推送；用户可以关闭提醒。',
                },
              ];
        questions.forEach((q) => {
          q.value = meta.stage === 'idea' ? '' : q.answer;
        });
        return [
          meta.id,
          {
            id: meta.id,
            name: meta.name,
            currentStage: meta.stage,
            artifacts,
            questions,
            run,
            gates: {
              req: stageIndex(meta.stage) > 1,
              test: stageIndex(meta.stage) > 4,
            },
            approval: meta.stage === 'observe' ? 'approved' : 'pending',
            released: meta.stage === 'observe',
            retro: false,
            checks: [],
            messages: {},
            inputs: {},
            sessionCaps: {},
            events: [
              {
                id: 1,
                stage: meta.stage,
                text: `载入示例需求，当前处于${stageName(meta.stage)}阶段`,
                time: '示例起点',
              },
            ],
            nextEvent: 2,
          },
        ];
      }),
    );
    return {
      schema: 3,
      requirements,
      enabled: Object.fromEntries(CAPABILITIES.map((c) => [c.id, true])),
      bindings: clone(STAGE_BIND),
    };
  }
  function restore() {
    const base = fresh();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!saved) return base;
      if (saved.schema !== 3) throw new Error('schema');
      for (const [id, req] of Object.entries(base.requirements)) {
        const r = saved.requirements?.[id];
        if (
          !r ||
          stageIndex(r.currentStage) < 0 ||
          !Array.isArray(r.questions) ||
          r.questions.length !== 2 ||
          r.questions.some(
            (q) => typeof q.value !== 'string' || q.value.length > 2000,
          ) ||
          !r.artifacts ||
          Object.values(r.artifacts).some(
            (versions) =>
              !Array.isArray(versions) ||
              versions.length > 30 ||
              versions.some(
                (v) =>
                  !Array.isArray(v.fields) ||
                  v.fields.some(
                    (f) => typeof f.value !== 'string' || f.value.length > 5000,
                  ),
              ),
          ) ||
          !r.run ||
          !['pending', 'running', 'stopped', 'done'].includes(r.run.status) ||
          !Number.isFinite(r.run.pct) ||
          r.run.pct < 0 ||
          r.run.pct > 100 ||
          !Array.isArray(r.events) ||
          r.events.length > 100 ||
          !r.messages ||
          !r.inputs ||
          !r.gates ||
          !r.sessionCaps ||
          !Array.isArray(r.checks)
        )
          throw new Error('state');
        base.requirements[id] = { ...req, ...r, id: req.id, name: req.name };
      }
      for (const c of CAPABILITIES)
        if (typeof saved.enabled?.[c.id] === 'boolean')
          base.enabled[c.id] = saved.enabled[c.id];
      for (const stage of STAGES)
        if (Array.isArray(saved.bindings?.[stage.id]))
          base.bindings[stage.id] = [
            ...new Set(
              saved.bindings[stage.id].filter((id) =>
                CAPABILITIES.some((c) => c.id === id),
              ),
            ),
          ];
      return base;
    } catch {
      queueMicrotask(() => toast('保存记录无法读取，已载入初始示例。'));
      return base;
    }
  }
  let state = restore();
  let view = {
    route: 'home',
    req: 'R-1042',
    stage: 'dev',
    panel: 'terminal',
    artifact: '',
    diff: false,
    focus: false,
  };
  let railOpen = false;
  let configTab = 'directory';
  let configStage = 'dev';
  let toastTimer;
  let previousFocus;
  const current = () => state.requirements[view.req];
  const versions = (stage = view.stage) => current().artifacts[stage] || [];
  const latest = (stage = view.stage) => versions(stage).at(-1);
  const selected = () =>
    versions().find((a) => a.id === view.artifact) || latest();
  const liveStage = () => view.stage === current().currentStage;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch {
      toast('浏览器未能保存，当前操作仍保留在此页面；刷新后可能丢失。');
      return false;
    }
  }
  function toast(message) {
    const el = document.querySelector('#toast');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
  }
  function record(text, stage = view.stage) {
    const r = current();
    r.events.push({
      id: r.nextEvent++,
      stage,
      text,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    });
    r.events = r.events.slice(-100);
    save();
  }
  function readRoute() {
    const [path, query = ''] = location.hash.slice(2).split('?');
    const p = new URLSearchParams(query);
    view.route = ['home', 'work', 'space', 'delivery', 'governance'].includes(
      path,
    )
      ? path
      : 'home';
    view.req = state.requirements[p.get('req')] ? p.get('req') : 'R-1042';
    view.stage =
      stageIndex(p.get('stage')) >= 0 ? p.get('stage') : current().currentStage;
    view.panel = ['canvas', 'evidence', 'terminal'].includes(p.get('panel'))
      ? p.get('panel')
      : view.stage === 'dev'
        ? 'terminal'
        : 'canvas';
    view.artifact = p.get('artifact') || '';
    view.diff = p.get('mode') === 'diff';
    view.focus = p.get('focus') === '1';
    railOpen = false;
  }
  function navigate(patch) {
    view = { ...view, ...patch };
    const p = new URLSearchParams({
      req: view.req,
      stage: view.stage,
      panel: view.panel,
    });
    if (view.artifact) p.set('artifact', view.artifact);
    if (view.diff) p.set('mode', 'diff');
    if (view.focus) p.set('focus', '1');
    const hash = `#/${view.route}?${p}`;
    if (location.hash === hash) {
      render();
      return;
    }
    location.hash = hash;
  }
  function openRequirement(id, stage) {
    const r = state.requirements[id];
    if (!r) return;
    const target = stage || r.currentStage;
    navigate({
      route: 'work',
      req: id,
      stage: target,
      panel: target === 'dev' ? 'terminal' : 'canvas',
      artifact: '',
      diff: false,
      focus: false,
    });
  }
  function header() {
    return `<header class="global-header"><a href="#/home" class="brand"><span class="brand-mark">${icon('layers')}</span>PFC 产品全链路</a>
      <nav class="main-nav" aria-label="主导航">${[
        ['home', 'home', '我的工作台'],
        ['space', 'box', '产品空间'],
        ['delivery', 'git', '交付中心'],
        ['governance', 'shield', '治理中心'],
      ]
        .map(
          ([route, i, label]) =>
            `<button type="button" class="nav-item ${view.route === route || (route === 'home' && view.route === 'work') ? 'active' : ''}" data-action="nav" data-route="${route}">${icon(i)}${label}</button>`,
        )
        .join('')}</nav>
      <div class="header-right">${button('search', `${icon('search')}查找需求`, '', 'ghost')}<span class="demo-tag">V3 · 交互演示</span><span class="avatar" aria-label="演示用户">陈</span></div></header>`;
  }
  function home() {
    const r = state.requirements['R-1042'];
    return `<main id="main" class="home-wrap"><div class="home-hero"><div><div class="eyebrow">我的工作台</div><h1>把注意力放在下一步</h1><p class="sub">待确认的内容、正在进行的任务和最近的需求，都从这里继续。</p></div>${button('continue-work', `继续 · ${esc(r.name)} ${icon('chevron')}`, 'data-req="R-1042"', 'primary')}</div>
      <div class="v3-demo-note">${icon('eye')}本页为交互原型，所有需求与结果均为示例；操作仅保存在当前浏览器。</div>
      <div class="home-grid"><section class="panel-card"><h3>${icon('user')}需要你处理</h3>
        ${pendingTasks()}
      </section><section class="panel-card"><h3>${icon('activity')}任务动态</h3><div class="run-summary"><div><b>${esc(r.name)}</b><p class="muted">${esc(r.run.id)} · ${esc(r.run.workspace)}</p></div>${badge(runLabel(r.run.status), r.run.status === 'stopped' ? 'orange' : 'blue')}</div><div class="progress-bar"><div class="progress-fill" style="width:${r.run.pct}%"></div></div><div class="between"><span class="muted">分步演示进度 ${r.run.pct}%</span>${button('open-req', '查看任务', 'data-req="R-1042" data-stage="dev"', 'ghost')}</div></section>
      <section class="panel-card"><h3>${icon('shield')}阶段概览</h3><div class="overview-metrics"><div><strong>${Object.keys(state.requirements).length}</strong><span>示例需求</span></div><div><strong>${Object.values(state.requirements).filter((r) => r.currentStage === 'accept').length}</strong><span>验收阶段</span></div><div><strong>${Object.values(state.requirements).filter((r) => r.currentStage === 'observe').length}</strong><span>观察阶段</span></div></div><p class="muted">阶段由明确的推进操作更新；浏览历史或未来阶段不会改变进度。</p></section>
      <section class="panel-card"><h3>${icon('clock')}最近需求</h3>${Object.values(
        state.requirements,
      )
        .map(
          (r) =>
            `<button type="button" class="recent-row" data-action="open-req" data-req="${r.id}"><span><b>${esc(r.name)}</b><small>${r.id}</small></span>${badge(stageName(r.currentStage), 'gray')}${icon('chevron')}</button>`,
        )
        .join('')}</section></div>
      <div class="page-footer"><span>沿用原型的工作台布局与视觉语言 · 本地保存</span><a href="index.html">对照原版</a>${button('reset', '重置演示', '', 'ghost')}</div></main>`;
  }
  function pendingTasks() {
    return (
      ['R-1056', 'R-1031', 'R-1018', 'R-1042']
        .map((id) => {
          const r = state.requirements[id],
            stage = r.currentStage,
            a = r.artifacts[stage]?.at(-1);
          if (stage === 'observe' && r.retro) return '';
          const label = {
            idea: r.questions.some((q) => !q.value)
              ? '回答需求澄清问题'
              : a?.confirmed
                ? '推进到需求阶段'
                : '确认需求草案',
            req: !a?.confirmed
              ? '确认需求文档'
              : !r.gates.req
                ? '完成需求完整性检查'
                : '推进到设计阶段',
            design: a?.confirmed ? '推进到开发阶段' : '确认设计方案',
            dev:
              r.run.status === 'done'
                ? '推进到测试阶段'
                : r.run.status === 'stopped'
                  ? '继续已停止的任务'
                  : '跟进开发任务',
            test: r.gates.test ? '推进到验收阶段' : '完成测试检查',
            accept: a?.confirmed ? '推进到发布阶段' : '核对验收清单',
            release: r.released
              ? '进入发布观察'
              : r.approval === 'approved'
                ? '执行已批准的发布模拟'
                : '确认发布范围与审批',
            observe: '记录观察复盘',
          }[stage];
          return todo(
            id,
            label,
            `${stageName(stage)}阶段`,
            stage,
            stage === 'accept' ? 'green' : 'orange',
          );
        })
        .filter(Boolean)
        .join('') || '<p class="empty-state">当前没有待处理事项。</p>'
    );
  }
  function todo(id, title, sub, stage, color) {
    return `<button type="button" class="todo-item v3-todo" data-action="open-req" data-req="${id}" data-stage="${stage}"><span class="todo-symbol badge-${color}">${icon('file')}</span><span><b>${esc(title)}</b><small>${esc(state.requirements[id].name)} · ${esc(sub)}</small></span>${icon('chevron')}</button>`;
  }
  function runLabel(status) {
    return {
      pending: '未开始',
      running: '演示中',
      stopped: '已停止',
      done: '已完成（模拟）',
    }[status];
  }
  function rail() {
    const r = current(),
      actual = stageIndex(r.currentStage);
    return `<aside class="ctx-rail ${railOpen ? 'is-open' : ''}" aria-label="需求上下文"><div class="rail-section"><div class="req-head"><span class="rail-title">当前需求</span><div class="rail-actions">${button('switch-req', icon('refresh'), 'aria-label="切换需求"', 'ghost')}${button('close-context', icon('x'), 'aria-label="关闭需求上下文"', 'ghost context-close')}</div></div><h2 class="req-name">${esc(r.name)}</h2><div class="meta-row">${r.id}${badge(`当前 · ${stageName(r.currentStage)}`)}</div></div>
      <div class="rail-section"><div class="rail-title">生命周期</div><nav class="stage-rail" aria-label="查看阶段">${STAGES.map((s, i) => `<button type="button" class="stage-node ${view.stage === s.id ? 'active' : ''} ${i < actual ? 'passed' : i > actual ? 'upcoming' : 'current-stage'}" data-action="view-stage" data-stage="${s.id}" ${view.stage === s.id ? 'aria-current="step"' : ''}><span class="stage-dot">${i < actual ? icon('check') : i + 1}</span><span>${s.label}</span><small>${i === actual ? '当前' : i < actual ? '已推进' : '未开始'}</small></button>`).join('')}</nav></div>
      <div class="rail-section"><div class="rail-title">本次上下文</div><div class="ctx-item">${icon('box')}<span class="lbl">客户经营产品</span></div><div class="ctx-item">${icon('folder')}<span class="lbl">${esc(r.run.workspace)}</span></div><div class="ctx-item">${icon('user')}<span class="lbl">陈立 · 负责人</span></div></div>
      <div class="rail-section"><div class="between"><span class="rail-title">当前会话能力</span>${button('session-caps', icon('settings'), 'aria-label="调整当前会话能力"', 'ghost')}</div><div class="cap-chips">${
        effectiveCaps()
          .map(
            (c) =>
              `<span class="skill-chip">${icon(c.ico)}${esc(c.name)}</span>`,
          )
          .join('') || '<span class="muted">当前未加载能力</span>'
      }</div><p class="fine-print">${current().sessionCaps[view.stage] ? '已应用本需求的临时选择' : '使用治理中心的阶段默认配置'}</p></div></aside>`;
  }
  function effectiveCaps() {
    const ids = current().sessionCaps[view.stage] || state.bindings[view.stage];
    return CAPABILITIES.filter(
      (c) => ids.includes(c.id) && state.enabled[c.id],
    );
  }
  function blockers() {
    const r = current(),
      a = latest();
    switch (view.stage) {
      case 'idea':
        return [
          ...(r.questions.some((q) => !q.value) ? ['回答所有澄清问题'] : []),
          ...(!a?.confirmed ? ['确认需求草案'] : []),
        ];
      case 'req':
        return [
          ...(!a?.confirmed ? ['确认需求文档'] : []),
          ...(!r.gates.req ? ['完成完整性检查'] : []),
        ];
      case 'design':
        return a?.confirmed ? [] : ['确认设计方案'];
      case 'dev':
        return r.run.status === 'done' ? [] : ['完成开发任务模拟'];
      case 'test':
        return r.gates.test ? [] : ['完成测试检查模拟'];
      case 'accept':
        return a?.confirmed ? [] : ['核对并确认验收清单'];
      case 'release':
        return r.released
          ? []
          : [
              r.approval !== 'approved'
                ? '批准本次模拟发布'
                : '执行已批准的模拟发布',
            ];
      default:
        return r.retro ? [] : ['记录观察复盘'];
    }
  }
  function work() {
    const r = current();
    const future = stageIndex(view.stage) > stageIndex(r.currentStage);
    const missing = blockers();
    return `<main id="main" class="work-layout ${view.focus ? 'artifact-focused' : ''}">${rail()}<section class="chat-main" aria-label="需求工作区"><div class="v3-work-head"><div class="work-title"><button type="button" class="icon-btn context-toggle" data-action="toggle-context" aria-expanded="${railOpen}" aria-label="查看需求上下文">${icon('list')}</button><div><h1>${esc(r.name)}<span>${r.id}</span></h1><p>正在查看：${stageName(view.stage)} <span id="actual-stage">当前进度：${stageName(r.currentStage)}</span></p></div></div>${button('switch-req', `${icon('refresh')}切换`, '', 'ghost')}</div>
      <div class="stage-notice ${liveStage() ? '' : 'historical'}"><span>${liveStage() ? icon('sparkles') : icon('eye')}${liveStage() ? esc(hints[view.stage]) : `${future ? '预览未来阶段' : '查看历史阶段'}，实际进度仍为「${stageName(r.currentStage)}」。`}</span>${!liveStage() ? button('return-current', '回到当前阶段', '', 'ghost') : ''}</div>
      <div id="stream" class="stream" tabindex="0" aria-label="阶段对话与产物">${stageContent()}${messages()}<div class="stream-end"></div></div>
      <div class="next-step"><span>${liveStage() ? `下一步：${missing.length ? missing.join('，') : view.stage === 'observe' ? '本次演示流程已完成' : `进入${STAGES[stageIndex(view.stage) + 1].label}阶段`}` : '历史和未来阶段支持阅读；操作请回到当前阶段。'}</span>${liveStage() && view.stage !== 'observe' ? button('advance', `进入${STAGES[stageIndex(view.stage) + 1].label} ${icon('chevron')}`, `aria-describedby="advance-hint" ${missing.length ? 'disabled' : ''}`, 'primary') : ''}<span id="advance-hint" class="sr-only">${esc(missing.join('，'))}</span></div>
      <form id="composer" class="v3-composer"><label for="message-input" class="sr-only">补充当前阶段的想法</label><div class="composer-box"><textarea id="message-input" rows="2" maxlength="4000" placeholder="补充想法、指出修改点，或说明你的判断…">${esc(r.inputs[view.stage] || '')}</textarea><button type="submit" class="send-btn" aria-label="发送消息">${icon('send')}</button></div><div class="composer-footer"><span>Enter 发送 · Shift + Enter 换行 · 预设回复演示</span>${button('scroll-latest', '回到最新', '', 'ghost')}</div></form></section>${sidePanel()}</main>`;
  }
  function card(title, body, sub = '') {
    return `<article class="card"><div class="card-head"><h2 class="card-title">${icon('sparkles')}${esc(title)}</h2></div>${sub ? `<p class="card-sub">${esc(sub)}</p>` : ''}${body}</article>`;
  }
  function stageContent() {
    const r = current(),
      a = latest();
    const requests = {
      idea: `我想做「${r.name}」，先帮我理清目标和范围。`,
      req: '把已确认的想法整理成需求文档，我会核对具体规则。',
      design: '请给出方案比较，说明本次实现范围和验收方式。',
      dev: '请按已确认方案继续，保留任务进度和变更记录。',
      test: '请按验收标准检查结果，让我能看到哪些项需要处理。',
      accept: '我来逐项核对交付内容，再确认验收清单。',
      release: '先让我确认发布内容、范围和回滚方案，再执行。',
      observe: '对照需求目标查看观察结果，整理复盘与后续行动。',
    };
    let html = `<div class="stage-intro"><span class="eyebrow">${stageName(view.stage)}工作区</span><small>示例对话与材料</small></div><div class="msg user"><span class="msg-avatar">${icon('user')}</span><div class="msg-bubble">${esc(requests[view.stage])}</div></div><div class="msg ai"><span class="msg-avatar">${icon('sparkles')}</span><div class="msg-bubble">${esc(hints[view.stage])}</div></div>`;
    if (view.stage === 'idea')
      html += card(
        '先确认两个关键问题',
        r.questions
          .map(
            (q) =>
              `<div class="clarify-q ${q.value ? 'picked' : ''}"><span class="num">${q.value ? icon('check') : q.id.slice(1)}</span><div class="txt"><b>${esc(q.text)}</b><p>${q.value ? esc(q.value) : '待回答'}</p>${liveStage() && !a?.confirmed ? button('answer-question', q.value ? '修改回答' : '填写回答', `data-question="${q.id}"`, 'ghost') : ''}</div></div>`,
          )
          .join(''),
      );
    if (a) html += artifactCard(a);
    if (view.stage === 'req' || view.stage === 'test') {
      const passed = r.gates[view.stage];
      html += card(
        view.stage === 'test' ? '测试检查' : '需求完整性检查',
        `<div class="between">${badge(passed ? '检查通过（模拟）' : '待检查', passed ? 'green' : 'orange')}<span class="muted">${r.id} · ${stageName(view.stage)}</span></div><p class="body-copy">${view.stage === 'test' ? '模拟核对规则命中、去重、退订与失败提示；结果用于体验流程。' : '检查已确认文档是否具备目标、功能范围与验收标准。'}</p>${passed ? '<p class="success-copy">示例检查项已满足，可以继续推进。</p>' : button('run-gate', '模拟检查', !liveStage() ? 'disabled' : '', 'primary')}`,
        '仅演示检查流程，不执行真实测试',
      );
    }
    if (view.stage === 'dev') html += runCard();
    if (view.stage === 'release')
      html += card(
        '发布审批与执行',
        `<div class="between">${badge(r.approval === 'approved' ? '已批准（模拟）' : r.approval === 'rejected' ? '已驳回' : '待审批', r.approval === 'approved' ? 'green' : 'orange')}${badge(r.released ? '已执行（模拟）' : '尚未执行', r.released ? 'green' : 'gray')}</div><dl class="scope-list"><dt>发布内容</dt><dd>${esc(r.name)} · 已确认的需求与验收版本</dd><dt>执行范围</dt><dd>当前原型中的流程模拟</dd><dt>回滚方案</dt><dd>关闭对应功能入口，恢复上一版本</dd><dt>观察窗口</dt><dd>30 分钟，关注失败率、重复触达与投诉</dd></dl><div class="btn-group">${r.approval !== 'approved' ? button('approve', '批准本次模拟', !liveStage() ? 'disabled' : '', 'primary') + button('reject-approval', '驳回', !liveStage() ? 'disabled' : '') : button('simulate-release', r.released ? '模拟发布已完成' : '执行模拟发布', !liveStage() || r.released ? 'disabled' : '', 'primary')}</div>`,
        '批准后还需单独执行，两个状态分别留痕',
      );
    if (view.stage === 'observe') {
      const observed = r.released;
      html += card(
        '观察结果与复盘',
        observed
          ? `<div class="kpi-row">${[
              ['96.8%', '触达率'],
              ['3.1%', '唤醒率'],
              ['0', '异常数'],
            ]
              .map(
                ([v, l]) =>
                  `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`,
              )
              .join(
                '',
              )}</div><p class="fine-print">固定示例指标，用于呈现观察阶段的阅读体验。</p><p class="body-copy">复盘建议：核对分层触达差异，并把后续优化登记为新需求。</p>${button('complete-retro', r.retro ? '复盘已记录' : '记录复盘结论', !liveStage() || r.retro ? 'disabled' : '', 'primary')}`
          : '<p class="empty-state">完成发布后，这里将展示观察结果与复盘入口。</p>',
      );
    }
    return html;
  }
  function artifactCard(a) {
    const r = current();
    const disabled = !liveStage();
    const checkAll =
      view.stage !== 'accept' || r.checks.length === a.fields.length;
    return card(
      a.title,
      `<div class="between">${badge(a.confirmed ? '已确认' : '待确认', a.confirmed ? 'green' : 'orange')}<span class="muted">${a.version > 1 ? `${versions().length} 个版本 · ` : ''}v${a.version}</span></div><div class="draft-preview">${a.fields
        .slice(0, 3)
        .map((f) => `<div><b>${esc(f.name)}</b><p>${esc(f.value)}</p></div>`)
        .join(
          '',
        )}</div>${view.stage === 'accept' && !a.confirmed ? `<div class="accept-checks">${a.fields.map((f, i) => `<label><input type="checkbox" data-check="${i}" ${r.checks.includes(i) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>我已核对：${esc(f.name)}</label>`).join('')}</div>` : ''}<div class="btn-group">${button('open-artifact', `${icon('file')}阅读全文`, `data-artifact="${a.id}"`)}${button('open-diff', '字段对比', `data-artifact="${a.id}"`)}${!a.confirmed ? button('edit-artifact', '修改内容', disabled ? 'disabled' : '') + button('confirm-artifact', '确认此版本', disabled || !checkAll ? 'disabled' : '', 'primary') : badge('确认版本已保留', 'green')}</div><div class="evidence">${icon('file')}${r.id} · ${stageName(view.stage)} · v${a.version}${a.confirmed ? ' · 已在当前浏览器保存' : ''}</div>`,
    );
  }
  function runCard() {
    const r = current().run;
    const inactive = liveStage() ? '' : 'disabled';
    return card(
      `任务 ${r.id}`,
      `<div class="between">${badge(runLabel(r.status), r.status === 'stopped' ? 'orange' : r.status === 'done' ? 'green' : 'cyan')}<strong id="run-percent">${r.pct}%</strong></div><p class="fine-print">${esc(r.workspace)} · 分步演示</p><div class="progress-bar"><div class="progress-fill" style="width:${r.pct}%"></div></div><ol class="v3-step-list">${r.steps.map((label, i) => `<li class="${r.pct + 0.5 >= ((i + 1) * 100) / r.steps.length ? 'complete' : ''}"><span>${r.pct + 0.5 >= ((i + 1) * 100) / r.steps.length ? icon('check') : i + 1}</span>${esc(label)}</li>`).join('')}</ol><div class="btn-group">${r.status === 'running' ? button('stop-run', `${icon('stop')}停止`, inactive, 'danger') + button('run-step', '模拟完成下一步', inactive, 'primary') : r.status === 'stopped' || r.status === 'pending' ? button('resume-run', r.status === 'stopped' ? '继续模拟' : '开始模拟', inactive, 'primary') : badge('任务已完成（模拟）', 'green')}${button('show-evidence', '查看任务记录', '', 'ghost')}</div>`,
      '在原型里逐步体验状态变化，不调用开发工具',
    );
  }
  function messages() {
    return (current().messages[view.stage] || [])
      .map(
        (m) =>
          `<div class="msg ${m.role}"><span class="msg-avatar">${icon(m.role === 'user' ? 'user' : 'sparkles')}</span><div class="msg-bubble">${esc(m.text)}${m.role === 'ai' ? '<small>预设回复 · 不触发任务执行</small>' : ''}</div></div>`,
      )
      .join('');
  }
  function sidePanel() {
    return `<aside class="side-panel" aria-label="关联结果"><div class="panel-tabs" role="tablist" aria-label="结果类型">${[
      ['canvas', 'file', '画布'],
      ['terminal', 'terminal', '任务'],
      ['evidence', 'shield', '证据'],
    ]
      .map(
        ([id, i, label]) =>
          `<button type="button" id="tab-${id}" class="panel-tab ${view.panel === id ? 'active' : ''}" role="tab" aria-selected="${view.panel === id}" aria-controls="result-panel" tabindex="${view.panel === id ? 0 : -1}" data-action="panel" data-panel="${id}">${icon(i)}${label}</button>`,
      )
      .join(
        '',
      )}</div><div class="panel-body" id="result-panel" role="tabpanel" aria-labelledby="tab-${view.panel}">${view.panel === 'canvas' ? canvas() : view.panel === 'evidence' ? evidence() : terminal()}</div></aside>`;
  }
  function canvas() {
    const a = selected();
    if (!a)
      return `<div class="empty-state">${icon('file')}<h2>${stageName(view.stage)}阶段暂无文档</h2><p>可以查看任务记录，或返回需求、设计阶段阅读已确认产物。</p>${button('view-stage', '查看需求文档', 'data-stage="req"')}</div>`;
    return `<div class="between"><span class="eyebrow">${current().id} · ${stageName(view.stage)}</span>${button('toggle-focus', view.focus ? '退出聚焦' : '聚焦阅读', `aria-pressed="${view.focus}"`, 'ghost')}</div><h2 class="artifact-title">${esc(a.title)}</h2><div class="artifact-toolbar"><label>版本 <select id="artifact-version" aria-label="文档版本">${versions()
      .map(
        (v) =>
          `<option value="${v.id}" ${v.id === a.id ? 'selected' : ''}>v${v.version}${v.confirmed ? ' · 已确认' : ' · 草稿'}</option>`,
      )
      .join(
        '',
      )}</select></label>${button('toggle-diff', view.diff ? '正文阅读' : '字段对比', `aria-pressed="${view.diff}"`, 'ghost')}</div><p class="fine-print">${a.confirmed ? '已确认的本地示例快照' : '待确认内容'} · ${a.id}</p>${view.diff ? `<div class="field-diffs">${a.fields.map((f) => `<section><h3>${esc(f.name)}</h3><div class="before"><small>修改前</small><p>${esc(f.before)}</p></div><div class="after"><small>当前版本</small><p>${esc(f.value)}</p></div></section>`).join('')}</div>` : `<article class="artifact-document">${a.fields.map((f) => `<section><h3>${esc(f.name)}</h3><p>${esc(f.value)}</p></section>`).join('')}</article>`}`;
  }
  function terminal() {
    const r = current();
    return `<h2 class="panel-title">${icon('terminal')}任务 ${r.run.id}</h2><p class="fine-print">${r.id} · ${esc(r.run.workspace)}</p><div class="task-state">${badge(runLabel(r.run.status), r.run.status === 'stopped' ? 'orange' : 'cyan')}<strong>${r.run.pct}%</strong></div><p class="body-copy">这里展示当前需求的任务与操作记录。</p><div class="v3-log"><div class="log-line"><small>示例起点</small><p>${esc(r.run.workspace)} / ${r.run.id}</p></div>${
      r.events
        .filter((e) => e.stage === 'dev')
        .map(
          (e) =>
            `<div class="log-line"><small>${esc(e.time)}</small><p>${esc(e.text)}</p></div>`,
        )
        .join('') || '<p class="muted">暂无开发阶段操作。</p>'
    }</div><div class="fine-print">无终端连接 · 无命令执行</div>`;
  }
  function evidence() {
    const r = current(),
      a = selected();
    return `<h2 class="panel-title">${icon('shield')}当前需求证据</h2><dl class="scope-list"><dt>需求</dt><dd>${r.id} · ${esc(r.name)}</dd><dt>实际阶段</dt><dd>${stageName(r.currentStage)}</dd><dt>查看阶段</dt><dd>${stageName(view.stage)}</dd><dt>关联任务</dt><dd>${esc(r.run.id)} · ${esc(r.run.workspace)}</dd><dt>当前产物</dt><dd>${a ? `${esc(a.title)} · v${a.version}` : '本阶段暂无文档'}</dd><dt>记录来源</dt><dd>原型示例与当前浏览器操作</dd></dl><h3 class="section-label">${stageName(view.stage)}阶段记录</h3><ol class="event-list">${
      r.events
        .filter((e) => e.stage === view.stage)
        .slice()
        .reverse()
        .map(
          (e) =>
            `<li><span>${esc(e.text)}</span><small>${esc(e.time)} · #${e.id}</small></li>`,
        )
        .join('') || '<li>本阶段暂无操作记录。</li>'
    }</ol>`;
  }
  function catalog() {
    return `<main id="main" class="v3-page"><div class="page-title"><div class="eyebrow">产品空间</div><h1>客户经营产品</h1><p>从需求进入工作区，沿阶段查看文档与交付记录。</p></div><section class="panel-card"><div class="between"><h2>需求与产物</h2>${badge(`${Object.keys(state.requirements).length} 条示例需求`, 'gray')}</div><table class="v3-table"><thead><tr><th>需求</th><th>当前阶段</th><th>文档版本</th><th>下一步</th><th>操作</th></tr></thead><tbody>${Object.values(
      state.requirements,
    )
      .map(
        (r) =>
          `<tr><td><strong>${esc(r.name)}</strong><small>${r.id}</small></td><td>${badge(stageName(r.currentStage))}</td><td>${Object.values(r.artifacts).reduce((n, vs) => n + vs.filter((v) => v.confirmed).length, 0)} 个已确认版本</td><td>${esc(hints[r.currentStage])}</td><td>${button('open-req', '进入工作区', `data-req="${r.id}"`)}</td></tr>`,
      )
      .join('')}</tbody></table></section></main>`;
  }
  function delivery() {
    return `<main id="main" class="v3-page"><div class="page-title"><div class="eyebrow">交付中心</div><h1>让每一步交付有据可查</h1><p>同一需求的任务、阶段与确认记录，保持一致。</p></div><div class="delivery-grid">${Object.values(
      state.requirements,
    )
      .map(
        (r) =>
          `<section class="panel-card"><div class="between"><h2>${esc(r.name)}</h2>${badge(stageName(r.currentStage))}</div><p class="muted">${r.id} · ${r.run.id}</p><div class="delivery-stages">${STAGES.map((s) => `<span class="${stageIndex(s.id) < stageIndex(r.currentStage) ? 'complete' : s.id === r.currentStage ? 'current' : ''}">${s.label}</span>`).join('')}</div><dl class="scope-list"><dt>任务</dt><dd>${runLabel(r.run.status)} · ${r.run.pct}%</dd><dt>发布审批</dt><dd>${r.approval === 'approved' ? '已批准（模拟）' : '尚未批准'}</dd><dt>发布执行</dt><dd>${r.released ? '已执行（模拟）' : '尚未执行'}</dd></dl>${button('open-req', '查看交付上下文', `data-req="${r.id}"`)}</section>`,
      )
      .join('')}</div></main>`;
  }
  function governance() {
    return `<main id="main" class="v3-page"><div class="page-title"><div class="eyebrow">治理中心</div><h1>能力与阶段配置</h1><p>全局启用决定可用范围，阶段绑定决定默认加载；临时选择仅作用于当前需求会话。</p></div><div class="config-tabs">${[
      ['directory', '能力目录'],
      ['bindings', '阶段绑定'],
    ]
      .map(([id, label]) =>
        button(
          'config-tab',
          label,
          `data-tab="${id}" aria-pressed="${configTab === id}"`,
          configTab === id ? 'primary' : '',
        ),
      )
      .join(
        '',
      )}</div>${configTab === 'directory' ? `<section class="panel-card"><table class="v3-table"><thead><tr><th>能力</th><th>类型 / 来源</th><th>用途</th><th>权限说明</th><th>全局启用</th></tr></thead><tbody>${CAPABILITIES.map((c) => `<tr><td><span class="cap-name-inline">${icon(c.ico)}<b>${esc(c.name)}</b></span><small>${esc(c.ver)} · 示例版本</small></td><td>${esc(c.type)}<small>${esc(c.src)}</small></td><td>${esc(c.desc)}</td><td>${esc(c.perm)}</td><td><button type="button" class="v3-switch" role="switch" aria-label="全局启用 ${esc(c.name)}" aria-checked="${state.enabled[c.id]}" data-action="toggle-global" data-cap="${c.id}"><span></span><b>${state.enabled[c.id] ? '启用' : '停用'}</b></button></td></tr>`).join('')}</tbody></table></section>` : `<section class="panel-card"><div class="stage-picker">${STAGES.map((s) => button('config-stage', s.label, `data-stage="${s.id}" aria-pressed="${configStage === s.id}"`, configStage === s.id ? 'primary' : '')).join('')}</div><h2>${stageName(configStage)}阶段 · 默认能力</h2><p class="body-copy muted">配置只影响默认加载；已单独调整的需求会话保持临时选择。</p><div class="binding-grid">${CAPABILITIES.map((c) => `<button type="button" class="binding-item ${state.bindings[configStage].includes(c.id) ? 'selected' : ''}" aria-pressed="${state.bindings[configStage].includes(c.id)}" data-action="toggle-bind" data-cap="${c.id}" data-stage="${configStage}" ${!state.enabled[c.id] ? 'disabled' : ''}>${icon(c.ico)}<span><b>${esc(c.name)}</b><small>${state.enabled[c.id] ? (state.bindings[configStage].includes(c.id) ? '已绑定' : '未绑定') : '全局已停用'}</small></span>${icon(state.bindings[configStage].includes(c.id) ? 'check' : 'plus')}</button>`).join('')}</div></section>`}<p class="fine-print">配置仅演示选择与生效范围，不连接或安装任何能力。</p></main>`;
  }
  function render({ preserveScroll = false } = {}) {
    const stream = document.querySelector('#stream');
    const top = stream?.scrollTop || 0;
    const active = document.activeElement;
    const selector = active?.id
      ? `#${CSS.escape(active.id)}`
      : active?.dataset.action
        ? Object.entries(active.dataset)
            .map(
              ([key, value]) =>
                `[data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(value)}"]`,
            )
            .join('')
        : '';
    app.innerHTML =
      header() +
      (
        { home, work, space: catalog, delivery, governance }[view.route] || home
      )();
    if (preserveScroll && document.querySelector('#stream'))
      document.querySelector('#stream').scrollTop = top;
    if (selector && app.contains(active) === false)
      app.querySelector(selector)?.focus({ preventScroll: true });
  }
  function showDialog(title, body) {
    previousFocus = document.activeElement;
    dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>${button('close-dialog', icon('x'), 'aria-label="关闭弹窗"', 'ghost')}</div>${body}`;
    dialog.showModal();
    dialog
      .querySelector(
        'textarea,input,select,button:not([data-action="close-dialog"])',
      )
      ?.focus();
  }
  function closeDialog() {
    dialog.close();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function chooseReq(search = false) {
    showDialog(
      search ? '查找需求' : '切换需求',
      `${search ? '<label class="form-label" for="search-input">按名称或编号查找</label><input id="search-input" type="search" class="v3-input" placeholder="例如：积分、R-1056">' : ''}<div id="search-results">${requirementChoices()}</div>`,
    );
  }
  function requirementChoices(query = '') {
    const rows = Object.values(state.requirements).filter((r) =>
      (r.name + r.id).toLowerCase().includes(query.toLowerCase()),
    );
    return (
      rows
        .map(
          (r) =>
            `<button type="button" class="recent-row" data-action="pick-req" data-req="${r.id}"><span><b>${esc(r.name)}</b><small>${r.id}</small></span>${badge(stageName(r.currentStage))}${icon('chevron')}</button>`,
        )
        .join('') || '<p class="empty-state">未找到匹配需求，请调整关键词。</p>'
    );
  }
  function sessionDialog() {
    const chosen =
      current().sessionCaps[view.stage] || state.bindings[view.stage];
    showDialog(
      '调整当前会话能力',
      `<p class="body-copy">仅影响 ${current().id} 的${stageName(view.stage)}阶段；全局停用的能力不可加载。</p><form id="session-form"><div class="session-list">${CAPABILITIES.map((c) => `<label><input type="checkbox" name="cap" value="${c.id}" ${chosen.includes(c.id) && state.enabled[c.id] ? 'checked' : ''} ${!state.enabled[c.id] ? 'disabled' : ''}><span><b>${esc(c.name)}</b><small>${state.enabled[c.id] ? esc(c.type) : '全局已停用'}</small></span></label>`).join('')}</div><div class="btn-group"><button type="submit" class="btn primary">保存本次选择</button>${button('restore-default-caps', '恢复阶段默认')}</div></form>`,
    );
  }
  function answerDialog(id) {
    if (!liveStage() || latest()?.confirmed) return;
    const q = current().questions.find((q) => q.id === id);
    if (!q) return;
    showDialog(
      '回答澄清问题',
      `<form id="answer-form" data-question="${q.id}"><label class="form-label" for="answer-input">${esc(q.text)}</label><textarea id="answer-input" class="v3-input" rows="4" maxlength="2000" required>${esc(q.value || q.answer)}</textarea><p class="fine-print">已填入建议回答，你可以直接修改。</p><div class="btn-group"><button class="btn primary" type="submit">保存回答</button>${button('close-dialog', '取消')}</div></form>`,
    );
  }
  function editDialog() {
    const a = latest();
    if (!liveStage() || !a || a.confirmed) return;
    if (versions().length >= 30) {
      toast('此演示最多保留 30 个版本，请重置后继续体验。');
      return;
    }
    showDialog(
      '修改草稿内容',
      `<form id="edit-form">${a.fields.map((f, i) => `<label class="form-label" for="field-${i}">${esc(f.name)}</label><textarea id="field-${i}" class="v3-input" name="field-${i}" rows="3" maxlength="5000" required>${esc(f.value)}</textarea>`).join('')}<p class="fine-print">保存为新草稿版本，原版本仍可从画布中查看。</p><div class="btn-group"><button class="btn primary" type="submit">保存新版本</button>${button('close-dialog', '取消')}</div></form>`,
    );
  }
  function mutate(action, el) {
    const r = current();
    // 动作先于 stage 属性分派，避免能力绑定按钮被阶段导航吞掉。
    switch (action) {
      case 'nav':
        navigate({ route: el.dataset.route, focus: false });
        break;
      case 'continue-work':
      case 'open-req':
        openRequirement(el.dataset.req, el.dataset.stage);
        break;
      case 'pick-req':
        closeDialog();
        openRequirement(el.dataset.req);
        break;
      case 'view-stage':
        navigate({
          stage: el.dataset.stage,
          panel: el.dataset.stage === 'dev' ? 'terminal' : 'canvas',
          artifact: '',
          diff: false,
          focus: false,
        });
        break;
      case 'return-current':
        openRequirement(view.req);
        break;
      case 'toggle-context':
        railOpen = !railOpen;
        render({ preserveScroll: true });
        if (railOpen)
          document.querySelector('[data-action="close-context"]')?.focus();
        break;
      case 'close-context':
        railOpen = false;
        render({ preserveScroll: true });
        document.querySelector('[data-action="toggle-context"]')?.focus();
        break;
      case 'switch-req':
        chooseReq();
        break;
      case 'search':
        chooseReq(true);
        break;
      case 'panel':
        navigate({ panel: el.dataset.panel, focus: false });
        break;
      case 'open-artifact':
      case 'open-diff':
        navigate({
          panel: 'canvas',
          artifact: el.dataset.artifact,
          diff: action === 'open-diff',
        });
        break;
      case 'toggle-diff':
        navigate({ diff: !view.diff });
        break;
      case 'toggle-focus':
        navigate({ focus: !view.focus });
        break;
      case 'show-evidence':
        navigate({ panel: 'evidence', focus: false });
        break;
      case 'answer-question':
        answerDialog(el.dataset.question);
        break;
      case 'edit-artifact':
        editDialog();
        break;
      case 'confirm-artifact': {
        const a = latest();
        if (!liveStage() || !a || a.confirmed) return;
        if (view.stage === 'idea' && r.questions.some((q) => !q.value)) {
          toast('请先回答两个澄清问题。');
          return;
        }
        if (view.stage === 'accept' && r.checks.length !== a.fields.length) {
          toast('请先逐项核对验收清单。');
          return;
        }
        a.confirmed = true;
        record(`确认「${a.title}」v${a.version}`);
        render({ preserveScroll: true });
        toast(`v${a.version} 已确认并保存在当前浏览器`);
        break;
      }
      case 'stop-run':
        if (!liveStage() || r.run.status !== 'running') return;
        r.run.status = 'stopped';
        record(`任务 ${r.run.id} 已停止，保留 ${r.run.pct}% 进度`);
        render({ preserveScroll: true });
        toast('已停止，进度与已完成步骤保留');
        break;
      case 'resume-run':
        if (!liveStage() || !['stopped', 'pending'].includes(r.run.status))
          return;
        r.run.status = 'running';
        record(`从 ${r.run.pct}% 继续任务模拟`);
        render({ preserveScroll: true });
        break;
      case 'run-step': {
        if (!liveStage() || r.run.status !== 'running') return;
        r.run.pct = Math.min(
          100,
          Math.round(
            ((Math.floor(((r.run.pct + 0.5) * r.run.steps.length) / 100) + 1) *
              100) /
              r.run.steps.length,
          ),
        );
        if (r.run.pct === 100) r.run.status = 'done';
        record(
          `任务分步模拟：${r.run.pct}%${r.run.status === 'done' ? '，模拟完成' : ''}`,
        );
        render({ preserveScroll: true });
        break;
      }
      case 'run-gate':
        if (
          !liveStage() ||
          !['req', 'test'].includes(view.stage) ||
          r.gates[view.stage]
        )
          return;
        if (view.stage === 'req' && !latest()?.confirmed) {
          toast('请先确认需求文档，再检查完整性。');
          return;
        }
        r.gates[view.stage] = true;
        record(`${stageName(view.stage)}检查通过（模拟）`);
        render({ preserveScroll: true });
        break;
      case 'advance': {
        if (!liveStage() || blockers().length || view.stage === 'observe')
          return;
        const next = STAGES[stageIndex(view.stage) + 1].id;
        record(`确认推进：${stageName(view.stage)} → ${stageName(next)}`);
        r.currentStage = next;
        save();
        openRequirement(r.id);
        toast(`已进入${stageName(next)}阶段（原型演示）`);
        break;
      }
      case 'approve':
        if (
          !liveStage() ||
          view.stage !== 'release' ||
          r.approval === 'approved'
        )
          return;
        r.approval = 'approved';
        record('批准本次模拟发布，尚未执行');
        render({ preserveScroll: true });
        break;
      case 'reject-approval':
        if (!liveStage() || view.stage !== 'release') return;
        r.approval = 'rejected';
        record('驳回本次模拟发布');
        render({ preserveScroll: true });
        break;
      case 'simulate-release':
        if (
          !liveStage() ||
          view.stage !== 'release' ||
          r.approval !== 'approved' ||
          r.released
        )
          return;
        r.released = true;
        record('执行模拟发布完成');
        render({ preserveScroll: true });
        break;
      case 'complete-retro':
        if (!liveStage() || !r.released || r.retro) return;
        r.retro = true;
        record('复盘结论：核对分层触达差异，后续优化登记为新需求');
        render({ preserveScroll: true });
        break;
      case 'config-tab':
        configTab = el.dataset.tab;
        render();
        break;
      case 'config-stage':
        configStage = el.dataset.stage;
        render();
        break;
      case 'toggle-global': {
        const id = el.dataset.cap;
        if (!(id in state.enabled)) return;
        state.enabled[id] = !state.enabled[id];
        save();
        render();
        toast(
          `${CAPABILITIES.find((c) => c.id === id).name}已${state.enabled[id] ? '启用' : '停用'}，不改变阶段绑定`,
        );
        break;
      }
      case 'toggle-bind': {
        const { cap, stage } = el.dataset;
        if (!state.enabled[cap] || !state.bindings[stage]) return;
        const ids = state.bindings[stage];
        state.bindings[stage] = ids.includes(cap)
          ? ids.filter((id) => id !== cap)
          : [...ids, cap];
        save();
        render();
        toast(`${stageName(stage)}阶段默认配置已保存`);
        break;
      }
      case 'session-caps':
        sessionDialog();
        break;
      case 'restore-default-caps':
        delete r.sessionCaps[view.stage];
        record('当前会话恢复阶段默认能力');
        closeDialog();
        render({ preserveScroll: true });
        break;
      case 'close-dialog':
        closeDialog();
        break;
      case 'scroll-latest':
        document.querySelector('#stream')?.scrollTo({
          top: document.querySelector('#stream').scrollHeight,
          behavior: 'smooth',
        });
        break;
      case 'reset':
        showDialog(
          '重置 V3 演示',
          `<p class="body-copy">这会清除本原型的回答、文档修改、任务进度与能力选择，并恢复初始示例。</p><div class="btn-group">${button('confirm-reset', '重置此原型', '', 'danger')}${button('close-dialog', '保留当前记录')}</div>`,
        );
        break;
      case 'confirm-reset':
        try {
          localStorage.removeItem(KEY);
        } catch {
          toast('当前浏览器无法清除保存记录。');
          return;
        }
        state = fresh();
        closeDialog();
        navigate({
          route: 'home',
          req: 'R-1042',
          stage: 'dev',
          panel: 'terminal',
          artifact: '',
          focus: false,
          diff: false,
        });
        toast('已恢复初始示例');
        break;
    }
  }
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (el && !el.disabled) mutate(el.dataset.action, el);
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'message-input') {
      current().inputs[view.stage] = event.target.value.slice(0, 4000);
      save();
    }
    if (event.target.id === 'search-input')
      document.querySelector('#search-results').innerHTML = requirementChoices(
        event.target.value,
      );
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'artifact-version')
      navigate({ artifact: event.target.value });
    if (event.target.matches('[data-check]') && liveStage()) {
      const i = Number(event.target.dataset.check),
        r = current();
      r.checks = event.target.checked
        ? [...new Set([...r.checks, i])]
        : r.checks.filter((n) => n !== i);
      save();
      render({ preserveScroll: true });
      document.querySelector(`[data-check="${i}"]`)?.focus();
    }
  });
  document.addEventListener('submit', (event) => {
    const form = event.target;
    event.preventDefault();
    const r = current();
    if (form.id === 'composer') {
      const input = document.querySelector('#message-input'),
        text = input.value.trim();
      if (!text) return;
      const list = r.messages[view.stage] || [];
      list.push(
        { role: 'user', text: text.slice(0, 4000) },
        {
          role: 'ai',
          text: `已收到你对「${stageName(view.stage)}」的补充。你可以打开草稿修改具体字段，再确认版本；阶段不会自动推进。`,
        },
      );
      r.messages[view.stage] = list.slice(-40);
      r.inputs[view.stage] = '';
      record('补充阶段对话');
      render();
      const stream = document.querySelector('#stream');
      stream.scrollTop = stream.scrollHeight;
      document.querySelector('#message-input').focus();
    }
    if (form.id === 'answer-form' && liveStage()) {
      const q = r.questions.find((q) => q.id === form.dataset.question);
      const value = document.querySelector('#answer-input').value.trim();
      if (!q || !value) return;
      q.value = value.slice(0, 2000);
      // 回答直接进入想法草案，避免已回答与待确认内容脱节。
      const a = latest('idea');
      const name = `澄清 · ${q.text}`;
      const field = a.fields.find((f) => f.name === name);
      if (field) field.value = q.value;
      else a.fields.push({ name, value: q.value, before: '（未回答）' });
      record(`已回答：${q.text}`);
      closeDialog();
      render({ preserveScroll: true });
      toast('回答已同步到需求草案');
    }
    if (form.id === 'edit-form' && liveStage()) {
      const a = latest();
      if (!a || a.confirmed) return;
      const data = new FormData(form);
      const fields = a.fields.map((f, i) => ({
        ...f,
        before: f.value,
        value: String(data.get(`field-${i}`) || '').trim(),
      }));
      if (fields.some((f) => !f.value)) return;
      if (fields.every((f, i) => f.value === a.fields[i].value)) {
        closeDialog();
        toast('内容没有变化，未创建重复版本。');
        return;
      }
      const next = {
        ...clone(a),
        version: a.version + 1,
        id: `${r.id}-${view.stage}-v${a.version + 1}`,
        confirmed: false,
        fields,
      };
      versions().push(next);
      r.checks = [];
      record(`保存「${a.title}」新草稿 v${next.version}`);
      closeDialog();
      navigate({ panel: 'canvas', artifact: next.id, diff: true });
    }
    if (form.id === 'session-form') {
      r.sessionCaps[view.stage] = new FormData(form)
        .getAll('cap')
        .filter((id) => state.enabled[id]);
      record('调整当前需求的阶段会话能力');
      closeDialog();
      render({ preserveScroll: true });
      toast('已保存当前会话选择');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      event.target.id === 'message-input' &&
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      document.querySelector('#composer').requestSubmit();
    }
    if (
      event.target.matches('[role="tab"]') &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    ) {
      event.preventDefault();
      const ids = ['canvas', 'terminal', 'evidence'];
      const i = ids.indexOf(event.target.dataset.panel);
      const target =
        event.key === 'Home'
          ? 'canvas'
          : event.key === 'End'
            ? 'evidence'
            : ids[(i + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
      navigate({ panel: target, focus: false });
      requestAnimationFrame(() =>
        document.querySelector(`#tab-${target}`)?.focus(),
      );
    }
    if (event.key === 'Escape' && view.focus && !dialog.open)
      navigate({ focus: false });
    if (event.key === 'Escape' && railOpen && !dialog.open) {
      railOpen = false;
      render({ preserveScroll: true });
      document.querySelector('[data-action="toggle-context"]')?.focus();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  window.addEventListener('hashchange', () => {
    if (dialog.open) closeDialog();
    readRoute();
    render();
  });
  readRoute();
  render();
})();
