(() => {
  'use strict';
  const P = window.PFC,
    api = () => window.PFCAPI.api;
  const G = (P.governanceDomain = {
    pages: {},
    bindings: [],
    budget: null,
    error: null,
    loading: false,
  });
  const paths = {
    catalog: 'caps',
    team: 'members',
    workspace: 'projects',
    knowledge: 'knowledge',
    audit: 'audit',
  };
  const prefs = () => (P.s.ui.governance ??= { filters: {}, drafts: {} });
  G.filter = (tab) => prefs().filters[tab] || { q: '', offset: 0 };
  G.query = (tab) => {
    const f = G.filter(tab),
      p = new URLSearchParams({ limit: '20', offset: String(f.offset || 0) });
    for (const k of ['q', 'type', 'actor', 'action']) if (f[k]) p.set(k, f[k]);
    return p;
  };
  G.page = async (tab, defer = false) => {
    if (!paths[tab] || (tab === 'audit' && P.s.role !== 'owner')) return;
    const query = G.query(tab).toString(),
      result = await api().req('GET', '/api/' + paths[tab] + '?' + query);
    if (query !== G.query(tab).toString()) return;
    if (!defer) G.applyPage(tab, result);
    return { query, result };
  };
  G.applyPage = (tab, result) => {
    G.pages[tab] = result;
    if (tab === 'catalog') {
      P.s.caps = result.items;
      P.s.enabled = result.items.filter((c) => c.enabled).map((c) => c.id);
    }
    if (tab === 'team') P.s.team.members = result.items;
    if (tab === 'workspace') P.s.projects = result.items;
    if (tab === 'knowledge') P.s.knowledge = result.items;
    if (tab === 'audit') P.s.audit = result.items;
  };
  G.identity = async () => {
    try {
      const { user } = await api().req('GET', '/api/auth/me');
      api().user = user;
      P.s.role = user.role;
      G.denied = false;
      if (user.role !== 'owner') {
        G.pages.audit = null;
        P.s.audit = [];
      }
      return user;
    } catch (error) {
      if ([401, 403].includes(error.status)) {
        G.denied = true;
        P.s.role = 'viewer';
        G.pages.audit = null;
        P.s.audit = [];
      }
      throw error;
    }
  };
  let refreshing;
  G.sync = async (force = false) => {
    if (force && refreshing) await refreshing;
    return (refreshing ??= (async () => {
      G.loading = true;
      try {
        await G.identity();
        const pages = [];
        for (const tab of Object.keys(paths))
          pages.push([tab, await G.page(tab, true)]);
        const bindings = (await api().req('GET', '/api/bindings')).items;
        const budget = (await api().req('GET', '/api/budgets/me')).budget;
        for (const [tab, value] of pages)
          if (
            value &&
            value.query === G.query(tab).toString() &&
            (tab !== 'audit' || P.s.role === 'owner')
          )
            G.applyPage(tab, value.result);
        G.bindings = bindings;
        P.s.bindings = Object.fromEntries(
          G.bindings.map((b) => [b.stage, b.capIds]),
        );
        G.budget = budget;
        G.error = null;
      } catch (error) {
        G.error = error.message;
        throw error;
      } finally {
        G.loading = false;
        refreshing = null;
      }
    })());
  };
  G.refresh = async () => {
    try {
      await G.sync(true);
      if (P.r()) await P.domainView.read(P.r().id);
      P.save();
    } finally {
      P.render({ quiet: true });
    }
  };
  G.save = async (method, path, input, { close = true, reqId = null } = {}) => {
    P.write();
    const key = G.formKey;
    if (key && document.querySelector('#modal-root form')) {
      prefs().drafts[key] = P.form();
      P.save();
    }
    const commands = (prefs().commands ??= {}),
      serialized = JSON.stringify(input),
      prior = commands[path];
    const commandId =
      prior?.serialized === serialized ? prior.commandId : crypto.randomUUID();
    commands[path] = { serialized, commandId };
    P.save();
    let result;
    try {
      result = await P.domainActions.command(method, path, {
        ...input,
        commandId,
      });
    } catch (error) {
      if (error.status && error.status < 500) {
        delete commands[path];
        P.save();
      }
      throw error;
    }
    await G.sync(true);
    if (reqId) await P.domainView.read(reqId);
    if (key) delete prefs().drafts[key];
    delete commands[path];
    if (close) P.close();
    P.save();
    P.render({ quiet: true });
    return result;
  };
  G.open = (key, title, body, footer) => {
    P.modal(
      title,
      '<form>' + body + '</form>',
      footer + P.btn('close-modal', '取消'),
    );
    G.formKey = key;
    const draft = prefs().drafts[key];
    if (draft)
      for (const el of document.querySelectorAll('#modal-root [name]'))
        if (Object.hasOwn(draft, el.name)) el.value = draft[el.name];
  };
  const roles = [
    ['owner', '负责人'],
    ['executor', '执行者'],
    ['viewer', '只读成员'],
  ];
  const member = (d) =>
    P.s.team.members.find((m) => m.id === d.id || m.name === d.name);
  const cap = (id) => P.s.caps.find((c) => c.id === id);
  const split = (s) =>
    (s || '')
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
  G.actions = {
    'gov-refresh': () => G.refresh(),
    'gov-tab': async (d) => {
      P.go({ govTab: d.tab });
      await G.refresh();
    },
    'gov-kind-tab': async (d) => {
      P.go({ govKind: d.kind, govQ: '' });
      await G.refresh();
    },
    'gov-page': async (d) => {
      prefs().filters[d.tab] = { ...G.filter(d.tab), offset: Number(d.offset) };
      await G.page(d.tab);
      P.save();
      P.render();
    },
    'gov-filter': async (d) => {
      const f = Object.fromEntries(
        new FormData(document.querySelector('#gov-filter')),
      );
      prefs().filters[d.tab] = { ...f, offset: 0 };
      await G.page(d.tab);
      P.save();
      P.render();
    },
    'register-cap': () =>
      G.open(
        'cap',
        '登记新能力',
        P.field('name', '名称') +
          P.select(
            'type',
            '类型',
            [
              ['Skill', 'Skill'],
              ['MCP', 'MCP'],
              ['ACP', 'ACP'],
              ['终端工具', '终端工具'],
            ],
            'Skill',
          ) +
          P.field(
            'endpoint',
            '连接地址 / 命令',
            '',
            'text',
            '仅登记描述，不执行；请勿填入凭据',
          ) +
          P.field('src', '来源') +
          P.field('ver', '版本') +
          P.field('desc', '描述', '', 'textarea'),
        P.btn('save-cap', '登记，等待复核', {}, 'primary'),
      ),
    'save-cap': () => G.save('POST', '/api/caps', P.form()),
    'review-cap': (d) =>
      G.save('POST', '/api/caps/' + d.id + '/review', {
        expectedRevision: cap(d.id).revision,
      }),
    'toggle-cap': (d) =>
      G.save('PATCH', '/api/caps/' + d.id + '/toggle', {
        enabled: !cap(d.id).enabled,
        expectedRevision: cap(d.id).revision,
      }),
    'cap-detail': (d) => {
      const c = cap(d.id);
      P.modal(
        c.name,
        P.table(
          ['字段', '值'],
          Object.entries(c).map(([k, v]) => [
            P.esc(k),
            P.esc(String(v ?? '—')),
          ]),
        ),
        P.btn('close-modal', '关闭'),
      );
    },
    'toggle-binding': async (d) => {
      const binding = G.bindings.find((b) => b.stage === d.stage);
      const capIds = binding.capIds.includes(d.id)
        ? binding.capIds.filter((id) => id !== d.id)
        : [...binding.capIds, d.id];
      await G.save('PUT', '/api/bindings', {
        stage: d.stage,
        capIds,
        expectedRevision: binding.revision,
      });
    },
    'add-member': () =>
      G.open(
        'member',
        '登记团队成员',
        P.field(
          'name',
          '已配置的本地账号名称',
          '',
          'text',
          '仅支持管理员允许名单中的账号',
        ) + P.select('role', '角色', roles, 'viewer'),
        P.btn('save-member', '登记', {}, 'primary'),
      ),
    'save-member': () => G.save('POST', '/api/members', P.form()),
    'edit-member': (d) => {
      const m = member(d);
      G.editMember = { id: m.id, revision: m.revision };
      G.open(
        'member:' + m.id,
        '修改成员角色',
        `<p>${P.esc(m.name)} · ${P.esc(m.id)}</p>` +
          P.select('role', '角色', roles, m.role),
        P.btn('save-member-role', '保存角色', {}, 'primary'),
      );
    },
    'save-member-role': () =>
      G.save('PATCH', '/api/members/' + G.editMember.id + '/role', {
        role: P.form().role,
        expectedRevision: G.editMember.revision,
      }),
    'remove-member': (d) => {
      const m = member(d);
      G.editMember = { id: m.id, revision: m.revision };
      G.open(
        'disable:' + m.id,
        '停用成员',
        `<p>停用 ${P.esc(m.name)} 后，旧登录与新操作都会受限，历史记录保留。</p>`,
        P.btn('gov-disable-member', '确认停用', {}, 'danger'),
      );
    },
    'gov-disable-member': () =>
      G.save('DELETE', '/api/members/' + G.editMember.id, {
        expectedRevision: G.editMember.revision,
      }),
    'load-project': () =>
      G.open(
        'project',
        '登记项目',
        P.field('p-name', '项目名称') +
          P.field(
            'p-path',
            '项目路径',
            '',
            'text',
            '已登记的路径不会被扫描或执行',
          ) +
          P.field('p-repo', 'Git 仓库', '', 'text', '可空，不包含凭据') +
          P.field('p-branch', '分支', 'main') +
          P.field('p-tech', '技术栈', '', 'text', '逗号分隔') +
          P.select(
            'p-source',
            '来源',
            [
              ['existing', '现有系统'],
              ['new', '新项目'],
            ],
            'existing',
          ),
        P.btn('save-project', '登记项目', {}, 'primary'),
      ),
    'save-project': async () => {
      const f = P.form();
      await G.save('POST', '/api/projects', {
        name: f['p-name'],
        path: f['p-path'],
        repo: f['p-repo'],
        branch: f['p-branch'],
        tech: split(f['p-tech']),
        source: f['p-source'],
      });
    },
    'attach-project': async () => {
      await G.page('workspace');
      const q = P.r();
      G.projectTarget = { id: q.id, revision: q.revision };
      G.open(
        'project-link:' + q.id,
        '关联项目',
        P.select(
          'projectId',
          '项目',
          [
            ['', '请选择'],
            ...P.s.projects.map((p) => [p.id, p.name + ' · ' + p.branch]),
          ],
          q.projectId || '',
        ) +
          '<p>更换项目会使旧产物待重新确认；活动作业需先处理。更多项目可在治理中心筛选。</p>',
        P.btn('pick-project', '保存关联', {}, 'primary'),
      );
    },
    'pick-project': () =>
      G.save(
        'PATCH',
        '/api/reqs/' + G.projectTarget.id + '/project',
        {
          projectId: P.form().projectId,
          expectedRevision: G.projectTarget.revision,
        },
        { reqId: G.projectTarget.id },
      ),
    'add-knowledge': () =>
      G.open(
        'knowledge',
        '登记知识条目',
        P.field('k-title', '标题') +
          P.select(
            'k-type',
            '类型',
            ['复盘结论', '组件规范', '接口契约', '踩坑记录', 'Playbook'].map(
              (t) => [t, t],
            ),
            '复盘结论',
          ) +
          P.field('k-content', '内容', '', 'textarea') +
          P.field(
            'k-tags',
            '标签',
            '',
            'text',
            '逗号分隔；创建需求时最多匹配三条',
          ),
        P.btn('save-knowledge', '存入知识库', {}, 'primary'),
      ),
    'save-knowledge': () => {
      const f = P.form();
      return G.save('POST', '/api/knowledge', {
        title: f['k-title'],
        type: f['k-type'],
        content: f['k-content'],
        tags: split(f['k-tags']),
      });
    },
    'gov-knowledge-detail': (d) => {
      const k = P.s.knowledge.find((k) => k.id === d.id);
      P.modal(
        k.title,
        `<p>${P.esc(k.id)} · v${k.version} · ${P.esc(k.tags.join('、'))}</p><div class="doc-body">${P.esc(k.content)}</div>`,
        P.btn('close-modal', '关闭'),
      );
    },
    'export-audit': async () => {
      const response = await fetch(
        api().base() + '/api/audit/export?' + G.query('audit'),
        { headers: api().authHeaders(), signal: AbortSignal.timeout(15000) },
      );
      if (!response.ok) {
        const body = await response.json();
        throw Error(body.error?.msg || '导出失败');
      }
      P.downloadBlob(await response.blob(), 'pfc-audit.csv', 'text/csv');
      P.toast('已准备审计文件，请查看浏览器下载');
      await G.refresh();
    },
    'session-caps': async () => {
      const q = P.r();
      G.session = await api().req(
        'GET',
        '/api/reqs/' + q.id + '/cap-overrides?stage=' + P.s.ui.stage,
      );
      G.session.reqId = q.id;
      G.showSession();
    },
    'toggle-session': async (d) => {
      const s = G.session,
        overrides = s.overrides.filter((o) => o.capId !== d.id);
      overrides.push({
        capId: d.id,
        enabled: !s.effectiveCaps.some((c) => c.id === d.id),
      });
      await G.save(
        'PUT',
        '/api/reqs/' + s.reqId + '/cap-overrides',
        { stage: s.stage, overrides, expectedRevision: s.revision },
        { close: false, reqId: s.reqId },
      );
      await G.actions['session-caps']();
    },
    'reset-session': async () => {
      const s = G.session;
      await G.save(
        'PUT',
        '/api/reqs/' + s.reqId + '/cap-overrides',
        { stage: s.stage, overrides: [], expectedRevision: s.revision },
        { close: false, reqId: s.reqId },
      );
      await G.actions['session-caps']();
    },
    'gov-plan-context': (d) => G.showPlan(d.id),
    'plan-run': async (d = {}) => {
      const q = P.r();
      P.write();
      const input = {
        reqId: q.id,
        plan: '模拟：读取当前输入，记录示例输出；不执行真实工具',
        parentId: d.parent || null,
        expectedRevision: q.revision,
      };
      const commands = (prefs().commands ??= {}),
        key = 'plan:' + q.id,
        serialized = JSON.stringify(input);
      const prior = commands[key],
        commandId =
          prior?.serialized === serialized
            ? prior.commandId
            : crypto.randomUUID();
      commands[key] = { serialized, commandId };
      P.save();
      let result;
      try {
        result = await P.domainActions.command('POST', '/api/runs', {
          ...input,
          commandId,
        });
      } catch (error) {
        if (error.status && error.status < 500) {
          delete commands[key];
          P.save();
        }
        throw error;
      }
      P.domain.merge(result, true);
      P.render();
      await G.showPlan(result.run.id);
      delete commands[key];
      P.save();
    },
  };
  G.showPlan = async (id) => {
    const result = await api().req('GET', '/api/runs/' + id);
    P.domain.merge(result, true);
    P.domainPlan = {
      runId: id,
      contextFingerprint: result.plan?.contextFingerprint,
    };
    G.planBundle = result;
    G.open(
      'plan:' + id,
      '作业输入与批准',
      G.snapshot(result.plan) +
        (result.plan?.snapshotVersion === 1
          ? '<p class="muted">历史计划仅供查看或取消。请基于当前关联成果和确认记录重新创建计划。</p>'
          : '') +
        P.field('reject-reason', '拒绝原因', '', 'textarea'),
      result.run.status === 'WAITING_APPROVAL' &&
        result.plan?.snapshotVersion === 2
        ? P.btn('reject-plan', '拒绝计划') +
            P.btn(
              'start-run',
              result.plan?.approvedAt ? '启动已批准计划' : '批准并执行模拟',
              {},
              'primary',
            )
        : '',
    );
  };
  G.submitPlan = async (reject = false) => {
    P.write();
    const intent = P.domainPlan;
    P.assert(intent?.runId, '先查看作业输入');
    const result = await api().req('GET', '/api/runs/' + intent.runId);
    P.assert(
      result.plan?.contextFingerprint === intent.contextFingerprint,
      '计划输入已变化，请重新查看',
    );
    let run = result.run;
    if (
      !reject &&
      [
        'RUNNING',
        'SUCCEEDED',
        'FAILED',
        'CANCELLED',
        'CANCELLING',
        'UNKNOWN',
      ].includes(run.status)
    ) {
      await P.domain.readRun(run.id, true);
      delete prefs().drafts['plan:' + run.id];
      P.save();
      P.close();
      P.toast('已回读同一作业：' + P.labels[run.status]);
      return;
    }
    if (reject) {
      const reason = P.form()['reject-reason'];
      P.assert(reason.trim(), '请填写拒绝原因');
      await P.domainActions.command(
        'POST',
        '/api/runs/' + run.id + '/plan-reject',
        { reason, expectedRevision: run.revision },
      );
    } else {
      if (!result.plan.approvedAt)
        run = (
          await P.domainActions.command(
            'POST',
            '/api/runs/' + run.id + '/plan-approve',
            { expectedRevision: run.revision },
          )
        ).run;
      await P.domainActions.command('POST', '/api/runs/' + run.id + '/start', {
        expectedRevision: run.revision,
      });
    }
    await P.domain.readRun(run.id, true);
    delete prefs().drafts['plan:' + run.id];
    P.save();
    P.close();
    P.domainPlan = null;
    P.toast(reject ? '计划已拒绝' : '模拟作业已启动');
  };
  G.install = (remote) => {
    const snapshot = G.snapshot;
    G.snapshot = (plan) =>
      snapshot(plan) +
      (plan?.contextSnapshot?.linkedArtifacts
        ? '<h3>已冻结的关联成果与确认</h3><pre>' +
          P.esc(JSON.stringify(plan.contextSnapshot.linkedArtifacts, null, 2)) +
          '</pre>'
        : '');
    const modal = P.modal;
    P.modal = (...args) => {
      G.formKey = null;
      return modal(...args);
    };
    Object.assign(remote, G.actions);
    P.domainActions.submitPlan = G.submitPlan;
    const merge = P.domain.merge;
    P.domain.merge = (data, select) => {
      const run = merge(data, select);
      if (P.domainView.pg() && run) run.contextPlan = data.plan;
      return run;
    };
    const effective = P.effective;
    P.effective = (r, stage) =>
      P.domainView.pg()
        ? r.capabilityContexts?.[stage]?.effectiveCaps ||
          (stage === r.stage ? r.effectiveCaps : []) ||
          []
        : effective(r, stage);
    const runCard = P.runCard;
    P.runCard = (r) =>
      runCard(r) + (P.domainView.pg() && P.run(r) ? G.planCard(P.run(r)) : '');
    document.addEventListener('input', (event) => {
      if (
        !P.domainView.pg() ||
        !G.formKey ||
        !event.target.closest('#modal-root form')
      )
        return;
      prefs().drafts[G.formKey] = P.form();
      P.save();
    });
  };
})();
