(() => {
  'use strict';
  const D = window.PFCDATA,
    clone = (v) => JSON.parse(JSON.stringify(v));
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
      capId: id + '-CAP-01',
      units: [
        { id: id + '-U01', name: '规则与数据处理', status: '待开始' },
        { id: id + '-U02', name: '交互与结果回传', status: '待开始' },
      ],
      acs: [
        { id: 'AC-01', text: '规则命中时生成任务，边界条件正确' },
        { id: 'AC-02', text: '关闭开关后停止触达，结果可追踪' },
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
      defects: [],
      accept: null,
      release: null,
      releaseHistory: [],
      observation: null,
      impact: null,
    };
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
        version(id, st.id, fields, P.index(st.id) < P.index(stage)),
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
    if (P.index(stage) >= 6)
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
      audit: [],
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
  P.hasCurrentSuccess = (r) =>
    r.runs.some(
      (x) =>
        x.status === 'SUCCEEDED' &&
        x.stamp === P.stamp(r) &&
        !r.rejectedRunIds?.includes(x.id),
    );
  P.now = () => Date.now() + P.s.clockOffset;
  try {
    const stored = localStorage.getItem(P.KEY);
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
  P.run = (r) => r.runs.find((x) => x.id === P.s.ui.runId) || r.runs.at(-1);
  P.save = () => {
    try {
      P.s.revision++;
      localStorage.setItem(P.KEY, JSON.stringify(P.s));
      P.storageError = false;
    } catch {
      P.storageError = true;
    }
  };
  P.assert = (ok, msg) => {
    if (!ok) throw Error(msg);
  };
  P.canWrite = () => P.s.role !== 'viewer' && !P.conflict;
  P.write = () => {
    P.assert(
      P.s.role !== 'viewer',
      '只读成员可以查看，修改需负责人或执行者权限。',
    );
    P.assert(
      !P.conflict,
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
    const run = {
      id: 'R-' + ++P.s.seq,
      parentId,
      status:
        Object.values(P.s.reqs)
          .flatMap((x) => x.runs)
          .filter((x) => x.status === 'RUNNING').length >= 3
          ? 'QUEUED'
          : 'RUNNING',
      pct: 0,
      step: 0,
      operation: '开发实现',
      controller: 'Web',
      scope: '项目文件、Git 只读、格式化、测试、构建、本地预览；网络关闭',
      snapshot: caps.map((c) => ({ id: c.id, name: c.name, version: c.ver })),
      stamp: P.stamp(r),
      lines: [
        {
          cls: 'info',
          text: '[bridge] 已绑定 ' + r.id + ' · ' + r.workspace + '（演示）',
        },
      ],
      verified: true,
      exitCode: null,
      preview: false,
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
    if (P.conflict) return;
    let changed = false;
    for (const r of Object.values(P.s.reqs))
      for (const run of r.runs) {
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
          P.log(r, 'Bridge 断连', run.id + ' · 待核验');
          changed = true;
          continue;
        }
        run.pct = Math.min(100, run.pct + 8);
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
    r.tests = r.acs.map((a, i) => ({
      ...a,
      status: fail && i === 0 ? 'FAIL' : 'PASS',
      actual: fail && i === 0 ? '边界条件结果不符' : '预期与结果一致（演示）',
      runId: id,
    }));
    if (fail)
      r.defects.push({
        id: 'BUG-' + ++P.s.seq,
        ac: 'AC-01',
        title: '边界条件失败',
        status: 'OPEN',
      });
    else
      r.defects.forEach((d) => {
        if (d.status === 'RESOLVED') d.status = 'CLOSED';
      });
    P.log(r, '测试执行', id + ' · ' + (fail ? 'FAIL' : 'PASS'));
  };
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
    }
    if (action === 'reject') {
      P.assert(rel.status === 'PENDING', '审批状态已变化');
      rel.status = 'REJECTED';
    }
    if (action === 'execute') {
      P.assert(rel.status === 'APPROVED', '先批准准确发布范围');
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
      r.observation = null;
    }
    P.log(r, '发布 ' + action, rel.id + ' · ' + rel.status);
  };
  P.reset = () => {
    localStorage.removeItem(P.KEY);
    P.s = P.factory();
    for (const r of Object.values(P.s.reqs))
      for (const run of r.runs) run.stamp = P.stamp(r);
    P.conflict = false;
    P.save();
  };
  window.addEventListener('storage', (e) => {
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
