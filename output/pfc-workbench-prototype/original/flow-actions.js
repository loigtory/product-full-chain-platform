(() => {
  const P = window.PFC,
    M = window.PFCFlow,
    D = window.PFCFlowData,
    A = P.actions;
  const mode = () => window.PFCStore?.mode || 'local';
  const store = M.createStore({
    storage: localStorage,
    locks: navigator.locks,
    mode,
  });
  let id = '',
    state = null,
    ui = {},
    notice = '',
    pending = null,
    busy = false,
    focusTarget = '';
  const viewKey = () => D.prefix + id + ':view';
  const current = () => state && M.current(state);
  function saveView() {
    try {
      sessionStorage.setItem(viewKey(), JSON.stringify(ui));
      return true;
    } catch {
      notice = '本窗口草稿尚未保存：浏览器存储不可用，请保留输入后重试。';
      return false;
    }
  }
  function viewDefaults() {
    return { ...state.ui, drafts: {}, goals: {}, scrolls: {} };
  }
  function readView() {
    let saved = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(viewKey()) || '{}');
    } catch {
      /* Invalid preferences do not replace business state. */
    }
    ui = { ...viewDefaults(), ...saved };
    ui.drafts ||= {};
    ui.scrolls ||= {};
    if (!D.stages.includes(ui.stage)) ui.stage = current().stage;
    if (!['terminal', 'canvas', 'evidence'].includes(ui.panel))
      ui.panel = 'canvas';
    if (!['prototype', 'prd', 'design', 'ac'].includes(ui.tab))
      ui.tab = 'prototype';
  }
  function capture() {
    if (!state) return;
    const chat = document.querySelector('#flow-chat');
    if (chat) ui.drafts[current().id] = chat.value;
    for (const selector of [
      '#stream',
      '.ctx-rail',
      '.panel-body',
      '#flow-mirror-term',
      '#flow-panel-term',
    ]) {
      const el = document.querySelector('.flow-room ' + selector);
      if (el)
        ui.scrolls[current().id + ':' + ui.stage + ':' + selector] =
          el.scrollTop;
    }
  }
  function url(replace = false) {
    const params = new URLSearchParams({
      flow: id,
      stage: ui.stage,
      panel: ui.panel,
      tab: ui.tab,
    });
    if (ui.version) params.set('version', ui.version);
    history[replace ? 'replaceState' : 'pushState'](
      null,
      '',
      '#/work?' + params,
    );
    saveView();
  }
  function active() {
    return !!id && mode() === 'local';
  }
  function syncLocation() {
    const params = new URLSearchParams(location.hash.split('?')[1] || ''),
      next = params.get('flow');
    if (!next) {
      if (id) {
        capture();
        saveView();
      }
      id = '';
      state = null;
      return false;
    }
    if (mode() !== 'local') {
      id = '';
      state = null;
      return false;
    }
    try {
      if (next !== id || !state) {
        id = next;
        state = store.load(id);
        readView();
        notice = '';
      }
      for (const k of ['stage', 'panel', 'tab', 'version'])
        if (params.has(k)) ui[k] = params.get(k);
      if (!D.stages.includes(ui.stage)) ui.stage = current().stage;
      if (!['terminal', 'canvas', 'evidence'].includes(ui.panel))
        ui.panel = 'canvas';
      if (!['prototype', 'prd', 'design', 'ac'].includes(ui.tab))
        ui.tab = 'prototype';
    } catch (error) {
      id = next;
      state = null;
      notice = error.message;
    }
    return true;
  }
  function render() {
    document.title = 'PFC · 连续协作演练';
    const app = document.querySelector('#app');
    if (!state) {
      app.innerHTML = `<div class="guide-page"><h2>演练暂不可恢复</h2><p role="alert">${P.esc(notice)}</p>${P.btn('flow-exit', '返回原工作区', {})}</div>`;
      return;
    }
    const focus = document.activeElement,
      focusId = focus?.id,
      selection = focus?.selectionStart;
    if (app.contains(focus)) {
      if (focusId) focusTarget = '#' + focusId;
      else if (focus?.dataset.action)
        focusTarget = ['action', 'command', 'stage', 'panel', 'tab']
          .filter((k) => focus.dataset[k])
          .map(
            (k) => '[data-' + k + '=' + JSON.stringify(focus.dataset[k]) + ']',
          )
          .join('');
    }
    app.innerHTML = window.PFCFlowView.render(state, ui, notice, busy);
    for (const selector of [
      '#stream',
      '.ctx-rail',
      '.panel-body',
      '#flow-mirror-term',
      '#flow-panel-term',
    ]) {
      const el = app.querySelector(selector);
      if (el)
        el.scrollTop =
          ui.scrolls[current().id + ':' + ui.stage + ':' + selector] || 0;
    }
    if (!busy && focusTarget) {
      const el =
        app.querySelector(focusTarget) ||
        app.querySelector('.stage-footer button');
      el?.focus({ preventScroll: true });
      if (focusId)
        try {
          el?.setSelectionRange(selection, selection);
        } catch {
          /* non-text control */
        }
    }
  }
  async function open() {
    P.assert(
      mode() === 'local',
      '请先在本地存储模式体验；不会自动切换或写入 API',
    );
    const nextId = 'CODEx_TEST_FLOW_20260912_manual_' + crypto.randomUUID();
    const created = await store.create(
      D.create(nextId, location.hash || '#/home'),
    );
    id = nextId;
    state = created;
    ui = viewDefaults();
    notice = '';
    pending = null;
    P.close();
    url();
    P.render();
  }
  function resumeLinks() {
    if (mode() !== 'local') return '';
    const items = [];
    try {
      for (let n = 0; n < localStorage.length; n++) {
        const key = localStorage.key(n),
          runId = key?.startsWith(D.prefix) ? key.slice(D.prefix.length) : '';
        if (!D.validId(runId)) continue;
        try {
          const saved = store.load(runId),
            r = M.current(saved);
          items.push(
            P.btn(
              'flow-resume',
              '恢复：' +
                P.esc(r.title) +
                ' · ' +
                window.PFCFlowView.names[r.stage],
              { id: runId },
            ),
          );
        } catch {
          /* Preserve invalid records for diagnosis. */
        }
      }
    } catch {
      return '<p class="source-note">暂时无法读取已保存的演练。</p>';
    }
    return items.length
      ? '<p class="source-note">已保存的演练（最多显示 5 项）</p><div class="btn-group">' +
          items.slice(-5).join('') +
          '</div>'
      : '';
  }
  function exit() {
    P.assert(!busy, '当前正在保存，请完成后返回');
    capture();
    if (state) saveView();
    const target = state?.returnHash || '#/home';
    id = '';
    state = null;
    pending = null;
    notice = '';
    history.replaceState(
      null,
      '',
      target.startsWith('#/') && !target.includes('flow=') ? target : '#/home',
    );
  }
  async function execute(type, payload = {}, retry = false) {
    P.assert(active() && state, '请先进入本地演练');
    if (busy) return;
    capture();
    saveView();
    busy = true;
    notice = '';
    const previousStage = current().stage;
    const c = retry
      ? pending
      : {
          id: crypto.randomUUID(),
          type,
          reqId: current().id,
          expectedRevision: state.revision,
          payload,
        };
    if (!c) {
      busy = false;
      return;
    }
    pending = c;
    P.render();
    try {
      state = await store.transact(id, c);
      pending = null;
      if (['propose', 'message'].includes(type)) ui.drafts[current().id] = '';
      if (current().stage !== previousStage || type === 'select') {
        ui.stage = current().stage;
        ui.version = null;
        ui.previewDays = undefined;
        ui.previewEnabled = undefined;
        ui.empty = false;
      }
      if (type === 'apply-proposal') {
        ui.previewDays = undefined;
        ui.version = null;
        ui.showDiff = false;
      }
      if (type === 'generate') ui.panel = 'canvas';
      if (type === 'start-run') ui.panel = 'terminal';
      url(true);
    } catch (error) {
      notice = error.message + '；已保留当前草稿和操作，可载入最新记录核对。';
    } finally {
      busy = false;
      P.render();
    }
  }
  function change(patch) {
    capture();
    Object.assign(ui, patch);
    url();
    P.render();
  }
  A['flow-open'] = open;
  A['flow-resume'] = (d) => {
    const loaded = store.load(d.id);
    id = d.id;
    state = loaded;
    readView();
    notice = '';
    pending = null;
    P.close();
    url();
    P.render();
  };
  A['flow-exit'] = () => {
    exit();
    P.render();
  };
  A['flow-clear'] = () =>
    P.modal(
      '清除此演练',
      '<p>仅删除当前合成演练及本窗口视图。原需求与其他演练保留。</p>',
      P.btn('flow-clear-confirm', '确认清理', {}, 'danger') +
        P.btn('close-modal', '取消', {}),
    );
  A['flow-clear-confirm'] = async () => {
    await store.remove(id, state.revision);
    sessionStorage.removeItem(viewKey());
    const target = state.returnHash;
    id = '';
    state = null;
    pending = null;
    P.close();
    history.replaceState(null, '', target);
    P.render();
  };
  A['flow-stage'] = (d) => change({ stage: d.stage });
  A['flow-panel'] = (d) => change({ panel: d.panel });
  A['flow-tab'] = (d) => change({ panel: 'canvas', tab: d.tab });
  A['flow-diff'] = () => change({ showDiff: !ui.showDiff });
  A['flow-expand'] = () => {
    change({ expanded: !ui.expanded });
    document.querySelector('[data-action="flow-expand"]')?.focus();
  };
  A['flow-empty'] = () => change({ empty: !ui.empty });
  A['flow-preview'] = () => {
    const days = Number(document.querySelector('#flow-days')?.value),
      box = document.querySelector('#flow-preview-error');
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      box.textContent = '请输入 1–30 天的整数。';
      document.querySelector('#flow-days')?.focus();
      return;
    }
    change({
      previewDays: days,
      previewEnabled: !!document.querySelector('#flow-enabled')?.checked,
    });
  };
  A['flow-propose'] = async () => {
    const days = Number(document.querySelector('#flow-days')?.value);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      document.querySelector('#flow-preview-error').textContent =
        '请输入 1–30 天的整数。';
      return;
    }
    await execute('propose', { days });
  };
  A['flow-send'] = async () => {
    const text = document.querySelector('#flow-chat').value.trim();
    const match = text.match(/(?:提前|改成|改为)\s*(\d+)\s*天/);
    if (match && M.latest(current()))
      await execute('propose', { days: Number(match[1]), text });
    else await execute('message', { text });
  };
  A['flow-command'] = (d) =>
    execute(
      d.command,
      d.command === 'generate'
        ? {
            goal: document.querySelector('#flow-goal')?.value || current().goal,
          }
        : d.command === 'answer'
          ? { answer: 'inbox' }
          : {},
    );
  A['flow-retry'] = () => execute(pending?.type, pending?.payload, true);
  A['flow-reload'] = () => {
    capture();
    try {
      state = store.load(id);
      ui.stage = current().stage;
      ui.version = null;
      notice = '已载入最新事实，当前窗口草稿保留。请核对后重新提出过期动作。';
      pending = null;
      url(true);
    } catch (error) {
      notice = error.message;
    }
    P.render();
  };
  A['flow-material'] = () =>
    P.modal(
      '引用的合成材料',
      `<p>${P.esc(current().materials[0].name)}</p><p>${P.esc(current().materials[0].text)}</p><p class="muted">本轮仅使用此固定材料；不读取或解析真实上传文件。</p>`,
      P.btn('close-modal', '返回演练', {}),
    );
  A['flow-options'] = () =>
    P.modal(
      '异常与角色演练',
      '<p class="muted">这些开关仅改变当前合成演练，不代表真实权限或服务故障。</p><div class="scenario-grid">' +
        [
          ['owner', '负责人'],
          ['viewer', '只读成员'],
          ['partial', '首次生成部分失败'],
          ['input', '等待业务决定'],
          ['unknown', '运行结果不明'],
          ['test-failure', '下一次测试失败'],
          ['release-failure', '下一次发布失败'],
        ]
          .map(([kind, label]) => P.btn('flow-scenario', label, { kind }))
          .join('') +
        '</div>',
      P.btn('close-modal', '返回', {}),
    );
  A['flow-scenario'] = async (d) => {
    P.close();
    await execute('scenario', { kind: d.kind });
  };
  document.addEventListener('input', (event) => {
    if (!active() || !state) return;
    if (event.target.id === 'flow-chat') {
      ui.drafts[current().id] = event.target.value;
      ui.draftNote = saveView()
        ? '草稿已保存在本窗口'
        : '草稿尚未保存，请保留输入';
      const status = document.querySelector('#flow-draft-state');
      if (status) status.textContent = ui.draftNote;
    }
    if (event.target.id === 'flow-goal') {
      ui.goals ||= {};
      ui.goals[current().id] = event.target.value;
      saveView();
    }
  });
  document.addEventListener('change', (event) => {
    if (!active() || !state) return;
    if (event.target.id === 'flow-version')
      change({
        version: event.target.value,
        previewDays: undefined,
        previewEnabled: undefined,
      });
    if (event.target.id === 'flow-req')
      execute('select', { reqId: event.target.value });
    if (event.target.id === 'flow-enabled')
      change({ previewEnabled: event.target.checked });
  });
  document.addEventListener('keydown', (event) => {
    if (!active()) return;
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      event.target.id === 'flow-chat'
    ) {
      event.preventDefault();
      A['flow-send']();
    }
  });
  window.addEventListener('storage', (event) => {
    if (active() && event.key === D.prefix + id) {
      capture();
      notice = '另一窗口已更新此演练。请载入最新记录并核对；草稿已保留。';
      saveView();
      P.render();
    }
  });
  window.addEventListener('pagehide', () => {
    if (active()) {
      capture();
      saveView();
    }
  });
  P.flowUI = {
    active,
    syncLocation,
    render,
    open,
    exit,
    capture,
    resumeLinks,
    get state() {
      return state;
    },
    get view() {
      return ui;
    },
  };
})();
