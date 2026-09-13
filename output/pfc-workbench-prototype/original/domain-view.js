(() => {
  'use strict';
  const P = window.PFC,
    api = () => window.PFCAPI.api;
  const V = (P.domainView = { pg: () => !!api().pg });
  let generation = 0;
  const messageReads = new Map();
  if (window.PFCStore?.mode === 'api') P.remoteLoading = true;
  V.empty = () => ({
    schema: 1,
    seq: 0,
    revision: 0,
    clockOffset: 0,
    role: api().user?.role || 'viewer',
    reqs: {},
    caps: [],
    enabled: [],
    bindings: {},
    knowledge: [],
    audit: [],
    notices: [],
    plugins: [],
    projects: [],
    team: { name: api().user?.name || '本地工作台', members: [] },
    bridges: [],
    ui: {
      route: 'home',
      req: '',
      stage: 'idea',
      panel: 'canvas',
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
  });
  const prefKey = () =>
    `pfc.pg.preferences:${api().base()}:${api().user?.name || ''}`;
  V.savePreferences = () => {
    try {
      localStorage.setItem(
        prefKey(),
        JSON.stringify({ ui: { ...P.s.ui, pending: {} }, at: Date.now() }),
      );
      return true;
    } catch {
      P.storageError = true;
      return false;
    }
  };
  V.reset = () => {
    generation++;
    messageReads.clear();
    P.s = V.empty();
    P.conflict = false;
    P.storageBase = null;
    P.loadNotice = null;
    try {
      const saved = JSON.parse(localStorage.getItem(prefKey()) || 'null');
      if (saved?.ui) Object.assign(P.s.ui, saved.ui, { pending: {} });
    } catch {
      /* Ignore invalid view preferences only. */
    }
  };
  V.clear = () => {
    localStorage.removeItem(prefKey());
    api().setToken('');
    window.PFCWS?.disconnect();
    generation++;
    P.s = V.empty();
    P.remoteLoading = false;
    P.remoteError = '已退出，请重新登录';
    P.render();
  };
  V.map = (remote) => {
    const prior = P.s.reqs[remote.id];
    if (prior && prior.revision > remote.revision) return prior;
    const artifacts = Object.fromEntries(P.D.STAGES.map((s) => [s.id, []]));
    for (const v of remote.versions || [])
      artifacts[v.stage].push({
        ...v.content,
        _serverId: v.id,
        confirmed: !!v.confirmedAt,
        confirmedAt: v.confirmedAt,
        confirmedBy: v.confirmedBy,
        stale: v.stale,
        review: v.review,
      });
    const materials = (remote.materials || []).filter(
      (m) => m.usage !== 'attachment',
    );
    const attachments = (remote.materials || [])
      .filter((m) => m.usage === 'attachment')
      .map((m) => V.attachment(m, remote.id));
    const req = {
      ...remote,
      _pg: true,
      baseline: remote.materialRevision,
      workspace: remote.project?.name || '未关联项目',
      capId: null,
      units: [],
      acs: [],
      caps: [], // 工具能力不是产品 CAP，不进入产品完成度统计。
      artifacts,
      materials,
      attachments,
      questions: (remote.questions || []).map((q) => ({ ...q, text: q.q })),
      messages: prior?.messages || [],
      messagePageOffset: prior?.messagePageOffset ?? null,
      messageOffset: prior?.messageOffset ?? 0,
      messageTotal: prior?.messageTotal ?? 0,
      runs: prior?.runs || [],
      overrides: {
        [remote.stage]: Object.fromEntries(
          (remote.overrides || []).map((o) => [o.capId, o.enabled]),
        ),
      },
      timeline: remote.audit || [],
      tests: [],
      testRuns: [],
      defects: [],
      accept: null,
      release: null,
      releaseHistory: [],
      observation: null,
      impactList: (remote.materials || [])
        .filter((m) => m.status === '待确认影响')
        .map((m) => m.id),
      contextRefs: [],
      knowledgeRefs: remote.knowledgeRefs || [],
    };
    req.impact = req.impactList[0] || null;
    P.s.reqs[req.id] = req;
    P.s.seq = Math.max(P.s.seq, Number(req.id.split('-').at(-1)) || 0);
    return req;
  };
  V.attachment = (m, reqId) => ({
    ...m,
    requirementId: reqId,
    bytes: m.size,
    size: Math.ceil(m.size / 1024) + ' KB',
    status: 'ready',
    type: /^image\//.test(m.mimeType) ? 'image' : 'text',
    content: m.content || m.parseStatus,
    fullContent: m.content || '',
    origin: 'server',
    _pg: true,
    materialStatus: m.status,
    meta: { origin: 'server', parsed: !!m.content },
    digest: m.hash,
  });
  V.readMessages = async (id) => {
    const epoch = generation;
    const readId = (messageReads.get(id) || 0) + 1;
    messageReads.set(id, readId);
    const overview = await api().req(
      'GET',
      '/api/reqs/' + id + '/messages?limit=1',
    );
    if (
      epoch !== generation ||
      !P.s.reqs[id] ||
      messageReads.get(id) !== readId
    )
      return;
    const offset =
      P.s.reqs[id].messagePageOffset ?? Math.max(0, overview.total - 100);
    const { items, total } = await api().req(
      'GET',
      '/api/reqs/' + id + '/messages?offset=' + offset + '&limit=100',
    );
    if (
      epoch !== generation ||
      !P.s.reqs[id] ||
      messageReads.get(id) !== readId
    )
      return;
    const q = P.s.reqs[id];
    q.messageTotal = total;
    q.messageOffset = offset;
    q.messages = items.map((incoming) => {
      const old = q.messages.find((m) => m.id === incoming.id),
        m = old?.revision > incoming.revision ? old : incoming;
      return {
        ...m,
        attachments: (m.attachments || []).map(
          (a) =>
            q.attachments.find(
              (x) => x.id === a.id && x.version === a.version,
            ) ||
            V.attachment(
              {
                ...a,
                name: a.name || a.label,
                status: '已纳入',
                parseStatus: '读取服务器历史原件',
              },
              id,
            ),
        ),
        refs: (m.refs || []).map((ref) => {
          const v = q.artifacts[ref.stage]?.find((v) => v._serverId === ref.id);
          return v ? { ...ref, id: v.id, serverId: ref.id } : ref;
        }),
      };
    });
  };
  V.read = async (id) => {
    const epoch = generation,
      { req } = await api().req('GET', '/api/reqs/' + encodeURIComponent(id));
    if (epoch !== generation) return;
    V.map(req);
    await V.readMessages(id);
    return P.s.reqs[id];
  };
  V.sync = async () => {
    await P.governanceDomain?.sync();
    const epoch = generation,
      { items } = await api().req('GET', '/api/reqs');
    for (const item of items) await V.read(item.id);
    if (epoch !== generation) return;
    const ids = new Set(items.map((i) => i.id));
    for (const id of Object.keys(P.s.reqs))
      if (!ids.has(id)) delete P.s.reqs[id];
    const notices = await api().req('GET', '/api/notices');
    P.s.notices = notices.items.map((n) => ({
      ...n,
      title: n.text,
      kind: n.level,
      req: n.reqId,
    }));
    if (!P.s.reqs[P.s.ui.req]) {
      P.s.ui.req = items[0]?.id || '';
      P.s.ui.stage = items[0]?.stage || 'idea';
    }
    await P.domain.syncRuns();
    P.remoteLoading = false;
    P.remoteError = null;
    P.render();
  };
  V.loadingView = () => {
    if (P.remoteLoading)
      return '<main class="page"><div class="empty-state" role="status">正在连接服务端并读取存储模式…</div></main>';
    if (P.remoteError)
      return `<main class="page"><div class="empty-state" role="alert">${P.esc(P.remoteError)}<p>输入已保留，可重试读取服务端。</p>${P.btn('pg-reload', '重试连接')}</div></main>`;
    if (
      V.pg() &&
      P.s.ui.route === 'work' &&
      P.index(P.s.ui.stage) >
        (P.releaseClient?.enabled()
          ? 7
          : P.verificationClient?.enabled()
            ? 6
            : 3)
    )
      return `<main class="page"><div class="empty-state">${P.esc(api().capabilities.unsupportedReason)}${P.btn('open-work', '返回当前需求', { stage: P.r()?.stage || 'idea' })}</div></main>`;
    return '';
  };
})();
