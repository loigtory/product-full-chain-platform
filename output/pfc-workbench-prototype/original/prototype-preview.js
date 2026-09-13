(() => {
  'use strict';
  const P = window.PFC;
  let frame, timer, channel, cache, specification;
  const X = (P.prototypePreview = {
    destroy() {
      clearTimeout(timer);
      frame?.remove();
      frame = null;
    },
    reset() {
      this.destroy();
      cache = null;
      specification = null;
    },
  });
  // This channel only caches bounded preview state in memory; it cannot issue commands.
  window.addEventListener('message', (event) => {
    if (
      !frame ||
      event.source !== frame.contentWindow ||
      event.origin !== 'null' ||
      event.data?.channel !== channel
    )
      return;
    const data = event.data.state;
    if (
      !data ||
      typeof data !== 'object' ||
      Object.keys(data).some(
        (k) => !['page', 'values', 'texts', 'hidden'].includes(k),
      ) ||
      JSON.stringify(data).length > 262144
    )
      return;
    const pages = specification.pages,
      all = pages.flatMap((p) => p.nodes);
    if (!pages.some((p) => p.id === data.page)) return;
    for (const name of ['values', 'texts', 'hidden']) {
      const entries = data[name];
      if (
        !entries ||
        typeof entries !== 'object' ||
        Array.isArray(entries) ||
        Object.keys(entries).length > 1000
      )
        return;
      for (const [id, value] of Object.entries(entries)) {
        const node = all.find((n) => n.id === id);
        if (!node) return;
        if (name === 'hidden') {
          if (node.type !== 'dialog' || typeof value !== 'boolean') return;
        } else {
          if (typeof value !== 'string' || value.length > 4000) return;
          if (name === 'values' && !['field', 'select'].includes(node.type))
            return;
          if (name === 'texts' && !['text', 'section'].includes(node.type))
            return;
          if (
            node.type === 'select' &&
            !node.options.includes(value) &&
            value !== ''
          )
            return;
        }
      }
    }
    cache.state = structuredClone(data);
  });
  // Only this fixed renderer executes. Spec values are assigned through DOM text/value APIs.
  function renderer() {
    const envelope = JSON.parse(document.getElementById('spec').textContent),
      spec = envelope.spec,
      root = document.getElementById('root');
    const pages = new Map(),
      nodes = new Map();
    let currentPage = spec.pages[0].id;
    const remember = () => {
      const state = { page: currentPage, values: {}, texts: {}, hidden: {} };
      for (const page of spec.pages)
        for (const node of page.nodes) {
          const n = nodes.get(node.id);
          if (!n) continue;
          if (['field', 'select'].includes(node.type))
            state.values[node.id] = n.value;
          if (['text', 'section'].includes(node.type))
            state.texts[node.id] = n.textContent;
          if (node.type === 'dialog') state.hidden[node.id] = n.hidden;
        }
      window.parent.postMessage({ channel: envelope.channel, state }, '*');
    };
    const el = (tag, text) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const nav = el('nav'),
      status = el('p');
    status.setAttribute('role', 'status');
    root.append(nav, status);
    const show = (id) => {
      currentPage = id;
      for (const [key, p] of pages) p.hidden = key !== id;
      status.textContent = '';
    };
    for (const page of spec.pages) {
      const p = el('section');
      p.id = page.id;
      pages.set(page.id, p);
      root.append(p);
      p.append(el('h2', page.title));
      const tab = el('button', page.title);
      tab.onclick = () => {
        show(page.id);
        remember();
      };
      nav.append(tab);
      for (const node of page.nodes) {
        let n;
        if (node.type === 'field' || node.type === 'select') {
          const label = el('label', node.label);
          n = el(node.type === 'field' ? 'input' : 'select');
          n.id = node.id;
          if (node.options)
            for (const value of node.options) {
              const o = el('option', value);
              o.value = value;
              n.append(o);
            }
          n.value = node.value || '';
          n.required = !!node.required;
          n.maxLength = 4000;
          n.oninput = remember;
          label.htmlFor = node.id;
          label.append(n);
          p.append(label);
        } else if (node.type === 'table') {
          n = el('table');
          const head = el('tr');
          for (const c of node.columns) head.append(el('th', c));
          const thead = el('thead');
          thead.append(head);
          n.append(thead);
          const body = el('tbody');
          for (const row of node.rows) {
            const tr = el('tr');
            for (const c of row) tr.append(el('td', c));
            body.append(tr);
          }
          n.append(body);
          p.append(n);
        } else {
          n = el(
            node.type === 'section'
              ? 'h3'
              : node.type === 'button'
                ? 'button'
                : 'p',
            node.text,
          );
          p.append(n);
          if (node.type === 'dialog') {
            n.hidden = !node.open;
            n.setAttribute('role', 'region');
            n.setAttribute('aria-label', '确认说明');
          }
          if (node.type === 'button')
            n.onclick = () => {
              const a = node.action,
                target = nodes.get(a.target);
              if (a.type === 'page') show(a.target);
              if (a.type === 'toggle' && target) target.hidden = !target.hidden;
              if (a.type === 'state' && target) {
                if ('value' in target) target.value = a.value || '';
                else target.textContent = a.value || '';
                status.textContent = '预览状态已更新';
              }
              if (a.type === 'validate') {
                const fields = [
                    ...pages.get(a.target).querySelectorAll('input,select'),
                  ],
                  bad = fields.find((f) => !f.checkValidity());
                fields.forEach((f) =>
                  f.setAttribute('aria-invalid', String(!f.checkValidity())),
                );
                status.textContent = bad
                  ? '请填写必填信息'
                  : '填写完整（预览，不提交业务数据）';
                bad?.focus();
              }
              remember();
            };
        }
        nodes.set(node.id, n);
        n.id = node.id;
        if (node.ruleId) {
          const r = el('small', '规则 ' + node.ruleId);
          p.append(r);
        }
      }
    }
    const state = envelope.state;
    if (state)
      for (const [kind, values] of Object.entries(state)) {
        if (kind === 'page') continue;
        for (const [id, value] of Object.entries(values)) {
          const n = nodes.get(id);
          if (!n) continue;
          if (kind === 'values') n.value = value;
          if (kind === 'texts') n.textContent = value;
          if (kind === 'hidden') n.hidden = value;
        }
      }
    show(state?.page || spec.pages[0].id);
  }
  X.mount = (host, spec) => {
    X.destroy();
    if (!host || !spec) return;
    const nonce = crypto.randomUUID().replace(/-/g, ''),
      f = document.createElement('iframe');
    frame = f;
    const key = P.artifactClient.key(P.r().id) + ':' + JSON.stringify(spec);
    if (cache?.key !== key) cache = { key, state: null };
    specification = spec;
    channel = nonce;
    f.title = '业务原型交互预览';
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('width', '100%');
    f.setAttribute('height', '480');
    const payload = JSON.stringify({ spec, state: cache.state, channel: nonce })
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
    const css =
      'body{font:14px system-ui;margin:16px;color:#243449;background:#fff}label{display:block;margin:12px 0}input,select{display:block;padding:8px;max-width:90%;border:1px solid #ccd7e2;border-radius:6px}button{padding:8px 12px;margin:4px;border:1px solid #ccd7e2;border-radius:6px;background:#edf8ff;color:#007bb8;cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #008fd3}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #e0e7ef;text-align:left}small{display:block;color:#68788c}[aria-invalid=true]{border-color:#bc3030}[hidden]{display:none}';
    f.srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><style nonce="${nonce}">${css}</style></head><body><main id="root"></main><script id="spec" type="application/json" nonce="${nonce}">${payload}</script><script nonce="${nonce}">(${renderer.toString()})();</script></body></html>`;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = '正在打开预览…';
    host.replaceChildren(status, f);
    f.onload = () => {
      if (frame === f) {
        clearTimeout(timer);
        status.textContent = '受控交互预览 · 不提交业务数据';
      }
    };
    timer = setTimeout(() => {
      if (frame === f) status.textContent = '预览加载超时，可关闭后重新打开';
    }, 10000);
  };
})();
