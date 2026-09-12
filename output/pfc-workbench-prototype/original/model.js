(() => {
  'use strict';
  const D = window.PFCDATA,
    clone = (v) => JSON.parse(JSON.stringify(v));
  /* 数据层适配器：默认 local（=localStorage 直通，原型基线行为）；
     mock/api 由 data-layer.js 提供；vm 回归环境无 PFCStore 时回退 localStorage。
     每次调用动态取 active()，使同一会话内 setMode 后读写走新 store */
  const STORE = () =>
    (window.PFCStore && window.PFCStore.active()) || localStorage;
  const P = (window.PFC = { D, clone, KEY: 'pfc.prototype.original.guide.v1' });
  P.index = (id) => D.STAGES.findIndex((x) => x.id === id);
  P.stageName = (id) => D.STAGES.find((x) => x.id === id)?.label || '想法';
  P.labels = {
    QUEUED: '排队中',
    RUNNING: '运行中',
    WAITING_INPUT: '等待输入',
    WAITING_APPROVAL: '等待授权',
    CANCELLING: '正在停止',
    CANCELLED: '已取消',
    UNKNOWN: '结果未知',
    VERIFYING: '核验中',
    SUCCEEDED: '已完成',
    FAILED: '失败',
  };
  P.gates = {
    idea: 'G0–G2',
    req: 'G3–G5',
    design: 'G6–G8 / G9-A 方案确认',
    dev: 'G9-A 实施 / G9-B 提测',
    test: 'G10 测试',
    accept: 'G10 产品验收',
    release: 'G11 发布',
    observe: 'G11 观察 / G12 复盘',
  };
  const titles = {
    idea: '需求草案',
    req: '需求文档',
    design: '技术方案',
    dev: '代码变更与提测交接',
    test: '测试报告',
    accept: '验收清单',
    release: '发布方案',
    observe: '复盘报告',
  };
  function version(req, stage, fields, confirmed = false) {
    return {
      id: `${req}-${stage}-v1`,
      version: 1,
      title: titles[stage],
      fields,
      confirmed,
      review: confirmed ? '通过' : '待评审',
      comments: [],
      createdAt: '2026-09-11T00:00:00.000Z',
    };
  }
  P.makeRequirement = (id, name, goal, stage = 'idea', source = null) => {
    const r = {
      id,
      name,
      goal,
      owner: '陈立',
      stage,
      closed: false,
      baseline: 1,
      workspace: 'pfc-' + id.toLowerCase(),
      projectId: null, // 现有系统迭代：关联已加载的本地项目
      capId: id + '-CAP-01',
      units: [
        {
          acIds: ['AC-01'],
          id: id + '-U01',
          name: '规则与数据处理',
          status: '待开始',
          owner: '陈立',
          dep: null,
        },
        {
          acIds: ['AC-02'],
          id: id + '-U02',
          name: '交互与结果回传',
          status: '待开始',
          owner: '陈立',
          dep: id + '-U01',
        },
      ],
      acs: source
        ? [
            { id: 'AC-01', text: '规则命中时生成任务，边界条件正确' },
            { id: 'AC-02', text: '关闭开关后停止触达，结果可追踪' },
          ]
        : [
            {
              id: 'AC-01',
              text:
                (goal || name).includes('提醒') ||
                (goal || name).includes('通知') ||
                (goal || name).includes('到期') ||
                (goal || name).includes('规则') ||
                (goal || name).includes('触达')
                  ? '规则命中时生成任务，边界条件正确（由输入候选，待业务确认）'
                  : '「' +
                    name +
                    '」核心流程按输入描述可用，结果正确（由输入候选，待业务确认）',
            },
            {
              id: 'AC-02',
              text: '异常与退出边界符合本次范围约定（由输入候选，待业务确认）',
            },
          ],
      questions: [
        {
          id: 'q1',
          text: '本次覆盖的用户与范围是什么？',
          answer:
            stage === 'idea' ? '' : '本需求涉及的已启用用户，覆盖约定范围',
        },
        {
          id: 'q2',
          text: '异常、退出与验收边界是什么？',
          answer:
            stage === 'idea' ? '' : '失败可重试，关闭后停止；按 AC-01/02 验收',
        },
      ],
      materials: [
        {
          id: id + '-M1',
          name: '原始想法',
          type: '文本',
          content: goal,
          classification: '内部',
          allowed: true,
          status: '已纳入',
          version: 1,
        },
      ],
      artifacts: {},
      messages: [],
      runs: [],
      overrides: {},
      timeline: [],
      tests: [],
      testRuns: [],
      defects: [],
      accept: null,
      release: null,
      releaseHistory: [],
      observation: null,
      impact: null,
      impactList: [],
      attachments: [],
      contextRefs: [],
      caps: [],
    };
    /* 多 CAP 编排：默认一个核心 CAP 收纳全部 Unit；后续可通过拆分动作扩展 */
    r.caps = [{ id: id + '-CAP-01', name: '核心流程', unitIds: r.units.map((x) => x.id) }];
    for (const st of D.STAGES) {
      const draft = source?.[st.id]?.find((x) => x.t === 'draft');
      const fields = draft
        ? draft.fields.map((x) => ({ name: x.f, value: x.after }))
        : [
            { name: '目标', value: goal },
            {
              name: '范围',
              value: `围绕「${name}」实现约定规则、结果展示及异常处理`,
            },
            {
              name: '非目标',
              value: '不扩展到其他业务范围，不自动操作生产环境',
            },
            {
              name: '验收标准',
              value: r.acs.map((x) => x.id + ' ' + x.text).join('\n'),
            },
          ];
      r.artifacts[st.id] = [
        version(
          id,
          st.id,
          fields,
          P.index(st.id) < P.index(stage) ||
            (P.index(stage) >= 5 && st.id === 'accept'),
        ),
      ];
    }
    r.timeline.push({
      id: id + '-E1',
      time: '2026-09-11T00:00:00Z',
      action: '需求登记',
      detail: name,
      stage: 'idea',
      actor: '陈立',
    });
    if (P.index(stage) >= 4)
      r.tests = r.acs.map((x) => ({
        ...x,
        status: 'PASS',
        actual: '合成场景已通过',
        runId: id + '-TEST-1',
      }));
    if (P.index(stage) >= 5)
      r.accept = {
        status: 'ACCEPTED',
        note: '按当前版本完成验收（示例）',
        actor: '陈立',
      };
    return r;
  };
  P.factory = () => {
    const templates = {
      'R-1042': D.CONVO,
      'R-1031': D.CONVO1031,
      'R-1018': D.CONVO1018,
    };
    const reqs = {};
    for (const meta of D.REQS) {
      const r = P.makeRequirement(
        meta.id,
        meta.name,
        templates[meta.id].req.find((x) => x.t === 'draft')?.fields[0].after ||
          meta.name,
        meta.stage,
        templates[meta.id],
      );
      reqs[r.id] = r;
      const progress = templates[meta.id].dev.find((x) => x.t === 'progress');
      r.workspace = progress.workspace.split(' · ')[0];
      const matchedProject = P.s?.projects?.find((p) => p.name === r.workspace);
      if (matchedProject) r.projectId = matchedProject.id;
      /* 演示多 CAP 编排：R-1042 拆分为两个独立 CAP（规则处理 / 交互回传） */
      if (meta.id === 'R-1042') {
        r.caps = [
          { id: 'R-1042-CAP-01', name: '规则与数据处理', unitIds: ['R-1042-U01'] },
          { id: 'R-1042-CAP-02', name: '交互与结果回传', unitIds: ['R-1042-U02'] },
        ];
      }
      r.runs = [
        {
          id: progress.title.replace('AgentRun #', ''),
          parentId: null,
          status: progress.status === 'running' ? 'RUNNING' : 'SUCCEEDED',
          pct: progress.pct,
          step: progress.status === 'running' ? 0 : 6,
          operation: '开发实现',
          controller: 'Web',
          scope: '项目文件、Git 只读、格式化、测试、构建；网络关闭',
          snapshot: [],
          stamp: '',
          lines: clone(
            templates[meta.id].dev.find((x) => x.t === 'terminal').lines,
          ),
          exitCode: progress.status === 'running' ? null : 0,
          verified: true,
          preview: false,
          planApproved: {
            by: '陈立',
            at: '2026-09-10T00:00:00Z',
            plan: '拆解：1) 读取项目结构与目标文件 2) 按方案实现改动并运行测试 3) 格式化、构建并汇总差异供验收',
          },
          qualityGates: [
            { id: 'lint', name: 'Lint / 静态检查', status: progress.status === 'running' ? '待执行' : '通过' },
            { id: 'unit', name: '单元测试', status: progress.status === 'running' ? '待执行' : '通过' },
            { id: 'coverage', name: '覆盖率 ≥ 80%', status: progress.status === 'running' ? '待执行' : '通过' },
            { id: 'build', name: '构建', status: progress.status === 'running' ? '待执行' : '通过' },
            { id: 'security', name: '安全扫描', status: progress.status === 'running' ? '待执行' : '通过' },
          ],
        },
      ];
    }
    return {
      schema: 1,
      seq: 1200,
      revision: 0,
      clockOffset: 0,
      role: 'owner',
      reqs,
      caps: clone(D.CAPABILITIES),
      enabled: D.CAPABILITIES.map((x) => x.id),
      bindings: clone(D.STAGE_BIND),
      /* 组织级知识库：复盘结论 / 组件规范 / 接口契约沉淀，新需求自动检索引用 */
      knowledge: [
        {
          id: 'KN-01',
          title: '提醒设置页前端规范',
          type: '组件规范',
          content:
            '提醒设置页使用现有表单组件库，时间选择器复用 notify-time-picker；禁直接拼接样式。来源：R-1042 复盘。',
          sourceReq: 'R-1042',
          tags: ['前端', '提醒', '规范'],
          at: '2026-09-10T00:00:00Z',
        },
        {
          id: 'KN-02',
          title: '积分明细深链契约',
          type: '接口契约',
          content:
            '积分明细页支持 ?userId=&month= 深链参数；后端返回按月聚合，缺省当月。来源：R-1042 复盘。',
          sourceReq: 'R-1042',
          tags: ['接口', '积分', '契约'],
          at: '2026-09-10T00:00:00Z',
        },
        {
          id: 'KN-03',
          title: '理赔进度查询范围澄清要点',
          type: '复盘结论',
          content:
            '理赔进度查询需求首次范围过大（含推送/自助/客服联动），拆分后先做查询页；澄清问题应聚焦用户场景而非技术方案。来源：R-1042 复盘。',
          sourceReq: 'R-1042',
          tags: ['理赔', '范围', '复盘'],
          at: '2026-09-10T00:00:00Z',
        },
        {
          id: 'KN-04',
          title: '上线检查清单（标准 Playbook）',
          type: 'Playbook',
          content:
            '1) 发布卡检查回滚方案与观察窗口 2) 质量门与测试全绿 3) 审批后执行 CI/CD 4) 观察期跟踪指标，异常即回滚。',
          sourceReq: null,
          tags: ['上线', 'Playbook', '发布'],
          at: '2026-09-10T00:00:00Z',
        },
      ],
      audit: [],
      /* 通知流：关键事件自动入队，未读计数驱动铃铛徽标 */
      notices: [
        {
          id: 'NT-1',
          title: '发布审批待处理：REL-7',
          kind: 'info',
          req: 'R-1042',
          read: false,
          at: '2026-09-10T00:00:00Z',
        },
        {
          id: 'NT-2',
          title: '观察窗口即将结束，请完成复盘',
          kind: 'info',
          req: 'R-1042',
          read: false,
          at: '2026-09-11T00:00:00Z',
        },
      ],
      /* 生态插件市场：安装即登记为待复核能力 */
      plugins: [
        {
          id: 'PLG-01',
          name: 'GitHub Actions 集成',
          protocol: 'MCP',
          endpoint: 'npx mcp-gh-actions',
          author: 'PFC 生态',
          ver: '1.2.0',
          desc: '将 CI/CD 流水线状态实时回填到发布卡与质量门。',
          ico: 'git',
          color: '#8BC8EA',
        },
        {
          id: 'PLG-02',
          name: '飞书消息推送',
          protocol: 'ACP',
          endpoint: 'ws://localhost:4300',
          author: 'PFC 生态',
          ver: '0.9.0',
          desc: '把通知流推送至飞书群 / IM，审批与告警触达。',
          ico: 'bell',
          color: '#9BBBF4',
        },
        {
          id: 'PLG-03',
          name: '代码评审 Agent',
          protocol: 'ACP',
          endpoint: 'ws://localhost:4200',
          author: 'PFC 生态',
          ver: '1.0.1',
          desc: '开发阶段自动发起代码评审，结果进入会话与审计。',
          ico: 'shield',
          color: '#94D4D0',
        },
        {
          id: 'PLG-04',
          name: '数据指标 MCP',
          protocol: 'MCP',
          endpoint: 'npx mcp-metrics-dw',
          author: 'PFC 生态',
          ver: '0.8.0',
          desc: '观察期自动拉取数仓 / 埋点指标，按需求维度聚合。',
          ico: 'chart',
          color: '#94D8C3',
        },
      ],
      /* 本地项目库：现有系统迭代先加载项目，再在项目上下文里澄清与开发 */
      projects: [
        {
          id: 'PRJ-01',
          name: 'pfc-notify',
          path: 'D:\\Projects\\pfc-notify',
          repo: 'git@host:pfc/notify.git',
          branch: 'feature/remind',
          tech: ['TypeScript', 'Node.js'],
          files: 128,
          loadedAt: '2026-09-11T00:00:00Z',
          source: 'existing',
        },
        {
          id: 'PRJ-02',
          name: 'pfc-claim',
          path: 'D:\\Projects\\pfc-claim',
          repo: 'git@host:pfc/claim.git',
          branch: 'main',
          tech: ['Java', 'Spring'],
          files: 342,
          loadedAt: '2026-09-11T00:00:00Z',
          source: 'existing',
        },
        {
          id: 'PRJ-03',
          name: 'pfc-renew',
          path: 'D:\\Projects\\pfc-renew',
          repo: 'git@host:pfc/renew.git',
          branch: 'main',
          tech: ['TypeScript', 'Node.js'],
          files: 96,
          loadedAt: '2026-09-11T00:00:00Z',
          source: 'existing',
        },
      ],
      team: {
        name: '产品全链路团队',
        members: [
          { name: '陈立', role: '负责人' },
          { name: '体验成员', role: '只读' },
        ],
      },
      bridges: [
        {
          id: 'BR-01',
          name: '本地开发电脑',
          status: 'ONLINE',
          workspace: 'D:\\Projects\\pfc-workspace',
        },
        {
          id: 'BR-02',
          name: '备用笔记本',
          status: 'OFFLINE',
          workspace: 'D:\\Projects\\pfc-workspace',
        },
      ],
      ui: {
        route: 'home',
        req: 'R-1042',
        stage: 'dev',
        panel: 'terminal',
        productTab: 'requirements',
        govTab: 'catalog',
        drafts: {},
        editDrafts: {},
        search: '',
        artifactStage: null,
        version: null,
        runId: null,
        pending: {},
        stageAll: false,
        expandAll: false,
      },
      viewState: 'normal',
    };
  };
  P.valid = (s) =>
    s?.schema === 1 &&
    s.reqs &&
    Array.isArray(s.caps) &&
    Array.isArray(s.enabled) &&
    s.ui?.drafts &&
    s.ui?.editDrafts &&
    typeof s.ui.search === 'string' &&
    s.bindings &&
    Number.isFinite(s.clockOffset) &&
    Number.isFinite(s.seq) &&
    Array.isArray(s.team?.members) &&
    Array.isArray(s.bridges) &&
    Array.isArray(s.audit) &&
    Object.values(s.reqs).every(
      (r) =>
        D.STAGES.some((x) => x.id === r.stage) &&
        Array.isArray(r.runs) &&
        Array.isArray(r.materials) &&
        Array.isArray(r.questions) &&
        Array.isArray(r.tests) &&
        Array.isArray(r.defects) &&
        Array.isArray(r.units) &&
        Array.isArray(r.acs) &&
        Array.isArray(r.messages) &&
        Array.isArray(r.timeline) &&
        r.overrides &&
        D.STAGES.every(
          (st) =>
            Array.isArray(r.artifacts?.[st.id]) &&
            r.artifacts[st.id].length &&
            r.artifacts[st.id].every(
              (v) =>
                Array.isArray(v.fields) &&
                v.fields.every((f) => typeof f.value === 'string'),
            ),
        ),
    );
  P.latest = (r, stage) => r.artifacts[stage].at(-1);
  P.stamp = (r) =>
    `${r.baseline}|${['idea', 'req', 'design'].map((st) => P.latest(r, st).id).join('|')}`;
  P.gitMeta = (r, seed) => {
    const s = Math.abs(seed || r.id.split('-')[1] || 0) % 997;
    return {
      repo: r.workspace,
      branch: s % 3 === 0 ? 'feature/remind' : 'main',
      commit:
        'c' +
        (1000000 + s * 7919 + (r.runs.length || 0) * 131)
          .toString(16)
          .slice(-7),
      dirty: s % 4 !== 0,
    };
  };
  P.hasCurrentSuccess = (r) =>
    r.runs.some(
      (x) =>
        x.status === 'SUCCEEDED' &&
        x.stamp === P.stamp(r) &&
        !r.rejectedRunIds?.includes(x.id),
    );
  P.now = () => Date.now() + P.s.clockOffset;
  try {
    const stored = STORE().getItem(P.KEY);
    P.s = stored ? JSON.parse(stored) : P.factory();
    if (!P.valid(P.s)) throw Error('原型数据格式不兼容');
    if (stored)
      for (const r of Object.values(P.s.reqs))
        for (const run of r.runs)
          if (['RUNNING', 'CANCELLING', 'VERIFYING'].includes(run.status)) {
            run.status = 'UNKNOWN';
            run.verified = false;
          }
  } catch {
    P.s = P.factory();
    P.loadNotice = '已恢复演示数据：原存储无法读取。';
  }
  P.storageBase = STORE().getItem(P.KEY);
  /* 旧存储兼容：补齐新增字段，不覆盖已有记录 */
  if (!Array.isArray(P.s.projects)) P.s.projects = [];
  if (!Array.isArray(P.s.knowledge)) P.s.knowledge = [];
  if (!Array.isArray(P.s.notices)) P.s.notices = [];
  if (!Array.isArray(P.s.plugins)) P.s.plugins = [];
  for (const r of Object.values(P.s.reqs)) {
    for (const run of r.runs || []) {
      if (!Array.isArray(run.qualityGates)) run.qualityGates = [];
      if (!run.planApproved)
        run.planApproved = {
          by: '陈立',
          at: run.stamp || new Date(P.now()).toISOString(),
          plan: '（旧记录）执行范围即计划',
        };
    }
    if (r.projectId == null) {
      const pj = P.s.projects.find((p) => p.name === r.workspace);
      r.projectId = pj?.id || null;
    }
    if (!Array.isArray(r.testRuns)) r.testRuns = [];
    if (P.s.ui) {
      if (typeof P.s.ui.stageAll !== 'boolean') P.s.ui.stageAll = false;
      if (typeof P.s.ui.expandAll !== 'boolean') P.s.ui.expandAll = false;
    }
    if (!Array.isArray(r.impactList)) {
      r.impactList = r.impact ? [r.impact] : [];
      if (r.impact) r.impact = r.impactList[0];
    }
    if (!Array.isArray(r.attachments)) r.attachments = [];
    if (!Array.isArray(r.contextRefs)) r.contextRefs = [];
    for (const m of r.messages || []) {
      if (!Array.isArray(m.attachments)) m.attachments = [];
      if (!Array.isArray(m.refs)) m.refs = [];
      if (!m.turnId)
        m.turnId = 'T-' + (m.id || Math.random().toString(36).slice(2, 8));
      if (!m.status) m.status = 'ok';
      if (!m.error) m.error = '';
    }
    if (!Array.isArray(r.runs)) r.runs = [];
    for (const run of r.runs) {
      if (!Array.isArray(run.files)) run.files = [];
      if (!run.scopeId) run.scopeId = run.id + '-scope';
      if (!run.git) run.git = P.gitMeta(r, run.id.split('-')[1] || 0);
      if (run.budget == null) run.budget = 8000;
      if (run.limit == null) run.limit = 3;
      if (!run.lease)
        run.lease = {
          controller: run.controller || 'Web',
          deviceId: null,
          deviceName: '未绑定（旧记录）',
          state: run.status === 'RUNNING' ? 'unknown' : 'none',
        };
    }
    for (const [n, u] of (r.units || []).entries()) {
      // Legacy positional links are migrated once; subsequent ordering never changes identity.
      if (!Array.isArray(u.acIds)) u.acIds = r.acs[n] ? [r.acs[n].id] : [];
      if (!u.owner) u.owner = '陈立';
      if (!u.dep) u.dep = null;
    }
    // Multi-CAP: old records fall back to a single core CAP owning every unit.
    if (!Array.isArray(r.caps) || !r.caps.length)
      r.caps = [
        {
          id: r.id + '-CAP-01',
          name: '核心流程',
          unitIds: (r.units || []).map((x) => x.id),
        },
      ];
    for (const c of r.caps)
      if (!Array.isArray(c.unitIds))
        c.unitIds = (r.units || []).filter((u) => !u.cap || u.cap === c.id).map((x) => x.id);
    if (r.release && !r.release.snapshot) r.release.snapshot = null;
    if (r.observation) {
      if (!Array.isArray(r.observation.entries)) r.observation.entries = [];
      if (!r.observation.anomaly) r.observation.anomaly = null;
      if (!Array.isArray(r.observation.followups)) r.observation.followups = [];
    }
  }
  for (const r of Object.values(P.s.reqs)) {
    for (const run of r.runs) if (!run.stamp) run.stamp = P.stamp(r);
    if (r.stage === 'observe' && !r.release) {
      r.release = {
        id: r.id + '-REL-1',
        status: 'SUCCEEDED',
        target: '本地演示环境',
        scope: '当前已验收版本',
        rollback: '关闭功能入口，恢复上一个已验证版本',
        hours: 24,
        stamp: P.stamp(r),
        actor: '陈立',
        startedAt: P.now() - 25 * 3600000,
      };
      r.observation = {
        startedAt: P.now() - 25 * 3600000,
        hours: 24,
        metrics: '送达率 98.2%（目标 ≥97%）；异常数 0（演示）',
        conclusion: '',
      };
    }
  }
  P.r = () => P.s.reqs[P.s.ui.req] || Object.values(P.s.reqs)[0] || null;
  P.uiBag = (reqId) => {
    const req = reqId || P.r()?.id || P.s.ui.req || 'none',
      pending = (P.s.ui.pending = P.s.ui.pending || {});
    if (!pending[req]) pending[req] = { atts: [], refs: [], reply: null };
    return pending[req];
  };
  P.run = (r) => r.runs.find((x) => x.id === P.s.ui.runId) || r.runs.at(-1);
  // Check the stored snapshot on every write, including input autosave and timers.
  // The storage event is only a UI notification and is not the write guard.
  P.checkRevision = () => {
    /* api 模式：服务端权威，无本地跨窗口冲突概念 → 恒通过 */
    try {
      if (window.PFCStore && window.PFCStore.mode === 'api') return true;
    } catch {
      /* ignore */
    }
    try {
      if (STORE().getItem(P.KEY) !== P.storageBase) P.conflict = true;
    } catch {
      P.storageError = true;
      return false;
    }
    return !P.conflict;
  };
  P.save = () => {
    if (!P.checkRevision()) return false;
    const revision = (P.s.revision || 0) + 1;
    try {
      const raw = JSON.stringify({ ...P.s, revision });
      STORE().setItem(P.KEY, raw);
      P.s.revision = revision;
      P.storageBase = raw;
      P.storageError = false;
      /* api 模式：保存后 debounce 自动同步服务端（500ms 合并写入） */
      try {
        if (
          window.PFCStore &&
          window.PFCStore.mode === 'api' &&
          window.PFCAPI &&
          window.PFCAPI.api
        ) {
          window.PFCAPI.api.scheduleFlush();
        }
      } catch {
        /* ignore */
      }
      return true;
    } catch {
      P.storageError = true;
      P.toast?.(
        '本地保存失败，当前修改仍在页面中；请导出记录后释放浏览器存储空间。',
        'error',
      );
      return false;
    }
  };
  // Preserve pre-migration drafts under the requirement which owned the old composer.
  const legacyBag = P.uiBag(P.s.ui.req);
  for (const [oldKey, newKey] of [
    ['pendingAttachments', 'atts'],
    ['pendingRefs', 'refs'],
  ]) {
    for (const item of P.s.ui[oldKey] || [])
      if (!legacyBag[newKey].some((x) => x.id === item.id))
        legacyBag[newKey].push(item);
    delete P.s.ui[oldKey];
  }
  P.assert = (ok, msg) => {
    if (!ok) throw Error(msg);
  };
  P.canWrite = () => P.s.role !== 'viewer' && P.checkRevision();
  P.write = () => {
    P.assert(
      P.s.role !== 'viewer',
      '只读成员可以查看，修改需负责人或执行者权限。',
    );
    P.assert(
      P.checkRevision(),
      '另一窗口已更新，请重新载入最新记录；未发送输入仍保留。',
    );
  };
  P.current = (r) =>
    P.assert(
      P.s.ui.stage === r.stage,
      '正在查看其他阶段，请先返回当前阶段处理。',
    );
  P.log = (r, action, detail = '') => {
    const e = {
      id: 'EV-' + ++P.s.seq,
      time: new Date(P.now()).toISOString(),
      action,
      detail,
      stage: r?.stage || 'governance',
      actor: '陈立',
    };
    if (r) r.timeline.push(e);
    P.s.audit.unshift({ ...e, req: r?.id || '团队' });
    P.s.audit = P.s.audit.slice(0, 300);
  };
  /* 通知流：关键事件入队（未读），供铃铛徽标与通知中心消费 */
  P.pushNotice = (title, req, kind = 'info') => {
    P.s.notices.unshift({
      id: 'NT-' + (P.s.seq + P.s.notices.length + 1),
      title,
      kind,
      req: req || '团队',
      read: false,
      at: new Date(P.now()).toISOString(),
    });
    P.write();
  };
  P.effective = (r, stage = r.stage) =>
    P.s.caps.filter(
      (c) =>
        P.s.enabled.includes(c.id) &&
        (r.overrides[stage]?.[c.id] ?? P.s.bindings[stage]?.includes(c.id)),
    );
  P.blockers = (r) => {
    const out = [];
    if (r.impact) out.push('处理材料变更影响');
    const st = r.stage,
      v = P.latest(r, st);
    if (
      ['idea', 'req', 'design', 'dev'].includes(st) &&
      (!v.confirmed || v.stale)
    )
      out.push('确认当前' + titles[st] + '版本');
    if (st === 'idea' && r.questions.some((x) => !x.answer.trim()))
      out.push('回答全部澄清问题');
    if (
      st === 'idea' &&
      !r.materials.some((x) => x.allowed && x.status === '已纳入')
    )
      out.push('纳入至少一份可用来源材料');
    if (st === 'req' && (!r.units.length || !r.acs.length))
      out.push('补齐 Unit 与验收标准');
    if (st === 'dev' && !P.hasCurrentSuccess(r))
      out.push('完成当前基线的开发作业');
    if (
      st === 'test' &&
      (!r.tests.length ||
        r.tests.some((x) => x.status !== 'PASS') ||
        r.defects.some((x) => x.status !== 'CLOSED'))
    )
      out.push('测试通过并关闭缺陷');
    if (st === 'accept' && r.accept?.status !== 'ACCEPTED')
      out.push('完成具名产品验收');
    if (st === 'release') out.push('完成发布审批与执行');
    if (st === 'observe' && !r.closed) out.push('完成观察窗口与复盘');
    return out;
  };
  /* 多 CAP 编排：独立状态 + 聚合。done 依据 CAP 内全部 Unit 状态；任一未完成即聚合未完成 */
  P.capStatus = (r) => {
    const caps = r.caps && r.caps.length ? r.caps : [];
    if (!caps.length) return { caps: [], done: 0, total: 0, blocked: [] };
    const doneIds = new Set(
      r.units
        .filter((u) => u.status === '已实现' || u.status === '已完成')
        .map((u) => u.id),
    );
    const list = caps.map((c) => {
      const units = r.units.filter((u) => c.unitIds.includes(u.id));
      const done = units.every((u) => doneIds.has(u.id));
      return { ...c, units, done };
    });
    const done = list.filter((c) => c.done).length;
    return {
      caps: list,
      done,
      total: list.length,
      blocked: list.filter((c) => !c.done).map((c) => c.name),
    };
  };
  P.invalidate = (r, stage) => {
    r.stage = D.STAGES[Math.min(P.index(r.stage), P.index(stage))].id;
    r.closed = false;
    r.accept = null;
    r.tests = [];
    for (const st of D.STAGES)
      if (P.index(st.id) > P.index(stage)) P.latest(r, st.id).stale = true;
    if (r.release && r.release.status !== 'SUCCEEDED')
      r.release.status = 'STALE';
  };
  P.newVersion = (r, stage, fields) => {
    P.write();
    const prev = P.latest(r, stage),
      number = prev.version + 1;
    const v = {
      ...clone(prev),
      id: `${r.id}-${stage}-v${number}`,
      version: number,
      fields: clone(fields),
      confirmed: false,
      review: '待评审',
      comments: [],
      createdAt: new Date(P.now()).toISOString(),
    };
    r.artifacts[stage].push(v);
    P.invalidate(r, stage);
    P.log(r, '产物新版本', v.id);
    return v;
  };
  P.confirmVersion = (r, stage, id) => {
    P.write();
    const v = P.latest(r, stage);
    P.assert(v.id === id, '版本已更新，请比较最新内容。');
    P.assert(!r.impact, '先处理材料变更影响。');
    if (stage === 'idea')
      P.assert(
        r.questions.every((x) => x.answer.trim()),
        '先回答全部澄清问题。',
      );
    v.confirmed = true;
    v.stale = false;
    v.review = '通过';
    v.confirmedAt = new Date(P.now()).toISOString();
    P.log(r, '产物确认', v.id);
  };
  P.advance = (r) => {
    P.write();
    P.current(r);
    const b = P.blockers(r);
    P.assert(!b.length, b.join('；'));
    P.assert(P.index(r.stage) < 6, '请使用当前阶段的发布或复盘操作。');
    const old = r.stage;
    r.stage = D.STAGES[P.index(old) + 1].id;
    P.s.ui.stage = r.stage;
    P.log(r, '门禁通过', P.gates[old] + ' → ' + P.stageName(r.stage));
  };
  P.startRun = (r, parentId = null) => {
    P.write();
    P.current(r);
    P.assert(r.stage === 'dev', '开发作业从开发阶段发起。');
    P.assert(!r.impact, '先处理材料变更。');
    P.assert(
      P.latest(r, 'design').confirmed && !P.latest(r, 'design').stale,
      '先确认当前基线的技术方案。',
    );
    P.assert(
      P.s.bridges.some((b) => b.status === 'ONLINE'),
      'Bridge 离线，请到治理中心连接本地电脑。',
    );
    P.assert(
      !r.runs.some((x) =>
        [
          'RUNNING',
          'QUEUED',
          'WAITING_INPUT',
          'WAITING_APPROVAL',
          'CANCELLING',
          'UNKNOWN',
          'VERIFYING',
        ].includes(x.status),
      ),
      '已有未结束作业，请先处理或核验。',
    );
    const caps = P.effective(r);
    P.assert(
      caps.some((c) => c.id === 'codex') &&
        caps.some((c) => c.id === 'code-impl'),
      '本阶段需要启用 Codex 与代码实现能力。',
    );
    const active = Object.values(P.s.reqs)
      .flatMap((x) => x.runs)
      .filter((x) => x.status === 'RUNNING').length;
    const budget = 8000 + (++P.s.seq % 7) * 500;
    const git = P.gitMeta(r, P.s.seq);
    const device = P.s.bridges.find((b) => b.status === 'ONLINE');
    const run = {
      id: 'R-' + ++P.s.seq,
      parentId,
      status: active >= 3 ? 'QUEUED' : 'RUNNING',
      pct: 0,
      step: 0,
      operation: '开发实现',
      controller: 'Web',
      /* 多设备控制租约：作业绑定执行设备，控制端可切换；断连/撤销使租约失效 */
      lease: {
        controller: 'Web',
        deviceId: device?.id || null,
        deviceName: device?.name || '未绑定',
        since: new Date(P.now()).toISOString(),
        expiresAt: P.now() + 60 * 60000,
        state: device ? 'active' : 'lost',
      },
      /* 计划审批硬门：批准人与时间留痕；未批准不得进入执行态 */
      planApproved: {
        by: P.s.team.name,
        at: new Date(P.now()).toISOString(),
        plan: '拆解：1) 读取项目结构与目标文件 2) 按方案实现改动并运行测试 3) 格式化、构建并汇总差异供验收',
      },
      /* 客观质量门：lint/单测/覆盖率/构建/安全扫描，进阶段门 */
      qualityGates: [
        { id: 'lint', name: 'Lint / 静态检查', status: '待执行' },
        { id: 'unit', name: '单元测试', status: '待执行' },
        { id: 'coverage', name: '覆盖率 ≥ 80%', status: '待执行' },
        { id: 'build', name: '构建', status: '待执行' },
        { id: 'security', name: '安全扫描', status: '待执行' },
      ],
      /* 沙箱快照回放：执行过程分步快照，可回放与审计 */
      replay: [
        { at: 0, label: '绑定 Bridge 与工作区', files: ['.', 'git status'] },
        { at: 1, label: '读取目标文件', files: ['src/notify.ts'] },
        { at: 2, label: '实现改动', files: ['src/notify.ts', 'src/rule.ts'] },
        { at: 3, label: '运行测试', files: ['tests/notify.test.ts'] },
        { at: 4, label: '格式化与构建', files: ['dist/'] },
      ],
      scope: '项目文件、Git 只读、格式化、测试、构建、本地预览；网络关闭',
      snapshot: caps.map((c) => ({ id: c.id, name: c.name, version: c.ver })),
      stamp: P.stamp(r),
      git,
      budget,
      queuePos: active + 1,
      limit: 3,
      lines: [
        {
          cls: 'info',
          text:
            '[bridge] 已绑定 ' +
            r.id +
            ' · ' +
            r.workspace +
            ' · ' +
            git.branch +
            ' · ' +
            git.commit +
            (git.dirty ? ' · 工作区有未提交变更' : ' · 工作区干净'),
        },
      ],
      verified: true,
      exitCode: null,
      preview: false,
      scopeId: 'SCOPE-' + ++P.s.seq,
      files: [],
    };
    r.runs.push(run);
    P.s.ui.runId = run.id;
    P.s.ui.panel = 'terminal';
    P.log(r, '执行范围已确认', run.id + ' · ' + run.scope);
    return run;
  };
  P.runControl = (r, action) => {
    P.write();
    const run = P.run(r);
    P.assert(run, '没有关联作业');
    if (action === 'cancel') {
      P.assert(
        ['RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'QUEUED'].includes(
          run.status,
        ),
        '当前状态不能取消',
      );
      run.status = 'CANCELLING';
      run.verified = false;
    }
    if (action === 'verify') {
      P.assert(
        ['UNKNOWN', 'CANCELLED', 'FAILED'].includes(run.status),
        '当前状态无需核验',
      );
      P.assert(
        P.s.bridges.some((b) => b.status === 'ONLINE'),
        '请先恢复 Bridge 连接',
      );
      run.verificationResult ||= run.status;
      run.status = 'VERIFYING';
    }
    if (action === 'retry') {
      P.assert(
        ['CANCELLED', 'FAILED'].includes(run.status) && run.verified,
        '先核验旧作业，再创建新尝试',
      );
      P.startRun(r, run.id);
    }
    if (action === 'handoff') {
      P.assert(
        ['RUNNING', 'WAITING_INPUT'].includes(run.status),
        '当前作业不需要交接',
      );
      run.controller = run.controller === 'Web' ? 'Zed' : 'Web';
      if (run.lease) {
        run.lease.controller = run.controller;
        run.lease.changedAt = new Date(P.now()).toISOString();
      }
    }
    if (action === 'input') {
      P.assert(run.status === 'WAITING_INPUT', '当前不在等待输入');
      run.status = 'RUNNING';
      run.lines.push({ cls: 'info', text: '已收到补充输入，继续同一作业' });
    }
    if (action === 'grant') {
      P.assert(run.status === 'WAITING_APPROVAL', '当前不在等待授权');
      run.status = 'RUNNING';
      run.scope += '；本次补充动作已授权';
    }
    P.log(r, '作业控制 ' + action, run.id);
  };
  P.completeRun = (r, run) => {
    run.pct = 100;
    run.step = 6;
    run.status = 'SUCCEEDED';
    run.exitCode = 0;
    run.verified = true;
    run.files = [
      {
        path: 'src/feature/service.ts',
        status: 'M',
        kind: 'code',
        lines: '+38 −12',
        before:
          'export async function handleExpiryNotify(userId: string) {\n  const plan = await loadPlan(userId);\n  if (!plan?.expiresAt) return;\n  const hours = diffHours(plan.expiresAt, new Date());\n  if (hours <= 24 && plan.notified) {\n    return;\n  }\n  await enqueueReminder(userId, { hours, once: true });\n}\n',
        preview:
          'export async function handleExpiryNotify(userId: string) {\n  const plan = await loadPlan(userId);\n  if (!plan?.expiresAt) return;\n  const hours = diffHours(plan.expiresAt, new Date());\n  if (hours <= 24 && !plan.notifiedAt) {\n    await enqueueReminder(userId, { hours });\n  }\n}\n',
      },
      {
        path: 'src/feature/expiry.test.ts',
        status: 'A',
        kind: 'test',
        lines: '+86 −0',
        before: '//（新增测试文件，无前置版本）',
        preview:
          "describe('expiry notify', () => {\n  it('enqueues reminder when within 24h', async () => {\n    const plan = buildPlan({ expiresAt: hoursFromNow(6) });\n    await handleExpiryNotify('u1');\n    expect(enqueueReminder).toHaveBeenCalledWith('u1', { hours: 6 });\n  });\n});\n",
      },
      {
        path: 'config/rules.json',
        status: 'M',
        kind: 'config',
        lines: '+5 −1',
        before:
          '{\n  "expiry": {\n    "leadHours": 24,\n    "channels": ["sms"],\n    "enabled": false\n  }\n}\n',
        preview:
          '{\n  "expiry": {\n    "leadHours": 24,\n    "channels": ["app_push", "sms"],\n    "enabled": true\n  }\n}\n',
      },
    ];
    P.log(r, '执行完成', run.id + ' · exit 0 · ' + run.stamp);
    if (run.stamp !== P.stamp(r)) return;
    r.units.forEach((u) => (u.status = '已实现'));
    const prev = P.latest(r, 'dev'),
      number = prev.version + 1;
    r.artifacts.dev.push({
      ...clone(prev),
      id: r.id + '-dev-v' + number,
      version: number,
      confirmed: false,
      stale: false,
      comments: [],
      fields: [
        { name: '来源作业', value: run.id + ' · ' + run.stamp },
        {
          name: '变更与范围',
          value:
            'src/feature/service.ts、测试及配置，共 3 个文件（演示）；仅本需求工作区',
        },
        {
          name: '工程验证',
          value: '单元测试 4 passed；构建完成；exit 0（模拟）',
        },
        {
          name: '提测交接',
          value: r.acs.map((a) => a.id + ' ' + a.text).join('\n'),
        },
        {
          name: '风险与回退',
          value: '迁移未应用；未连接真实外部系统。回退到原工作区基线。',
        },
      ],
    });
  };
  P.tick = () => {
    if (!P.canWrite()) return;
    let changed = false;
    for (const r of Object.values(P.s.reqs))
      for (const run of r.runs) {
        if (run._remote === true) continue;
        if (run.status === 'CANCELLING') {
          run.status = 'CANCELLED';
          run.preview = false;
          P.log(r, '取消已确认', run.id);
          changed = true;
          continue;
        }
        if (run.status === 'VERIFYING') {
          const observed = run.verificationResult;
          run.status = [
            'UNKNOWN',
            'RUNNING',
            'SUCCEEDED',
            'FAILED',
            'CANCELLED',
          ].includes(observed)
            ? observed
            : 'UNKNOWN';
          delete run.verificationResult;
          run.verified = run.status !== 'UNKNOWN';
          run.preview = false;
          run.exitCode = run.status === 'FAILED' ? 1 : null;
          if (run.status === 'SUCCEEDED') P.completeRun(r, run);
          run.lines.push({
            cls: 'info',
            text: '[bridge] 核验回传：' + P.labels[run.status] + '（演示）',
          });
          P.log(r, '执行核验', run.id + ' · ' + P.labels[run.status]);
          changed = true;
          continue;
        }
        if (
          run.status === 'QUEUED' &&
          Object.values(P.s.reqs)
            .flatMap((q) => q.runs)
            .filter((x) => x.status === 'RUNNING').length < 3
        ) {
          run.status = 'RUNNING';
          changed = true;
        }
        if (run.status !== 'RUNNING') continue;
        if (!P.s.bridges.some((b) => b.status === 'ONLINE')) {
          run.status = 'UNKNOWN';
          run.verified = false;
          if (run.lease) run.lease.state = 'lost';
          P.log(r, 'Bridge 断连', run.id + ' · 待核验');
          changed = true;
          continue;
        }
        run.pct = Math.min(100, run.pct + 8);
        run.spent = Math.min(run.budget || 8000, (run.spent || 0) + 500);
        if (run.spent >= (run.budget || 8000)) {
          run.status = 'FAILED';
          run.exitCode = 1;
          run.verified = false;
          run.lines.push({
            cls: 'error',
            text: '[budget] 预算 ' + Number(run.budget).toLocaleString() + ' 积分已耗尽，作业终止；请追加预算或缩减范围后重试',
          });
          P.log(r, '预算耗尽', run.id);
          changed = true;
          continue;
        }
        changed = true;
        const commands = [
          ['cmd', '$ git status --short'],
          ['info', '读取需求、方案和当前项目文件'],
          ['cmd', '写入 src/feature/service.ts 与测试文件（演示）'],
          ['cmd', '$ npm run test:unit  →  4 passed · exit 0'],
          ['cmd', '$ npm run build  →  build completed · exit 0'],
          ['ok', '$ git diff --stat  →  3 files changed；变更与证据已归档'],
        ];
        const next = Math.min(6, Math.floor(run.pct / 16));
        while (run.step < next) {
          const [cls, text] = commands[run.step++];
          run.lines.push({ cls, text });
        }
        if (run.pct === 100) P.completeRun(r, run);
      }
    if (changed) {
      P.save();
      P.render?.({ quiet: true });
    }
  };
  P.testRun = (r, fail = false) => {
    P.write();
    P.current(r);
    P.assert(r.stage === 'test', '从测试阶段执行');
    P.assert(P.hasCurrentSuccess(r), '没有当前基线的成功作业');
    const id = 'TEST-' + ++P.s.seq;
    const results = r.acs.map((a, i) => ({
      ...a,
      status: fail && i === 0 ? 'FAIL' : 'PASS',
      actual: fail && i === 0 ? '边界条件结果不符' : '预期与结果一致（演示）',
      runId: id,
    }));
    /* 保留每个测试批次，旧批次详情可追溯 */
    r.testRuns.push({
      id,
      at: new Date(P.now()).toISOString(),
      baseline: P.stamp(r),
      results,
    });
    r.testRuns = r.testRuns.slice(-20);
    r.tests = results;
    if (fail)
      r.defects.push({
        id: 'BUG-' + ++P.s.seq,
        ac: 'AC-01',
        title: '边界条件失败',
        status: 'OPEN',
        runId: id,
      });
    else
      r.defects.forEach((d) => {
        if (d.status === 'RESOLVED') d.status = 'CLOSED';
      });
    P.log(r, '测试执行', id + ' · ' + (fail ? 'FAIL' : 'PASS'));
  };
  P.deliveryContent = (r) =>
    clone({
      id: r.id,
      name: r.name,
      stage: r.stage,
      closed: r.closed,
      stamp: P.stamp(r),
      workspace: r.workspace,
      units: r.units,
      acs: r.acs,
      artifacts: Object.fromEntries(
        D.STAGES.map((st) => [st.id, P.latest(r, st.id)]),
      ),
      run: r.runs.at(-1) || null,
      testRun: r.testRuns.at(-1) || null,
      tests: r.tests,
      defects: r.defects,
      accept: r.accept,
      observation: r.observation,
      missing: P.blockers(r),
    });
  P.deliverySignature = (r, rel) =>
    JSON.stringify({
      artifacts: Object.fromEntries(
        D.STAGES.map((st) => [st.id, P.latest(r, st.id)]),
      ),
      run: r.runs.at(-1) || null,
      tests: r.tests,
      testRun: r.testRuns.at(-1) || null,
      defects: r.defects,
      accept: r.accept,
      units: r.units,
      acs: r.acs,
      target: rel.target,
      scope: rel.scope,
      rollback: rel.rollback,
      hours: rel.hours,
    });
  P.requestRelease = (r, form) => {
    P.write();
    P.current(r);
    P.assert(
      r.stage === 'release' && r.accept?.status === 'ACCEPTED',
      '先完成产品验收',
    );
    P.assert(
      form.scope.trim() && form.rollback.trim(),
      '填写发布范围与回滚步骤',
    );
    P.assert(
      Number(form.hours) >= 1 && Number(form.hours) <= 168,
      '观察窗口为 1–168 小时',
    );
    if (r.release) r.releaseHistory.push(clone(r.release));
    r.release = {
      id: 'REL-' + ++P.s.seq,
      status: 'PENDING',
      target: form.target,
      scope: form.scope,
      rollback: form.rollback,
      hours: Number(form.hours),
      stamp: P.stamp(r),
      expiresAt: P.now() + 30 * 60000,
      actor: null,
      snapshot: null,
    };
    P.log(r, '申请发布审批', r.release.id);
  };
  P.releaseAction = (r, action) => {
    P.write();
    P.current(r);
    const rel = r.release;
    P.assert(rel, '先填写发布准备');
    if (['approve', 'execute'].includes(action)) {
      P.assert(rel.stamp === P.stamp(r), '版本基线已变化，请重新申请审批');
      P.assert(rel.expiresAt > P.now(), '审批已过期，请重新申请');
      P.assert(r.accept?.status === 'ACCEPTED', '缺少当前产品验收');
    }
    if (action === 'approve') {
      P.assert(rel.status === 'PENDING', '审批状态已变化');
      rel.status = 'APPROVED';
      rel.actor = '陈立';
      /* 冻结发布快照：审批时刻的产物版本、作业、测试、验收与目标环境 */
      rel.snapshot = {
        stamp: P.stamp(r),
        artifacts: Object.fromEntries(
          D.STAGES.map((st) => [st.id, P.latest(r, st.id).id]),
        ),
        runId: r.runs.at(-1)?.id || null,
        testRunId: r.testRuns.at(-1)?.id || r.tests[0]?.runId || null,
        acceptId: r.accept?.id || rel.id + '-accept',
        content: P.deliveryContent(r),
        signature: P.deliverySignature(r, rel),
        release: clone({
          id: rel.id,
          status: rel.status,
          target: rel.target,
          scope: rel.scope,
          rollback: rel.rollback,
          hours: rel.hours,
        }),
        target: rel.target,
        frozenAt: new Date(P.now()).toISOString(),
      };
    }
    if (action === 'reject') {
      P.assert(rel.status === 'PENDING', '审批状态已变化');
      rel.status = 'REJECTED';
    }
    if (action === 'execute') {
      P.assert(rel.status === 'APPROVED', '先批准准确发布范围');
      P.assert(
        rel.snapshot &&
          rel.snapshot.stamp === P.stamp(r) &&
          rel.snapshot.signature === P.deliverySignature(r, rel),
        '审批后产物或基线已变化，原审批失效；请重新申请发布审批',
      );
      rel.status = P.s.failRelease ? 'FAILED' : 'SUCCEEDED';
      P.s.failRelease = false;
      if (rel.status === 'SUCCEEDED') {
        r.stage = 'observe';
        P.s.ui.stage = 'observe';
        r.observation = {
          startedAt: P.now(),
          hours: rel.hours,
          metrics: '',
          conclusion: '',
          entries: [],
          anomaly: null,
          followups: [],
          releaseSnapshot: rel.snapshot,
        };
      }
    }
    if (action === 'rollback') {
      P.assert(
        ['FAILED', 'SUCCEEDED'].includes(rel.status),
        '当前没有可回滚的发布',
      );
      rel.status = 'ROLLED_BACK';
      r.stage = 'release';
      P.s.ui.stage = 'release';
      if (r.observation)
        r.observation.anomaly = {
          at: new Date(P.now()).toISOString(),
          reason: '观察异常，执行回滚',
          releaseStamp: rel.stamp,
        };
      r.observation = null;
    }
    P.log(r, '发布 ' + action, rel.id + ' · ' + rel.status);
  };
  P.reset = () => {
    STORE().removeItem(P.KEY);
    P.storageBase = null;
    P.s = P.factory();
    for (const r of Object.values(P.s.reqs))
      for (const run of r.runs) run.stamp = P.stamp(r);
    P.conflict = false;
    P.save();
  };
  window.addEventListener('storage', (e) => {
    if (e.key === P.KEY && !e.newValue) {
      P.conflict = true;
      P.render?.({ quiet: true });
    }
    if (e.key === P.KEY && e.newValue) {
      try {
        const next = JSON.parse(e.newValue);
        if (next.revision !== P.s.revision) {
          P.conflict = true;
          P.render?.({ quiet: true });
        }
      } catch {
        P.conflict = true;
      }
    }
  });
})();
