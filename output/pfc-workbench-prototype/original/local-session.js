(() => {
  'use strict';
  if (!window.PFC_LOCAL_PERSONAL) return;
  const P = window.PFC,
    api = window.PFCAPI.api;
  let saved = null,
    busy = false,
    message = '输入本机访问密钥，解锁你的工作空间。',
    epoch = 0;
  const S = (P.localSession = {
    locked: true,
    get epoch() {
      return epoch;
    },
  });
  const controls = () =>
    [...document.querySelectorAll('#app input, #app textarea, #app select')]
      .filter((el) => el.id && !['password', 'file'].includes(el.type))
      .map((el) => ({ id: el.id, value: el.value, checked: el.checked }));
  S.lock = (reason) => {
    if (!S.locked) {
      const modal = document.querySelector('#modal-root');
      saved = {
        ui: structuredClone(P.s.ui),
        inputs: controls(),
        user: api.user?.name,
        modal: [...modal.childNodes],
      };
      modal.replaceChildren();
      epoch++;
      P.domainView.reset();
    }
    S.locked = true;
    api.ready = false;
    window.PFCWS.disconnect();
    message = reason || '工作空间已锁定。';
    S.render();
  };
  S.render = () => {
    document.querySelector('#global-header').innerHTML =
      '<div class="brand"><span class="brand-mark">' +
      P.icon('zap') +
      '</span>PFC 产品全链路</div><span class="demo-tag">本地工作空间</span>';
    // Keep a partially typed key only in the current input element; rendering never serializes it.
    const existing = document.getElementById('local-unlock');
    if (existing) {
      existing.querySelector('[role="status"]').textContent = message;
      existing.querySelector('button').disabled = busy;
      return;
    }
    document.querySelector('#modal-root').replaceChildren();
    document.querySelector('#app').innerHTML =
      '<main class="local-session-shell"><form id="local-unlock" class="local-session-form" autocomplete="off"><h1>解锁本地工作空间</h1><p role="status">' +
      P.esc(message) +
      '</p><label for="local-access-key">本机访问密钥</label><input id="local-access-key" name="localKey" type="password" autocomplete="off" spellcheck="false" required maxlength="43" aria-describedby="local-key-help"><p id="local-key-help" class="muted">密钥保存在项目的 .local/pfc-workbench/access-key.txt 文件中。请在本机查看并粘贴。</p><button class="btn primary" type="submit">解锁工作空间</button><p class="muted">仅连接本机工作空间。对话与作业仍为模拟执行。</p></form></main>';
    document.getElementById('local-access-key').focus();
  };
  S.header = () => {
    const h = document.querySelector('#global-header');
    h.querySelector('[data-action="data-mode"]')?.remove();
    const label = h.querySelector('.demo-tag');
    if (label) {
      label.textContent = '本地工作空间 · 模拟执行';
      label.removeAttribute('data-action');
    }
    const avatar = h.querySelector('.avatar');
    if (avatar) {
      avatar.textContent = api.user?.name?.slice(0, 1) || '我';
      avatar.title = api.user?.name || '本机负责人';
    }
    h.querySelector('.header-right')?.insertAdjacentHTML(
      'beforeend',
      '<button class="btn" data-local-status>本地状态</button><button class="btn" data-local-logout>退出并锁定</button>',
    );
  };
  async function restore(stamp) {
    await api.init();
    if (stamp !== epoch) return;
    if (saved && saved.user !== api.user?.name)
      throw Error('当前身份与暂存内容不匹配，请退出后重试');
    if (saved) {
      const ui = saved.ui;
      if (!ui.req || P.s.reqs[ui.req]) Object.assign(P.s.ui, ui);
    }
    S.locked = false;
    P.render();
    if (saved) {
      for (const field of saved.inputs) {
        const el = document.getElementById(field.id);
        if (el && !['password', 'file'].includes(el.type)) {
          el.value = field.value;
          if (typeof field.checked === 'boolean') el.checked = field.checked;
        }
      }
      if (!saved.ui.req || P.s.reqs[saved.ui.req])
        document.querySelector('#modal-root').replaceChildren(...saved.modal);
      P.toast('已重新读取服务端记录，暂存输入已恢复。请核对结果后再提交。');
      saved = null;
    }
    window.PFCWS.connect();
  }
  S.boot = async () => {
    const stamp = epoch;
    try {
      await restore(stamp);
    } catch (e) {
      if (stamp !== epoch) return;
      message =
        e.status === 401
          ? '输入本机访问密钥，解锁你的工作空间。'
          : '本地服务暂不可用，请检查启动状态后重试。';
      S.locked = true;
      S.render();
    }
  };
  document.addEventListener('submit', async (event) => {
    if (event.target.id !== 'local-unlock') return;
    event.preventDefault();
    if (busy) return;
    const input = document.getElementById('local-access-key'),
      key = input.value;
    input.value = '';
    busy = true;
    message = '正在解锁…';
    S.render();
    const stamp = epoch;
    try {
      const response = await fetch(
        location.origin + '/api/auth/local-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) {
        const code = (await response.json()).error?.code;
        throw Object.assign(
          Error(
            response.status === 429
              ? '尝试次数或会话数已达上限，请稍后重试。'
              : code === 'LOCAL_LOGIN_FAILED'
                ? '密钥不正确，请重新输入。'
                : '暂时无法解锁，请核对本地服务状态。',
          ),
          { localMessage: true },
        );
      }
      await restore(stamp);
    } catch (e) {
      if (stamp === epoch) {
        message = e.localMessage
          ? e.message
          : '本地服务暂不可用，输入已保留，请稍后重试。';
        S.locked = true;
      }
    } finally {
      busy = false;
      if (S.locked) S.render();
    }
  });
  document.addEventListener('click', async (event) => {
    if (event.target.closest('[data-local-status]')) {
      if (busy || S.locked) return;
      const stamp = epoch;
      busy = true;
      try {
        const info = await api.req('GET', '/api/local-status');
        if (stamp !== epoch || S.locked) return;
        const rows = [
          ['数据存储', '本机 PostgreSQL · 结构版本 ' + info.schemaVersion],
          [
            '运行版本',
            info.sourceCommit.slice(0, 12) +
              (info.sourceDirty ? ' · 含本地修改' : ''),
          ],
          [
            '原件状态',
            info.files.readable
              ? info.files.count + ' 个原件，校验可读'
              : '校验未通过，请检查本地文件',
          ],
          [
            '原件容量',
            (Number(info.files.bytes || 0) / 1048576).toFixed(2) + ' / 100 MiB',
          ],
          [
            '最近完成备份',
            info.lastBackup
              ? new Date(info.lastBackup.createdAt).toLocaleString()
              : '尚无完成备份',
          ],
          ['执行方式', '对话与作业为模拟执行'],
        ];
        P.modal(
          '本地工作空间状态',
          rows
            .map(
              ([name, value]) =>
                '<p><strong>' +
                P.esc(name) +
                '</strong>：' +
                P.esc(value) +
                '</p>',
            )
            .join(''),
          P.btn('close-modal', '关闭'),
        );
      } catch {
        if (!S.locked) P.toast('状态暂不可用，请检查本地服务后重试。', 'error');
      } finally {
        busy = false;
      }
      return;
    }
    if (!event.target.closest('[data-local-logout]') || busy) return;
    busy = true;
    try {
      const response = await fetch(
        location.origin + '/api/auth/local-session',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw Error();
      epoch++;
      saved = null;
      S.locked = true;
      window.PFCWS.disconnect();
      const user = api.user;
      const prefixes = [
        'pfc.pg.preferences:' + api.base() + ':' + user.name,
        'pfc.r2:' + api.base() + ':' + user.id + ':',
        'pfc.r3:' + api.base() + ':' + user.id + ':',
        'pfc.m4:' + api.base() + ':' + user.id + ':',
      ];
      for (const k of Object.keys(localStorage))
        if (
          prefixes.some((x) => k === x || (x.endsWith(':') && k.startsWith(x)))
        )
          localStorage.removeItem(k);
      P.domainView.reset();
      P.domainView.clear();
      api.user = null;
      api.ready = false;
      document.querySelector('#modal-root').replaceChildren();
      message = '已退出，当前工作空间的页面缓存与草稿已清除。';
    } catch {
      message = '退出未完成，请保持页面并在服务恢复后重试。';
      P.toast(message, 'error');
    } finally {
      busy = false;
      if (S.locked) S.render();
    }
  });
  P.actions['data-mode'] = () => {};
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        S.locked &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
})();
