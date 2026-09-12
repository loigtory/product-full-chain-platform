(() => {
  /* ================= 图标 ================= */
  const ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
    shield:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    git: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v6M18 9v9a3 3 0 0 1-3 3h-9"/></svg>',
    terminal:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 6-5-6-5"/><path d="M12 19h8"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    alert:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
    layers:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    activity:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>',
    sparkles:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.4L22 18l-2.1.6L19 21l-.9-2.4L16 18l2.1-.6z"/></svg>',
    chevron:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    refresh:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  };
  function ic(name, cls) {
    return (
      '<span class="' +
      (cls || '') +
      '" style="display:inline-flex;">' +
      (ICONS[name] || ICONS.sparkles) +
      '</span>'
    );
  }

  /* ================= 阶段定义 ================= */
  const STAGES = [
    { id: 'idea', label: '想法', dot: ICONS.zap, color: '#3B82F6' },
    { id: 'req', label: '需求', dot: ICONS.file, color: '#3B82F6' },
    { id: 'design', label: '设计', dot: ICONS.layers, color: '#A855F7' },
    { id: 'dev', label: '开发', dot: ICONS.terminal, color: '#06B6D4' },
    { id: 'test', label: '测试', dot: ICONS.shield, color: '#F97316' },
    { id: 'accept', label: '验收', dot: ICONS.check, color: '#22C55E' },
    { id: 'release', label: '发布', dot: ICONS.send, color: '#0078C8' },
    { id: 'observe', label: '观察复盘', dot: ICONS.activity, color: '#8B5CF6' },
  ];

  /* ================= 对话剧情 ================= */
  function draftCard(fields, head) {
    return {
      t: 'draft',
      id: 'd' + Math.random().toString(36).slice(2, 8),
      title: head.title,
      sub: head.sub,
      fields: fields,
      confirmed: false,
      version: head.version,
      appliedVersion: head.appliedVersion || null,
    };
  }
  const CONVO = {
    idea: [
      {
        t: 'user',
        text: '我想做一个功能：会员积分快到期的时候提醒用户，避免积分浪费。先帮我理一下这个想法。',
      },
      {
        t: 'ai',
        text: '好的，这是一个「用户留存 + 积分资产保值」方向的轻量功能。我先把它整理成一条需求草案，动手前需要先澄清两个影响范围的问题：',
        ev: { run: 'T-101', skill: '需求澄清', src: 'idea-v0' },
      },
      {
        t: 'clarify',
        id: 'c1',
        q: [
          {
            id: 'q1',
            num: '1',
            text: '过期积分是自动清零，还是允许兑换/延期？',
            picked: false,
            answer: '自动清零，不提供兑换或延期。',
          },
          {
            id: 'q2',
            num: '2',
            text: '提醒触达渠道有哪些？',
            picked: false,
            answer: 'App 推送 + 短信双渠道。',
          },
        ],
      },
      {
        t: 'ai',
        text: '基于你的回答，需求草案如下。请查看字段级 Diff 并确认，确认后写入 Requirement v1。',
        ev: { run: 'T-102', skill: '需求澄清', src: 'idea-v1' },
      },
      {
        t: 'draft',
        id: 'd1',
        title: '需求草案 · 会员积分过期提醒',
        sub: '来源：想法登记 · 建议写入 Requirement v1',
        version: 'v1',
        confirmed: false,
        fields: [
          { f: '需求名称', before: '（空）', after: '会员积分过期提醒' },
          {
            f: '目标',
            before: '（空）',
            after:
              '提前触达积分即将过期的会员，减少积分浪费，提升 App 活跃与满意度',
          },
          {
            f: '范围',
            before: '（空）',
            after:
              '积分到期前 30 天开始提醒；7 天、1 天各加强一次；不包含积分清零后的补救',
          },
          {
            f: '非目标',
            before: '（空）',
            after: '不做积分商城、不做积分延期兑换',
          },
          {
            f: '验收标准',
            before: '（空）',
            after:
              '1) 到期前 30/7/1 天准时触发；2) 双渠道送达；3) 退订后不再打扰',
          },
        ],
      },
    ],
    req: [
      {
        t: 'gate',
        id: 'g0',
        name: 'G0 登记完整性检查',
        status: 'PASS 候选',
        scope: '需求名称 / 目标 / 范围 / 负责人 / 验收标准 已齐备',
        ev: { run: 'G-01', skill: '门禁检查' },
      },
      {
        t: 'ai',
        text: 'G0 已通过，需求正式立项（R-1042）。接下来我生成需求文档 V0.1：背景、用户故事、功能需求与验收标准。',
        ev: { run: 'T-103', skill: 'PRD 生成' },
      },
      {
        t: 'draft',
        id: 'd2',
        title: '需求文档 V0.1',
        sub: '来源：G0 立项 · 建议写入 ArtifactVersion v2',
        version: 'v2',
        confirmed: false,
        fields: [
          {
            f: '背景',
            before: '（草稿）',
            after: '积分过期无提醒导致资产流失感知，客诉占比 8%',
          },
          {
            f: '用户故事',
            before: '（空）',
            after: '作为会员，我希望在积分到期前收到提醒，以便及时使用',
          },
          {
            f: '功能需求',
            before: '（空）',
            after:
              'F1 到期提醒任务 · F2 渠道触达（推送/短信）· F3 退订管理 · F4 送达回执',
          },
          {
            f: '非功能',
            before: '（空）',
            after: '提醒任务 p95 延迟 < 30s；送达率 ≥ 97%',
          },
          {
            f: '验收标准',
            before: '（空）',
            after:
              'AC1 到期前 30/7/1 天触发 · AC2 双渠道送达 · AC3 退订即停 · AC4 回执可查',
          },
        ],
      },
      {
        t: 'ai',
        text: '需求文档已确认写入 v2。范围已冻结，可以进入设计阶段。',
        ev: { run: 'T-104', skill: 'PRD 生成' },
      },
    ],
    design: [
      {
        t: 'ai',
        text: '需求已冻结 v2。我给出设计方案对比，并推荐交互路径。',
        ev: { run: 'T-201', skill: '方案设计' },
      },
      {
        t: 'draft',
        id: 'd3',
        title: '设计方案 · 通知中心集成',
        sub: '来源：需求 v2 · 建议写入 ArtifactVersion v3',
        version: 'v3',
        confirmed: false,
        fields: [
          {
            f: '方案对比',
            before: '（空）',
            after:
              'A 独立提醒模块（重）· B 复用消息中心（中）· C 通知服务子任务（轻）→ 推荐 C',
          },
          {
            f: '交互要点',
            before: '（空）',
            after: '提醒设置页 + 到期卡片 + 退订入口；深链到积分明细',
          },
          {
            f: '数据设计',
            before: '（空）',
            after: 'reminder_task 表 + 送达回执表；任务由定时调度器生成',
          },
          {
            f: '依赖',
            before: '（空）',
            after: '消息中心 API（已存在）· 会员积分服务（已存在）',
          },
        ],
      },
      {
        t: 'ai',
        text: '方案已确认。设计评审通过，可以进入开发阶段——我会发起 AgentRun 由 Codex 在本地工作区实现，并实时镜像 Zed 的对话流。',
        ev: { run: 'T-202', skill: '方案设计' },
      },
    ],
    dev: [
      {
        t: 'ai',
        text: '开发就绪。建议发起 AgentRun：Codex 本地实现 + Zed 会话实时跟踪。需要的工具能力将自动装载（可手动调整）。',
        ev: { run: 'PLAN-301', skill: '代码实现' },
      },
      {
        t: 'progress',
        id: 'p1',
        title: 'AgentRun #R-102',
        skill: '代码实现 · codex',
        workspace: 'pfc-notify · git@main',
        status: 'running',
        pct: 8,
        steps: [
          { label: '分析需求与现有代码', st: 'done' },
          { label: '生成通知服务与迁移', st: 'active' },
          { label: '运行单元测试', st: 'todo' },
          { label: '联调消息中心 API', st: 'todo' },
          { label: '汇总变更与证据', st: 'todo' },
        ],
        log: [],
      },
      {
        t: 'terminal',
        id: 't1',
        title: 'Zed 对话流 · 实时镜像',
        lines: [
          { cls: 'cmd', text: 'codex> 已连接工作区 pfc-notify（git@main）' },
          { cls: 'info', text: 'codex> 读取需求 R-1042 与现有消息中心接口…' },
          { cls: 'cmd', text: 'codex> 创建 src/notify/reminder-task.ts' },
          { cls: 'ok', text: 'codex> 单元测试 3 passed' },
          {
            cls: 'cmd',
            text: 'codex> 生成迁移 2026091001_create_reminder_task.ts（待审）',
          },
        ],
      },
      {
        t: 'user',
        text: '先只做通知服务后端和迁移，前端提醒设置页放到下一个迭代。',
      },
      {
        t: 'ai',
        text: '已更新 AgentRun 范围：本次仅后端 + 迁移。Codex 继续执行中，我实时跟进终端输出。',
        ev: { run: 'R-102', skill: '代码实现' },
      },
    ],
    test: [
      {
        t: 'ai',
        text: '开发完成：3 个文件变更，4 个测试通过，1 个迁移生成（未应用）。开始测试门禁执行。',
        ev: { run: 'R-102', skill: '测试执行' },
      },
      {
        t: 'gate',
        id: 'g-test',
        name: '测试门禁',
        status: 'PASS 候选',
        scope: '单元 4/4 · 集成 2/2 · 迁移隔离验证 1/1 · 未授权写入 0',
        ev: { run: 'G-02', skill: '测试执行' },
      },
      {
        t: 'ai',
        text: '测试全部通过。可以进入验收。',
        ev: { run: 'T-401', skill: '测试执行' },
      },
    ],
    accept: [
      {
        t: 'draft',
        id: 'd4',
        title: '验收清单 · 会员积分过期提醒',
        sub: '来源：测试通过 · 建议写入 GateRun ACCEPTED',
        version: 'v4',
        confirmed: false,
        fields: [
          {
            f: '功能验收',
            before: '（空）',
            after: '30/7/1 天触发 · 双渠道送达 · 退订即停 —— 通过',
          },
          {
            f: '权限与边界',
            before: '（空）',
            after: '仅本需求范围写入 · 未授权动作 0 —— 通过',
          },
          {
            f: '视觉验收',
            before: '（空）',
            after: '1280/1440/1920 三宽度无遮挡 —— 通过',
          },
          {
            f: '数据落库',
            before: '（空）',
            after: 'reminder_task 表真实读写回环 —— 通过',
          },
        ],
      },
      {
        t: 'ai',
        text: '验收通过（本地方案）。发布属于受控动作，需要发起发布审批。',
        ev: { run: 'T-501', skill: '验收' },
      },
    ],
    release: [
      {
        t: 'approval',
        id: 'a1',
        title: '发布审批',
        reason: '会员积分过期提醒 v4 发布到本地标准环境',
        scope: [
          { k: '范围', v: '通知服务 + migration 2026091001（仅 pfc_local）' },
          { k: '影响', v: '新增提醒任务表；消息中心只读联调' },
          { k: '回滚', v: '迁移前向修复；入口 feature flag 关闭即恢复' },
          { k: '审批人', v: '陈立（产品负责人）' },
          { k: '有效期', v: '本次发布 · 30 分钟' },
        ],
        status: 'pending',
      },
      {
        t: 'ai',
        text: '审批通过。发布执行中，完成后进入观察窗口。',
        ev: { run: 'REL-601', skill: '发布' },
      },
    ],
    observe: [
      {
        t: 'ai',
        text: '已发布到本地标准环境。进入观察窗口（24h），指标如下。',
        ev: { run: 'OBS-701', skill: '观察' },
      },
      {
        t: 'kpi',
        title: '观察指标 · 首日',
        items: [
          { v: '98.2%', l: '提醒送达率' },
          { v: '12.4%', l: '提醒点击率' },
          { v: '0', l: '异常/报错' },
          { v: '31s', l: '任务 p95 延迟' },
        ],
      },
      {
        t: 'ai',
        text: '复盘：lead time 3.2 天，返工 1 次（范围澄清）。下一迭代建议：提醒设置页前端、积分明细深链。',
        ev: { run: 'RTR-702', skill: '复盘' },
      },
    ],
  };
  /* 简化剧情：R-1031 理赔材料清单重构（验收已通过） */
  const CONVO1031 = {
    req: [
      {
        t: 'gate',
        id: 'g0',
        name: 'G0 登记完整性检查',
        status: 'PASSED',
        scope: '需求名称 / 目标 / 范围 / 负责人 / 验收标准 已齐备',
        ev: { run: 'G-01', skill: '门禁检查' },
      },
      {
        t: 'ai',
        text: 'G0 已通过（R-1031）。需求文档 V0.1 已确认写入 v2：材料清单按险种/渠道结构化，减少人工校验。',
        ev: { run: 'T-103', skill: 'PRD 生成' },
      },
      {
        t: 'draft',
        id: 'd2',
        title: '需求文档 V0.1 · 理赔材料清单重构',
        sub: '已确认 · ArtifactVersion v2',
        version: 'v2',
        confirmed: true,
        appliedVersion: 'v2',
        fields: [
          {
            f: '目标',
            before: '（草稿）',
            after: '材料清单按险种/渠道结构化，人工校验耗时降低 40%',
          },
          {
            f: '范围',
            before: '（空）',
            after: '清单模板重构 + 校验规则化 + 导出',
          },
          {
            f: '验收标准',
            before: '（空）',
            after: 'AC1 三大险种模板齐备 · AC2 校验规则可维护 · AC3 导出可用',
          },
        ],
      },
    ],
    design: [
      {
        t: 'ai',
        text: '方案已确认 v3：清单模板表 + 规则引擎（轻量）。',
        ev: { run: 'T-201', skill: '方案设计' },
      },
      {
        t: 'draft',
        id: 'd3',
        title: '设计方案 · 清单模板化',
        sub: '已确认 · ArtifactVersion v3',
        version: 'v3',
        confirmed: true,
        appliedVersion: 'v3',
        fields: [
          {
            f: '方案',
            before: '（空）',
            after: 'A 硬编码模板（快但难维护）· B 模板表 + 规则（推荐）',
          },
          {
            f: '数据设计',
            before: '（空）',
            after: 'claim_doc_template 表 + rule 配置',
          },
        ],
      },
    ],
    dev: [
      {
        t: 'ai',
        text: '开发完成：模板表迁移 + 清单渲染 + 导出，5 文件变更。',
        ev: { run: 'R-132', skill: '代码实现' },
      },
      {
        t: 'progress',
        id: 'p1',
        title: 'AgentRun #R-132',
        skill: '代码实现 · codex',
        workspace: 'pfc-claim · git@main',
        status: 'done',
        pct: 100,
        steps: [
          { label: '分析现有清单', st: 'done' },
          { label: '模板表与迁移', st: 'done' },
          { label: '渲染与导出', st: 'done' },
          { label: '汇总证据', st: 'done' },
        ],
      },
      {
        t: 'terminal',
        id: 't1',
        title: 'Zed 对话流 · 已完成',
        lines: [
          { cls: 'cmd', text: 'codex> 已连接工作区 pfc-claim' },
          { cls: 'cmd', text: 'codex> 创建 claim_doc_template.ts 迁移' },
          { cls: 'ok', text: 'codex> 单元测试 6 passed' },
        ],
      },
    ],
    test: [
      {
        t: 'gate',
        id: 'g-test',
        name: '测试门禁',
        status: 'PASSED',
        scope: '单元 6/6 · 集成 3/3 · 未授权写入 0',
        ev: { run: 'G-02', skill: '测试执行' },
      },
      {
        t: 'ai',
        text: '测试全部通过，进入验收。',
        ev: { run: 'T-401', skill: '测试执行' },
      },
    ],
    accept: [
      {
        t: 'draft',
        id: 'd4',
        title: '验收清单 · 理赔材料清单重构',
        sub: '已确认 · GateRun ACCEPTED',
        version: 'v4',
        confirmed: true,
        appliedVersion: 'v4',
        fields: [
          {
            f: '功能验收',
            before: '（空）',
            after: '三大险种模板 · 校验规则 · 导出 —— 通过',
          },
          { f: '视觉验收', before: '（空）', after: '三宽度无遮挡 —— 通过' },
        ],
      },
      {
        t: 'ai',
        text: '验收通过。已归档。',
        ev: { run: 'T-501', skill: '验收' },
      },
    ],
    release: [
      {
        t: 'approval',
        id: 'a1',
        title: '发布审批',
        reason: '理赔材料清单重构 v4 发布到本地标准环境',
        scope: [
          { k: '范围', v: '模板表 + 渲染/导出（仅 pfc_local）' },
          { k: '回滚', v: 'feature flag 关闭即恢复' },
          { k: '审批人', v: '陈立（产品负责人）' },
          { k: '状态', v: '已批准 · 已完成' },
        ],
        status: 'approved',
      },
      {
        t: 'ai',
        text: '发布已完成，进入观察。',
        ev: { run: 'REL-631', skill: '发布' },
      },
    ],
    idea: [],
    observe: [],
  };
  /* 简化剧情：R-1018 续保提醒优化（发布观察中） */
  const CONVO1018 = {
    req: [
      {
        t: 'gate',
        id: 'g0',
        name: 'G0 登记完整性检查',
        status: 'PASSED',
        scope: '需求名称 / 目标 / 范围 / 负责人 / 验收标准 已齐备',
        ev: { run: 'G-01', skill: '门禁检查' },
      },
      {
        t: 'ai',
        text: 'G0 已通过（R-1018）。需求文档 v2 已确认：续保提醒由短信扩展为 App 推送 + 短信，加入沉默用户分层。',
        ev: { run: 'T-103', skill: 'PRD 生成' },
      },
      {
        t: 'draft',
        id: 'd2',
        title: '需求文档 V0.1 · 续保提醒优化',
        sub: '已确认 · ArtifactVersion v2',
        version: 'v2',
        confirmed: true,
        appliedVersion: 'v2',
        fields: [
          {
            f: '目标',
            before: '（草稿）',
            after: '续保提醒触达率 +15%，沉默用户唤醒',
          },
          {
            f: '范围',
            before: '（空）',
            after: '推送渠道接入 + 分层策略 + 退订管理',
          },
          {
            f: '验收标准',
            before: '（空）',
            after: 'AC1 双渠道送达 · AC2 沉默分层命中',
          },
        ],
      },
    ],
    design: [
      {
        t: 'ai',
        text: '方案已确认 v3：复用消息中心 + 分层标签。',
        ev: { run: 'T-201', skill: '方案设计' },
      },
    ],
    dev: [
      {
        t: 'ai',
        text: '开发完成：渠道适配 + 分层策略，4 文件变更。',
        ev: { run: 'R-118', skill: '代码实现' },
      },
      {
        t: 'progress',
        id: 'p1',
        title: 'AgentRun #R-118',
        skill: '代码实现 · codex',
        workspace: 'pfc-renew · git@main',
        status: 'done',
        pct: 100,
        steps: [
          { label: '渠道适配', st: 'done' },
          { label: '分层策略', st: 'done' },
          { label: '测试', st: 'done' },
        ],
      },
      {
        t: 'terminal',
        id: 't1',
        title: 'Zed 对话流 · 已完成',
        lines: [
          { cls: 'cmd', text: 'codex> 接入推送渠道适配层' },
          { cls: 'ok', text: 'codex> 单元测试 5 passed' },
        ],
      },
    ],
    test: [
      {
        t: 'gate',
        id: 'g-test',
        name: '测试门禁',
        status: 'PASSED',
        scope: '单元 5/5 · 集成 2/2 · 未授权写入 0',
        ev: { run: 'G-02', skill: '测试执行' },
      },
      {
        t: 'ai',
        text: '测试通过，进入验收。',
        ev: { run: 'T-401', skill: '测试执行' },
      },
    ],
    accept: [
      { t: 'ai', text: '验收通过。', ev: { run: 'T-501', skill: '验收' } },
    ],
    release: [
      {
        t: 'approval',
        id: 'a1',
        title: '发布审批',
        reason: '续保提醒优化 v4 发布到本地标准环境',
        scope: [
          { k: '范围', v: '渠道适配 + 分层策略（仅 pfc_local）' },
          { k: '审批人', v: '陈立（产品负责人）' },
          { k: '状态', v: '已批准 · 已完成' },
        ],
        status: 'approved',
      },
      {
        t: 'ai',
        text: '发布已完成，观察窗口进行中。',
        ev: { run: 'REL-618', skill: '发布' },
      },
    ],
    observe: [
      {
        t: 'ai',
        text: '观察第 3 小时：触达率 96.8%，沉默用户唤醒 3.1%。',
        ev: { run: 'OBS-718', skill: '观察' },
      },
      {
        t: 'kpi',
        title: '观察指标 · 进行中',
        items: [
          { v: '96.8%', l: '触达率' },
          { v: '3.1%', l: '沉默唤醒' },
          { v: '0', l: '异常/报错' },
        ],
      },
    ],
    idea: [],
  };
  /* 需求元数据（首页最近需求 + 工作空间切换） */
  const REQS = [
    {
      id: 'R-1042',
      name: '会员积分过期提醒',
      status: '开发 · 进行中',
      stage: 'dev',
    },
    {
      id: 'R-1031',
      name: '理赔材料清单重构',
      status: '验收 · 已通过',
      stage: 'accept',
    },
    {
      id: 'R-1018',
      name: '续保提醒优化',
      status: '发布 · 观察中',
      stage: 'observe',
    },
  ];

  /* 能力目录（配置中心的权威数据） */
  const CAPABILITIES = [
    {
      id: 'req-clarify',
      name: '需求澄清',
      type: 'Skill',
      src: 'PFC 官方',
      ver: 'v1.2',
      perm: '只读 + 建议',
      ico: 'sparkles',
      color: '#A855F7',
      desc: '把模糊想法整理成结构化需求草案与澄清问题',
    },
    {
      id: 'prd-gen',
      name: 'PRD 生成',
      type: 'Skill',
      src: 'PFC 官方',
      ver: 'v1.1',
      perm: '只读 + 建议',
      ico: 'file',
      color: '#3B82F6',
      desc: '基于需求生成需求文档 V0.1 与验收标准',
    },
    {
      id: 'design-plan',
      name: '方案设计',
      type: 'Skill',
      src: 'PFC 官方',
      ver: 'v0.9',
      perm: '只读 + 建议',
      ico: 'layers',
      color: '#8B5CF6',
      desc: '生成方案对比、交互要点与数据设计候选',
    },
    {
      id: 'code-impl',
      name: '代码实现',
      type: 'Skill',
      src: 'PFC 官方',
      ver: 'v1.3',
      perm: '受控执行',
      ico: 'cpu',
      color: '#06B6D4',
      desc: '驱动 Codex 在本地工作区实现功能',
    },
    {
      id: 'test-run',
      name: '测试执行',
      type: 'Skill',
      src: 'PFC 官方',
      ver: 'v1.0',
      perm: '受控执行',
      ico: 'shield',
      color: '#F97316',
      desc: '运行单元/集成/E2E 并汇总门禁证据',
    },
    {
      id: 'accept-check',
      name: '验收检查',
      type: 'Skill',
      src: 'PFC 官方',
      ver: 'v0.8',
      perm: '只读 + 建议',
      ico: 'check',
      color: '#22C55E',
      desc: '按验收标准逐项检查并生成验收清单',
    },
    {
      id: 'release-run',
      name: '发布执行',
      type: 'Skill',
      src: 'PFC 官方',
      ver: 'v0.7',
      perm: '受控 + 审批',
      ico: 'send',
      color: '#0078C8',
      desc: '按发布检查单执行本地标准环境发布',
    },
    {
      id: 'review',
      name: '复盘分析',
      type: 'Skill',
      src: 'PFC 官方',
      ver: 'v0.6',
      perm: '只读 + 建议',
      ico: 'activity',
      color: '#64748B',
      desc: '汇总 lead time / 返工 / 缺陷来源并输出复盘',
    },
    {
      id: 'mcp-doc',
      name: '飞书文档',
      type: 'MCP',
      src: 'MCP 市场',
      ver: 'v2.0',
      perm: '读写（授权）',
      ico: 'folder',
      color: '#0078C8',
      desc: '读取/写入需求文档、PRD、会议纪要',
    },
    {
      id: 'mcp-db',
      name: '数据库查询',
      type: 'MCP',
      src: 'MCP 市场',
      ver: 'v1.4',
      perm: '只读',
      ico: 'list',
      color: '#64748B',
      desc: '只读查询 pfc_local 业务表（受权限约束）',
    },
    {
      id: 'codex',
      name: 'Codex',
      type: '终端工具',
      src: 'OpenAI',
      ver: 'app-server 0.1',
      perm: '受控执行',
      ico: 'terminal',
      color: '#0F172A',
      desc: '本地 AI 开发终端，受控执行代码变更',
    },
    {
      id: 'zed',
      name: 'Zed',
      type: '终端工具',
      src: 'Zed 官方',
      ver: '0.16',
      perm: '会话镜像',
      ico: 'git',
      color: '#06B6D4',
      desc: '开发会话镜像，实时跟踪对话流',
    },
    {
      id: 'vscode',
      name: 'VS Code',
      type: '终端工具',
      src: 'Microsoft',
      ver: '1.9',
      perm: '会话镜像',
      ico: 'settings',
      color: '#3B82F6',
      desc: '通用编辑器，支持任务接管与 Diff 查看',
    },
  ];
  /* 阶段 × 能力绑定（配置中心「阶段绑定」Tab 的默认值） */
  const STAGE_BIND = {
    idea: ['req-clarify', 'mcp-doc'],
    req: ['req-clarify', 'prd-gen', 'mcp-doc'],
    design: ['design-plan', 'mcp-db'],
    dev: ['code-impl', 'codex', 'zed', 'vscode', 'mcp-db'],
    test: ['test-run', 'codex', 'mcp-db'],
    accept: ['accept-check', 'mcp-doc'],
    release: ['release-run', 'mcp-doc'],
    observe: ['review', 'mcp-db', 'mcp-doc'],
  };
  const CAP_ICON = {
    sparkles: ICONS.sparkles,
    file: ICONS.file,
    cpu: ICONS.cpu,
    shield: ICONS.shield,
    folder: ICONS.folder,
    list: ICONS.list,
    terminal: ICONS.terminal,
    git: ICONS.git,
    settings: ICONS.settings,
    layers: ICONS.layers,
    check: ICONS.check,
    send: ICONS.send,
    activity: ICONS.activity,
  };
  const TYPE_COLOR = { Skill: '#7E22CE', MCP: '#1D4ED8', 终端工具: '#0E7490' };

  window.PFCDATA = {
    ICONS,
    STAGES,
    CONVO,
    CONVO1031,
    CONVO1018,
    REQS,
    CAPABILITIES,
    STAGE_BIND,
  };
})();
