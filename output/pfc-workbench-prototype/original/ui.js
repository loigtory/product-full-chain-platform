(() => {
  const P = window.PFC;
  P.esc = (v) =>
    String(v ?? '').replace(
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
  P.icon = (name) =>
    `<span class="icon" aria-hidden="true">${P.D.ICONS[name] || P.D.ICONS.file}</span>`;
  P.btn = (action, label, data = {}, kind = '') =>
    `<button type="button" class="btn ${kind}" data-action="${action}" ${Object.entries(
      data,
    )
      .map(([k, v]) =>
        k === 'disabled'
          ? v
            ? 'disabled aria-disabled="true"'
            : ''
          : k === 'title'
            ? `title="${P.esc(v)}"`
            : `data-${k}="${P.esc(v)}"`,
      )
      .join(' ')}>${label}</button>`;
  P.badge = (text, color = 'blue') =>
    `<span class="badge badge-${color}">${P.esc(text)}</span>`;
  P.card = (title, body, extra = '') =>
    `<section class="card"><div class="card-head"><h3 class="card-title">${title}</h3>${extra}</div>${body}</section>`;
  P.table = (heads, rows) =>
    `<div class="table-scroll"><table class="data-table"><thead><tr>${heads.map((h) => `<th>${P.esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${heads.length}"><div class="empty-stage">暂无记录</div></td></tr>`}</tbody></table></div>`;
  P.field = (name, label, value = '', type = 'text', help = '') =>
    `<label class="form-field" for="f-${name}"><span>${P.esc(label)}</span>${type === 'textarea' ? `<textarea id="f-${name}" name="${name}" rows="4">${P.esc(value)}</textarea>` : `<input id="f-${name}" name="${name}" type="${type}" value="${P.esc(value)}">`}${help ? `<small>${P.esc(help)}</small>` : ''}</label>`;
  P.select = (name, label, options, value) =>
    `<label class="form-field" for="f-${name}"><span>${label}</span><select name="${name}" id="f-${name}">${options.map(([id, text]) => `<option value="${P.esc(id)}" ${id === value ? 'selected' : ''}>${P.esc(text)}</option>`).join('')}</select></label>`;
  P.form = () =>
    Object.fromEntries(
      new FormData(document.querySelector('#modal-root form')),
    );
  P.time = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
  P.toast = (msg, type = 'ok') => {
    const root = document.querySelector('#toast-root');
    const e = document.createElement('div');
    e.className = 'toast' + (type === 'error' ? ' err' : type === 'warn' ? ' warn' : '');
    e.setAttribute('role', type === 'error' ? 'alert' : 'status');
    e.textContent = msg;
    root.append(e);
    setTimeout(() => e.remove(), 3500);
  };
  P.modal = (title, body, footer = '', wide = false) => {
    P.origin = document.activeElement;
    document.querySelector('#modal-root').innerHTML =
      `<div class="modal-mask" data-action="close-modal"></div><section class="guide-dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="cap-head"><h2 id="dialog-title">${P.esc(title)}</h2>${P.btn('close-modal', P.icon('x'), '', true)}</div><div class="dialog-body">${body}<p class="form-error" role="alert" id="form-error"></p></div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}</section>`;
    setTimeout(
      () =>
        document
          .querySelector(
            '#modal-root input,#modal-root textarea,#modal-root select,#modal-root button',
          )
          ?.focus(),
      0,
    );
  };
  P.close = () => {
    document.querySelector('#modal-root').innerHTML = '';
    if (P.origin?.isConnected) P.origin.focus();
    else document.querySelector('#chat-input')?.focus();
  };
  P.notice = (text, action, label) =>
    `<div class="guide-notice" role="status"><span>${P.esc(text)}</span>${action ? P.btn(action, label) : ''}</div>`;
  P.tabs = (items, active, action) =>
    `<div class="config-tabs" role="tablist">${items.map(([id, text]) => `<button class="config-tab ${active === id ? 'active' : ''}" role="tab" aria-selected="${active === id}" data-action="${action}" data-tab="${id}">${text}</button>`).join('')}</div>`;
  P.stateView = () =>
    P.s.viewState === 'loading'
      ? `<div class="empty-stage" role="status">正在加载工作区…${P.btn('clear-view', '返回已加载内容')}</div>`
      : P.s.viewState === 'error'
        ? `<div class="empty-stage" role="alert">暂时无法加载，已保留本地内容。${P.btn('clear-view', '重试')}</div>`
        : null;
})();
