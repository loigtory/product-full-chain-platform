(() => {
  const P = window.PFC,
    { esc: e, btn: b, icon: i } = P,
    A = P.actions;
  const routes = new Set(['home', 'work', 'product', 'delivery', 'gov']);
  P.go = (patch) => {
    Object.assign(P.s.ui, patch);
    if (!P.s.reqs[P.s.ui.req]) P.s.ui.req = Object.keys(P.s.reqs)[0] || '';
    const u = P.s.ui;
    const q = new URLSearchParams();
    for (const k of [
      'req',
      'stage',
      'panel',
      'productTab',
      'govTab',
      'artifactStage',
      'version',
      'runId',
    ])
      if (u[k]) q.set(k, u[k]);
    const hash = '#/' + u.route + '?' + q;
    if (location.hash !== hash) history.pushState(null, '', hash);
    P.save();
    P.render();
  };
  function parse() {
    const [path, query = ''] = location.hash.slice(2).split('?');
    const route = routes.has(path) ? path : 'home';
    P.s.ui.route = route;
    const params = new URLSearchParams(query);
    for (const k of [
      'req',
      'stage',
      'panel',
      'productTab',
      'govTab',
      'artifactStage',
      'version',
      'runId',
    ])
      if (params.has(k)) P.s.ui[k] = params.get(k);
    const u = P.s.ui;
    if (!P.s.reqs[u.req]) u.req = Object.keys(P.s.reqs)[0] || '';
    if (P.index(u.stage) < 0) u.stage = P.r()?.stage || 'idea';
    if (!['terminal', 'canvas', 'evidence'].includes(u.panel))
      u.panel = 'terminal';
    if (P.index(u.artifactStage) < 0) u.artifactStage = null;
    if (
      !['requirements', 'materials', 'artifacts', 'trace', 'timeline'].includes(
        u.productTab,
      )
    )
      u.productTab = 'requirements';
    if (!['catalog', 'bind', 'team', 'workspace', 'audit'].includes(u.govTab))
      u.govTab = 'catalog';
  }
  P.render = ({ quiet = false } = {}) => {
    const app = document.querySelector('#app'),
      old = app.querySelector('.work-layout')?.dataset.context,
      context = P.s.ui.req + ':' + P.s.ui.stage;
    const scrolls =
      old === context
        ? [
            '#stream',
            '.ctx-rail',
            '.panel-body',
            '#panel-term',
            '#mirror-term',
          ].map((s) => [s, document.querySelector(s)?.scrollTop || 0])
        : [];
    const focus = document.activeElement,
      focusId = focus?.id,
      selection = focus?.selectionStart;
    const active = P.s.ui.route === 'work' ? 'delivery' : P.s.ui.route;
    document.querySelector('#global-header').innerHTML =
      `<div class="brand"><span class="brand-mark">${i('zap')}</span>PFC 产品全链路</div><nav class="main-nav" aria-label="主导航">${[
        ['home', '我的工作台', 'home'],
        ['product', '产品空间', 'box'],
        ['delivery', '交付中心', 'git'],
        ['gov', '治理中心', 'shield'],
      ]
        .map(
          ([id, text, icon]) =>
            `<button class="nav-item ${active === id ? 'active' : ''}" data-action="navigate" data-route="${id}">${i(icon)}${text}</button>`,
        )
        .join(
          '',
        )}</nav><div class="header-right"><button class="search-box" data-action="search">${i('search')} 全局搜索 / 命令</button><button class="icon-btn" data-action="notifications" aria-label="通知">${i('bell')}</button><button class="demo-tag" data-action="scenarios">交互原型 · 场景切换</button><span class="avatar" title="${P.s.role === 'viewer' ? '只读体验' : '负责人体验'}">${P.s.role === 'viewer' ? '读' : '陈'}</span></div>`;
    const notice = P.conflict
      ? P.notice(
          '另一窗口已更新。为避免覆盖，当前只读；草稿保留。',
          'reload-state',
          '载入最新记录',
        )
      : P.storageError
        ? P.notice('浏览器存储不可用，当前更改只能保留在此页面。')
        : P.s.role === 'viewer'
          ? P.notice(
              '当前以只读成员体验，可查看记录，修改操作会被阻止。',
              'scenarios',
              '切换体验角色',
            )
          : '';
    const blocked = P.stateView();
    app.innerHTML =
      notice +
      (blocked ||
        (P.s.ui.route === 'work'
          ? P.renderWork()
          : P.s.ui.route === 'home'
            ? P.renderHome()
            : P.s.ui.route === 'product'
              ? P.renderProduct()
              : P.s.ui.route === 'delivery'
                ? P.renderDelivery()
                : P.renderGovernance()));
    scrolls.forEach(([s, y]) => {
      const el = document.querySelector(s);
      if (el) el.scrollTop = y;
    });
    if (focusId && focus?.closest('#app')) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: true });
        try {
          el.setSelectionRange(selection, selection);
        } catch {}
      }
    }
    if (!quiet)
      document.title =
        'PFC · ' +
        (P.s.ui.route === 'work'
          ? P.r()?.name || '需求工作区'
          : {
              home: '我的工作台',
              product: '产品空间',
              delivery: '交付中心',
              gov: '治理中心',
            }[P.s.ui.route]);
  };
  A.send = () => {
    P.write();
    const q = P.r(),
      input = document.querySelector('#chat-input'),
      text = input.value.trim();
    P.assert(text, '请输入内容');
    P.assert(text.length <= 8000, '单条输入不超过 8000 字');
    for (const m of q.messages)
      if (m.typing) {
        m.text = m.full;
        m.typing = false;
      }
    q.messages.push({ role: 'user', stage: P.s.ui.stage, text });
    P.s.ui.drafts[q.id] = '';
    let proposal = null;
    if (/代码|开发|构建|shell|执行命令/i.test(text) && q.stage === 'dev')
      proposal = { action: 'plan-run', label: '查看本地作业范围' };
    else if (/测试/.test(text) && q.stage === 'test')
      proposal = { action: 'run-tests', label: '执行本阶段测试（演示）' };
    else if (/预览/.test(text) && P.run(q)?.status === 'SUCCEEDED')
      proposal = { action: 'preview-toggle', label: '切换本地预览' };
    else if (/草稿|文档|方案/.test(text))
      proposal = { action: 'generate-draft', label: '查看产物修改建议' };
    const full = `已记录在「${q.name}」的${P.stageName(P.s.ui.stage)}对话中。${proposal ? '可以按下方建议继续，范围与结果会回到当前工作区。' : '当前需要处理：' + (P.blockers(q).join('；') || '确认下一步推进') + '。'}`;
    const reply = {
      id: 'MSG-' + ++P.s.seq,
      role: 'ai',
      stage: P.s.ui.stage,
      text: '',
      full,
      typing: true,
      proposal,
    };
    q.messages.push(reply);
    P.log(q, '对话输入', text.slice(0, 100));
    P.save();
    P.render();
    document.querySelector('#chat-input')?.focus();
    let count = 0;
    const timer = setInterval(() => {
      if (!reply.typing) {
        clearInterval(timer);
        return;
      }
      count += 12;
      reply.text = full.slice(0, count);
      if (count >= full.length) {
        reply.typing = false;
        clearInterval(timer);
        P.save();
      }
      P.render({ quiet: true });
      const stream = document.querySelector('#stream');
      if (stream && P.s.ui.req === q.id && P.s.ui.stage === reply.stage)
        stream.scrollTop = stream.scrollHeight;
    }, 60);
  };
  A['generate-draft'] = () => {
    P.write();
    const q = P.r(),
      stage = P.s.ui.stage;
    P.assert(
      ['idea', 'req', 'design', 'dev'].includes(stage),
      '本阶段使用对应的结果记录',
    );
    P.modal(
      '产物修改建议',
      `<p>基于当前需求、材料基线和最近对话生成新草稿；原型提供字段编辑，以明确后续 AI 建议的确认入口。</p>`,
      b('edit-artifact', '查看并编辑建议', { stage }, 'primary') +
        b('close-modal', '取消'),
    );
  };
  A.search = () => {
    P.modal(
      '全局搜索 / 命令',
      `<label class="form-field" for="global-query"><span>搜索需求、产物、作业或命令</span><input id="global-query" placeholder="输入编号、名称；或输入“创建”“治理”"></label><div class="search-results" id="search-results"></div>`,
    );
    P.searchResults('');
  };
  P.searchResults = (term) => {
    const results = [];
    for (const q of Object.values(P.s.reqs)) {
      if ((q.id + q.name).includes(term))
        results.push(
          b('search-open', e(q.id + ' · ' + q.name), {
            req: q.id,
            stage: q.stage,
          }),
        );
      for (const [stage, versions] of Object.entries(q.artifacts)) {
        const v = versions.at(-1);
        if (term && (v.title + v.id).includes(term))
          results.push(
            b('search-open', e(q.id + ' · ' + v.title + ' · v' + v.version), {
              req: q.id,
              stage,
              panel: 'canvas',
            }),
          );
      }
      for (const run of q.runs)
        if (term && run.id.includes(term))
          results.push(
            b('search-open', e(q.id + ' · ' + run.id), {
              req: q.id,
              stage: 'dev',
              panel: 'terminal',
            }),
          );
    }
    if (!term || '创建需求'.includes(term))
      results.push(b('new-requirement', '命令：创建需求'));
    if (!term || '治理中心'.includes(term))
      results.push(b('search-governance', '命令：打开治理中心'));
    document.querySelector('#search-results').innerHTML =
      results.slice(0, 20).join('') ||
      '<div class="empty-stage">没有匹配结果，请更换关键词。</div>';
  };
  A['search-open'] = (d) => {
    P.close();
    A['open-work'](d);
  };
  A['search-governance'] = () => {
    P.close();
    P.go({ route: 'gov' });
  };
  A.notifications = () =>
    P.modal(
      '最近动态',
      `<div class="event-list">${
        P.s.audit
          .slice(0, 10)
          .map(
            (x) =>
              `<div class="event"><b>${e(x.action)}</b><small>${e(x.req + ' · ' + x.detail)}</small></div>`,
          )
          .join('') || '<div class="empty-stage">暂无新动态</div>'
      }</div>`,
    );
  A.scenarios = () =>
    P.modal(
      '原型场景 · 仅改变演示记录',
      `<p class="muted">用这些场景检查例外路径。所有结果均为模拟，不调用实际工具。</p><div class="scenario-grid">${[
        ['normal', '正常显示'],
        ['loading', '加载中'],
        ['error', '加载失败'],
        ['viewer', '只读成员'],
        ['owner', '负责人'],
        ['offline', 'Bridge 离线'],
        ['online', 'Bridge 恢复'],
        ['input', '作业等待输入'],
        ['approval', '作业等待授权'],
        ['unknown', '作业结果未知'],
        ['failed', '作业执行失败'],
        ['expiry', '发布审批过期'],
        ['release-failure', '下次发布失败'],
        ['window', '完成观察窗口'],
        ['version-conflict', '下次保存版本冲突'],
        ['empty', '空产品空间'],
      ]
        .map(([id, l]) => b('scenario', l, { scenario: id }))
        .join(
          '',
        )}</div><div class="btn-group">${b('reset-prototype', '重置原型演示数据', {}, 'danger')}</div><p class="source-note">存储与正式平台、V3 对照稿隔离。</p>`,
    );
  A.scenario = (d) => {
    const q = P.r(),
      s = P.s;
    const kind = d.scenario;
    if (['normal', 'loading', 'error'].includes(kind)) s.viewState = kind;
    else if (kind === 'viewer' || kind === 'owner') s.role = kind;
    else if (kind === 'offline' || kind === 'online')
      s.bridges.forEach((br) => {
        if (br.status !== 'REVOKED')
          br.status = kind === 'online' ? 'ONLINE' : 'OFFLINE';
      });
    else if (['input', 'approval', 'unknown', 'failed'].includes(kind)) {
      P.assert(q, '先创建需求');
      let run = P.run(q);
      P.assert(run, '先发起一次作业');
      if (['SUCCEEDED', 'CANCELLED', 'FAILED'].includes(run.status)) {
        run = {
          ...P.clone(run),
          id: 'R-' + ++s.seq,
          parentId: run.id,
          pct: 8,
          step: 0,
          exitCode: null,
          preview: false,
        };
        q.runs.push(run);
      }
      run.status = {
        input: 'WAITING_INPUT',
        approval: 'WAITING_APPROVAL',
        unknown: 'UNKNOWN',
        failed: 'FAILED',
      }[kind];
      run.verified = kind === 'failed';
      s.ui.runId = run.id;
      s.ui.route = 'work';
      s.ui.stage = 'dev';
      q.stage = 'dev';
    } else if (kind === 'expiry') {
      P.assert(q?.release, '先申请一次发布审批');
      q.release.expiresAt = P.now() - 1;
    } else if (kind === 'release-failure') s.failRelease = true;
    else if (kind === 'window') {
      P.assert(q?.observation, '先完成发布并进入观察');
      s.clockOffset += q.observation.hours * 3600000;
    } else if (kind === 'version-conflict') s.simulateConflict = true;
    else if (kind === 'empty') {
      P.modal(
        '进入空空间场景',
        '<p>当前原型记录会清空为一个空团队；可创建新需求，或通过重置恢复示例。</p>',
        b('confirm-empty', '确认进入空空间', {}, 'danger') +
          b('close-modal', '取消'),
      );
      return;
    }
    P.save();
    P.close();
    P.render();
    P.toast('已切换原型场景');
  };
  A['confirm-empty'] = () => {
    P.s.reqs = {};
    P.s.ui.req = '';
    P.s.ui.route = 'product';
    P.save();
    P.close();
    P.render();
  };
  A['clear-view'] = () => {
    P.s.viewState = 'normal';
    P.save();
    P.render();
  };
  A['reset-prototype'] = () =>
    P.modal(
      '重置原型演示数据',
      '<p>仅清除这一版原型的本地记录。V3、其他页面与正式平台数据保持独立。</p>',
      b('confirm-reset', '确认重置', {}, 'danger') + b('close-modal', '取消'),
    );
  A['confirm-reset'] = () => {
    P.reset();
    P.close();
    P.go({ route: 'home' });
  };
  A['reload-state'] = () => {
    const drafts = P.clone(P.s.ui.drafts),
      edit = P.clone(P.s.ui.editDrafts);
    const next = JSON.parse(localStorage.getItem(P.KEY));
    P.assert(P.valid(next), '最新存储不可用，请保留当前页面并导出记录');
    P.s = next;
    P.s.ui.drafts = { ...next.ui.drafts, ...drafts };
    P.s.ui.editDrafts = { ...next.ui.editDrafts, ...edit };
    P.conflict = false;
    for (const q of Object.values(P.s.reqs))
      for (const run of q.runs)
        if (['RUNNING', 'CANCELLING'].includes(run.status)) {
          run.status = 'UNKNOWN';
          run.verified = false;
        }
    P.close();
    P.render();
  };
  const saveOriginal = A['save-artifact'];
  A['save-artifact'] = () => {
    if (P.s.simulateConflict) {
      P.s.simulateConflict = false;
      const q = P.s.reqs[P.editor.req];
      P.newVersion(q, P.editor.stage, P.latest(q, P.editor.stage).fields);
      P.save();
    }
    saveOriginal();
  };
  document.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    try {
      const fn = A[el.dataset.action];
      P.assert(fn, '此操作未配置');
      await fn(el.dataset);
    } catch (error) {
      const box = document.querySelector('#form-error');
      if (box) box.textContent = error.message;
      P.toast(error.message);
    }
  });
  document.addEventListener('input', (event) => {
    const el = event.target;
    if (el.id === 'chat-input') {
      P.s.ui.drafts[P.s.ui.req] = el.value;
      P.save();
    }
    if (el.id === 'global-query') P.searchResults(el.value.trim());
    if (el.id === 'requirement-filter') {
      P.s.ui.search = el.value;
      P.render({ quiet: true });
    }
    if (el.name?.startsWith('field') && P.editor) {
      const values = [
        ...document.querySelectorAll('#modal-root textarea[name^="field"]'),
      ].map((x) => x.value);
      P.s.ui.editDrafts[P.editor.base] = values;
      P.save();
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'version-select')
      P.go({ version: event.target.value });
  });
  document.addEventListener('keydown', (event) => {
    const modal = document.querySelector('.guide-dialog');
    if (event.key === 'Escape' && modal) {
      event.preventDefault();
      P.close();
      return;
    }
    if (event.key === 'Tab' && modal) {
      const nodes = [
        ...modal.querySelectorAll(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        ),
      ].filter((x) => x.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      event.target.id === 'chat-input'
    ) {
      event.preventDefault();
      document.querySelector('[data-action="send"]').click();
    }
    if (event.key === 'Enter' && event.target.id === 'global-query') {
      event.preventDefault();
      document.querySelector('#search-results button')?.click();
    }
    if (
      ['ArrowRight', 'ArrowLeft'].includes(event.key) &&
      event.target.matches('[role="tab"]')
    ) {
      event.preventDefault();
      const nodes = [
          ...event.target
            .closest('[role="tablist"]')
            .querySelectorAll('[role="tab"]'),
        ],
        next =
          nodes[
            (nodes.indexOf(event.target) +
              (event.key === 'ArrowRight' ? 1 : -1) +
              nodes.length) %
              nodes.length
          ];
      const a = next.dataset;
      next.click();
      setTimeout(
        () =>
          document
            .querySelector(
              `[data-action="${a.action}"][data-${a.panel ? 'panel' : 'tab'}="${a.panel || a.tab}"]`,
            )
            ?.focus(),
        0,
      );
    }
  });
  window.addEventListener('popstate', () => {
    parse();
    P.render();
  });
  window.addEventListener('hashchange', () => {
    parse();
    P.render();
  });
  parse();
  P.render();
  P.save();
  if (P.loadNotice) P.toast(P.loadNotice);
  const tick = setInterval(P.tick, 1200);
  window.addEventListener('pagehide', () => clearInterval(tick));
})();
