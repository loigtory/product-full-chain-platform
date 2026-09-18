// 64 号：设计阶段产物查看器（方案设计文档 / 时序图 / 流程图 / 可交互原型）
(() => {
  'use strict';
  const P = window.PFC;
  const esc = (s) =>
    String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 轻量 markdown → HTML（标题/列表/段落/粗体/行内码/代码块）
  function md2html(md) {
    const lines = String(md || '').split(/\r?\n/);
    let out = '';
    let inCode = false;
    let codeBuf = [];
    for (const raw of lines) {
      if (/^\s*```/.test(raw)) {
        if (!inCode) { inCode = true; codeBuf = []; }
        else { out += '<pre class="da-code">' + esc(codeBuf.join('\n')) + '</pre>'; inCode = false; }
        continue;
      }
      if (inCode) { codeBuf.push(raw); continue; }
      const line = raw.trim();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { out += '<h' + h[1].length + ' class="da-h">' + esc(h[2]) + '</h' + h[1].length + '>'; continue; }
      const li = line.match(/^[-*]\s+(.*)$/);
      if (li) { out += '<div class="da-li">• ' + esc(li[1]) + '</div>'; continue; }
      if (!line) { out += '<div class="da-p">&nbsp;</div>'; continue; }
      out += '<div class="da-p">' + esc(line).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>') + '</div>';
    }
    return out;
  }
  async function load(reqId, rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    try {
      const r = await fetch(
        '/api/agent/requirements/' + encodeURIComponent(reqId) + '/design-artifacts',
        { headers: { accept: 'application/json' } },
      );
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const kinds = Object.keys(j || {});
      if (!kinds.length) {
        root.innerHTML = '<div class="da-empty">尚无设计产物。在「设计」阶段发起真实 EXEC 作业并让 Agent 在 design/ 目录生成方案、时序图、流程图与原型后，将自动沉淀于此。</div>';
        return;
      }
      let html = '';
      if (j.design) html += daBlock('方案设计文档', md2html(j.design.content));
      if (j.sequence) html += daBlock('时序图（Mermaid）', '<div class="da-mermaid" data-mermaid="' + esc(j.sequence.content) + '"></div>');
      if (j.flow) html += daBlock('流程图（Mermaid）', '<div class="da-mermaid" data-mermaid="' + esc(j.flow.content) + '"></div>');
      if (j.prototype) html += daBlock('可交互原型', '<iframe class="da-frame" sandbox="allow-scripts" srcdoc="' + esc(j.prototype.content).replace(/"/g, '&quot;') + '"></iframe>');
      root.innerHTML = html;
      // 渲染 mermaid
      const mels = root.querySelectorAll('.da-mermaid');
      if (mels.length && window.mermaid) {
        window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
        mels.forEach((el, idx) => {
          const src = el.getAttribute('data-mermaid') || '';
          const clean = (src.replace(/^```/, '').replace(/```\s*$/, '')).trimStart();
          window.mermaid
            .render('da-mmd-' + idx + '-' + Date.now(), clean)
            .then(({ svg }) => { el.innerHTML = svg; })
            .catch((err) => { el.innerHTML = '<div class="da-err">图渲染失败：' + esc(String(err && err.message || err)) + '</div><pre class="da-code">' + esc(clean) + '</pre>'; });
        });
      } else if (mels.length) {
        mels.forEach((el) => { el.innerHTML = '<pre class="da-code">' + esc(el.getAttribute('data-mermaid')) + '</pre>'; });
      }
    } catch (e) {
      root.innerHTML = '<div class="da-err">设计产物加载失败：' + esc(String(e && e.message || e)) + '</div>';
    }
  }
  function daBlock(title, body) {
    return '<section class="da-block"><div class="da-block-title">' + esc(title) + '</div>' + body + '</section>';
  }
  function card(reqId) {
    const id = 'da-root-' + String(Date.now()).slice(-6) + '-' + Math.floor(Math.random() * 1e3);
    setTimeout(() => load(reqId, id), 0);
    return '<section class="card da-card"><header><span>' + P.icon('layers') + ' 方案与设计图</span></header><div id="' + id + '"><div class="da-empty">加载中…</div></div></section>';
  }
  window.PFCDesignArtifacts = { card, load, md2html };
})();
