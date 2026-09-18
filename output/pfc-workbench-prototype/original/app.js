(() => {
  const P = window.PFC,
    { esc: e, btn: b, icon: i } = P,
    A = P.actions;
  const routes = new Set(['home', 'work', 'product', 'delivery', 'gov']);
  P.go = (patch) => {
    if (P.flowUI?.active()) P.flowUI.exit();
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
    if (!P.conflict) P.save();
    P.render();
  };
  function parse() {
    if (P.flowUI?.syncLocation()) return;
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
    if (P.localSession?.locked) return P.localSession.render();
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
          ].map((s) => {
            const el = document.querySelector(s);
            const terminalScroll =
              ['#panel-term', '#mirror-term'].includes(s) ||
              (s === '.panel-body' && P.s.ui.panel === 'terminal');
            return [
              s,
              el?.scrollTop || 0,
              !!el &&
                terminalScroll &&
                el.scrollHeight - el.clientHeight - el.scrollTop < 32,
            ];
          })
        : [];
    const focus = document.activeElement,
      focusId = focus?.id,
      selection = focus?.selectionStart;
    const active = P.s.ui.route === 'work' ? 'home' : P.s.ui.route;
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
        )}</nav><div class="header-right"><button class="search-box" data-action="search">${i('search')} 全局搜索 / 命令</button><button class="icon-btn" data-action="notifications" aria-label="通知">${i('bell')}${(() => {
        const unread = (P.s.notices || []).filter((n) => !n.read).length;
        return unread
          ? `<span class="bell-dot" title="${unread} 条未读">${unread}</span>`
          : '';
      })()}</button><button class="demo-tag" data-action="${P.domainView?.pg() ? 'pg-info' : 'scenarios'}">${P.domainView?.pg() ? 'PG 持久化 · 对话/执行模拟' : '交互原型 · 场景切换'}</button><span class="data-mode-tag" data-action="data-mode" title="数据层模式：点击切换 本地存储 / Mock 服务端 / API 模式（M1 后段）">${(() => {
        try {
          return window.PFCStore ? window.PFCStore.label() : '本地存储';
        } catch {
          return '本地存储';
        }
      })()}</span><span class="avatar" title="${P.s.role === 'viewer' ? '只读体验' : '负责人体验'}">${P.s.role === 'viewer' ? '读' : '陈'}</span></div>`;
    P.localSession?.header();
    if (P.flowUI?.active()) {
      P.flowUI.render();
      return;
    }
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
    const blocked = P.domainView?.loadingView() || P.stateView();
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
    P.domainActions?.decorate();
    scrolls.forEach(([s, y, follow]) => {
      const el = document.querySelector(s);
      if (el) el.scrollTop = follow ? el.scrollHeight : y;
    });
    if (focusId && focus?.closest('#app')) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: true });
        try {
          el.setSelectionRange(selection, selection);
        } catch {
          /* Some focused controls do not expose a text selection. */
        }
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
  A['test-batch-detail'] = (d) => {
    const q = P.r(),
      tr = q.testRuns.find((x) => x.id === d.id);
    P.assert(tr, '测试批次不存在');
    const defects = q.defects.filter((x) => x.runId === tr.id);
    P.modal(
      '测试批次 · ' + tr.id,
      `<div class="kv-row"><span>时间</span><b>${e(P.time(tr.at))}</b></div><div class="kv-row"><span>基线</span><b>${e(tr.baseline)}</b></div><div class="kv-row"><span>执行人</span><b>陈立</b></div><p class="muted">该批次结果来自当前基线的执行记录，旧批次不覆盖最新状态。</p>` +
        P.table(
          ['用例', '结果', '实际'],
          tr.results.map((x) => [
            e(x.id + ' · ' + x.text),
            P.badge(x.status, x.status === 'PASS' ? 'green' : 'red'),
            e(x.actual),
          ]),
        ) +
        (defects.length
          ? '<div class="rail-title" style="margin-top:10px">关联缺陷</div>' +
            P.table(
              ['缺陷', '状态'],
              defects.map((x) => [
                e(x.id + ' · ' + x.title),
                P.badge(x.status, x.status === 'CLOSED' ? 'green' : 'orange'),
              ]),
            )
          : '<p class="muted">无关联缺陷。</p>'),
      b('close-modal', '关闭'),
    );
  };
  A['generate-draft'] = () => {
    P.write();
    const stage = P.s.ui.stage;
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
    const hit = (label, patch) => {
      results.push(b('search-open', label, patch));
    };
    for (const q of Object.values(P.s.reqs)) {
      if (!term || (q.id + q.name + q.owner).includes(term))
        hit(e(q.id + ' · ' + q.name), { req: q.id, stage: q.stage });
      for (const [stage, versions] of Object.entries(q.artifacts)) {
        /* 产物：标题 / 版本号 / 任意版本字段内容均可命中，标注阶段 */
        const vs = versions.filter(
          (v) =>
            !term ||
            (v.title + v.id).includes(term) ||
            v.fields.some((f) => f.value.includes(term)),
        );
        for (const v of vs.slice(-3).reverse())
          hit(
            e(
              q.id +
                ' · ' +
                P.stageName(stage) +
                ' · ' +
                v.title +
                ' · ' +
                v.id,
            ),
            { req: q.id, stage, panel: 'canvas', version: v.id },
          );
      }
      for (const run of q.runs)
        if (!term || run.id.includes(term))
          hit(e(q.id + ' · ' + run.id + ' · ' + e(run.operation)), {
            req: q.id,
            stage: 'dev',
            panel: 'terminal',
            runId: run.id,
          });
      /* 材料与对话消息全文命中，标注阶段 */
      for (const m of q.materials)
        if (term && (m.name + (m.content || '')).includes(term))
          hit(e(q.id + ' · 材料 · ' + m.name), {
            req: q.id,
            stage: 'idea',
            productTab: 'materials',
          });
      for (const msg of q.messages)
        if (term && (msg.text || '').includes(term))
          hit(
            e(
              q.id +
                ' · ' +
                P.stageName(msg.stage) +
                ' · 对话 · ' +
                (msg.text || '').slice(0, 26) +
                '…',
            ),
            { req: q.id, stage: msg.stage },
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
  A.notifications = () => {
    const unread = (P.s.notices || []).filter((n) => !n.read).length;
    P.modal(
      '通知中心',
      `<p class="muted">关键事件自动入队（计划拒绝 / 质量门失败 / 发布审批 / 验收等）。${unread ? '有 ' + unread + ' 条未读。' : '已全部读阅。'}</p><div class="notice-list">${
        P.s.notices
          .slice(0, 20)
          .map(
            (n) =>
              `<div class="notice-item ${n.read ? 'read' : ''}">${P.badge(
                n.kind === 'warn' ? '警示' : '信息',
                n.kind === 'warn' ? 'orange' : 'cyan',
              )}<div class="notice-main"><b>${e(n.title)}</b><small>${e(n.req + ' · ' + P.time(n.at))}</small></div>${n.read ? '' : b('mark-notice', '标记已读', { id: n.id })}</div>`,
          )
          .join('') || '<div class="empty-stage">暂无通知</div>'
      }</div><p class="source-note">正式平台由服务端通知流承载（站内 / 邮件 / IM 推送）；此处为浏览器本地演示。</p>`,
      b('close-modal', '关闭') +
        (unread ? b('mark-all-notices', '全部标记已读') : ''),
    );
  };
  A['mark-notice'] = (d) => {
    P.write();
    const n = P.s.notices.find((x) => x.id === d.id);
    if (n) n.read = true;
    P.save();
    P.render();
  };
  A['mark-all-notices'] = () => {
    P.write();
    P.s.notices.forEach((n) => (n.read = true));
    P.save();
    P.render();
    P.toast('全部通知已读');
  };
  A.scenarios = () =>
    P.modal(
      '原型场景 · 仅改变演示记录',
      `<p class="muted">用这些场景检查例外路径。所有结果均为模拟，不调用实际工具。</p><div class="btn-group">${b('flow-open', '连续协作演练', { disabled: window.PFCStore?.mode !== 'local' }, 'primary')}</div><p class="source-note">连续协作演练仅在本地存储模式开放，独立保存合成数据。</p>${P.flowUI?.resumeLinks() || ''}<div class="scenario-grid">${[
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
      P.assert(
        !run._remote,
        '领域作业状态由服务端回读；请在 local/mock 模式体验异常场景',
      );
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
    P.storageBase = localStorage.getItem(P.KEY);
    P.s.ui.drafts = { ...next.ui.drafts, ...drafts };
    P.s.ui.editDrafts = { ...next.ui.editDrafts, ...edit };
    P.conflict = false;
    P.hydrateAttachments();
    P.hydrateConversation();
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
      if (P.flowUI?.active() && !el.dataset.action.startsWith('flow-')) {
        if (el.dataset.action === 'scenarios') {
          A['flow-options']();
          return;
        }
        if (['navigate', 'data-mode'].includes(el.dataset.action))
          P.flowUI.exit();
        else if (el.dataset.action !== 'close-modal') {
          P.toast('请先返回原工作区，再使用此操作');
          return;
        }
      }
      /* 对话建议绑定校验：对象或版本变化后过期，需重新评估 */
      if (el.dataset.proposal) {
        const p = P.r()?.messages.find(
          (m) => m.proposal?.pid === el.dataset.proposal,
        )?.proposal;
        P.assert(p, '此建议已失效，请重新发起对话');
        const q = P.r();
        const latest = P.latest(q, p.stage);
        const still =
          (!p.requirementId || p.requirementId === q.id) &&
          p.action === el.dataset.action &&
          p.stage === P.s.ui.stage &&
          (!p.versionId || latest?.id === p.versionId) &&
          (!p.runId || P.run(q)?.id === p.runId) &&
          p.stamp === P.stamp(q);
        P.assert(still, '需求、产物或作业已变化，建议过期；请重新发起对话');
      }
      const fn = A[el.dataset.action];
      P.assert(fn, '此操作未配置');
      P.pendingActions ||= new Set();
      const key = el.dataset.action + ':' + P.s.ui.req;
      if (P.pendingActions.has(key)) return;
      P.pendingActions.add(key);
      try {
        await fn(el.dataset);
      } finally {
        P.pendingActions.delete(key);
      }
    } catch (error) {
      const box = document.querySelector('#form-error');
      if (box) box.textContent = error.message;
      P.toast(error.message, 'error');
    }
  });
  document.addEventListener('paste', async (event) => {
    if (P.flowUI?.active()) return;
    const t = event.target;
    if (t && (t.id === 'chat-input' || t.closest('.composer'))) {
      const files = [...(event.clipboardData?.files || [])].filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length) {
        event.preventDefault();
        try {
          P.write();
          await P.enqueueFiles(files, P.r().id);
          P.render();
          P.toast('已粘贴 ' + files.length + ' 张截图到附件队列');
        } catch (err) {
          P.render();
          P.toast(err.message, 'error');
        }
      }
    }
  });
  document.addEventListener('dragover', (event) => {
    const t = event.target;
    if (t && t.closest && t.closest('.composer')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const box = document.querySelector('.composer');
      if (box && !box.classList.contains('drag-over'))
        box.classList.add('drag-over');
    }
  });
  document.addEventListener('dragleave', (event) => {
    const box = document.querySelector('.composer');
    if (box && !event.target.closest('.composer'))
      box.classList.remove('drag-over');
  });
  document.addEventListener('drop', async (event) => {
    if (P.flowUI?.active()) {
      event.preventDefault();
      P.toast('演练使用固定合成材料，不读取拖入文件');
      return;
    }
    const t = event.target;
    if (t && t.closest && t.closest('.composer')) {
      event.preventDefault();
      const box = document.querySelector('.composer');
      if (box) box.classList.remove('drag-over');
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length) {
        try {
          P.write();
          await P.enqueueFiles(files, P.r().id);
          P.render();
          P.toast('已添加 ' + files.length + ' 个附件');
        } catch (err) {
          P.render();
          P.toast(err.message, 'error');
        }
      }
    }
  });
  document.addEventListener('input', (event) => {
    if (P.flowUI?.active()) return;
    const el = event.target;
    if (el.id === 'chat-input') {
      P.s.ui.drafts[P.s.ui.req] = el.value;
      P.save();
    }
    if (el.id?.startsWith('exec-')) {
      const key = P.s.ui.req + ':' + P.s.ui.stage;
      P.s.ui.execDrafts = P.s.ui.execDrafts || {};
      const draft = (P.s.ui.execDrafts[key] ||= { workspace: '', control: {} });
      draft.control.confirmed = false;
      if (el.id === 'exec-workspace') draft.workspace = el.value;
      if (el.id === 'exec-control-mode') draft.control.mode = el.value;
      if (el.id === 'exec-control-files')
        draft.control.allowedFiles = el.value
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
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
    if (P.flowUI?.active()) return;
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
  P.domainActions?.install();
  parse();
  P.render();
  if (!P.flowUI?.active()) P.save();
  if (P.loadNotice) P.toast(P.loadNotice);
  /* api 模式：启动时从后端 hydrate（无状态则工厂种子 PUT），此后 P.save 自动同步 */
  try {
    if (
      window.PFCStore &&
      window.PFCStore.mode === 'api' &&
      window.PFCAPI &&
      window.PFCAPI.api
    ) {
      (P.localSession ? P.localSession.boot() : window.PFCAPI.api.init())
        .then(async () => {
          /* hydrate 完成后再连 WS 订阅（Bridge 实时对话流） */
          if (window.PFCWS) window.PFCWS.connect();
          /* 拉取真实 agent 能力（capable / execCapable），供"开发执行"入口渲染 */
          P.s.env = P.s.env || {};
          try {
            const st = await window.PFCAPI.api.req('GET', '/api/agent/status');
            P.s.env.capable = !!st?.capable;
            P.s.env.execCapable = !!st?.execCapable;
            P.s.env.execution = st?.execution ?? null;
            P.s.env.schemaVersion = st?.schemaVersion ?? null;
            P.save();
            P.render({ quiet: true });
          } catch {
            P.s.env.capable = false;
            P.s.env.execCapable = false;
            P.s.env.execution = null;
          }
          /* 各阶段 AI 能力配置（服务端 stage-capabilities），供"本阶段启用能力"面板展示 */
          try {
            const caps = await window.PFCAPI.api.req(
              'GET',
              '/api/agent/stage-capabilities',
            );
            P.s.stageCaps = {};
            for (const c of caps?.stages || []) P.s.stageCaps[c.stage] = c;
            P.save();
            P.render({ quiet: true });
          } catch {
            P.s.stageCaps = {};
          }
        })
        .catch((e) => {
          P.toast('API 连接失败：' + e.message, 'error');
        });
    }
  } catch {
    /* ignore */
  }
  const tick = setInterval(() => {
    if (!P.flowUI?.active() && !P.localSession?.locked) P.tick();
  }, 1200);
  window.addEventListener('pagehide', () => {
    clearInterval(tick);
    window.PFCWS?.disconnect();
  });
})();
