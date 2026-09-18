// 64 号：设计阶段产物查看器（方案设计文档 / 时序图 / 流程图 / 可交互原型）
// 66 号：+ 人工补录/编辑入口（EXEC 产物缺失或需修正时的兜底；空态与每个产物块均可发起）
(() => {
  'use strict';
  const P = window.PFC;
  const esc = (s) =>
    String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const KINDS = [
    { kind: 'design', label: '方案设计文档', hint: '含「背景与目标」与「总体架构」章节' },
    { kind: 'sequence', label: '时序图', hint: '含 sequenceDiagram 标记' },
    { kind: 'flow', label: '流程图', hint: '含 flowchart 标记' },
    { kind: 'prototype', label: '可交互原型', hint: '含 html / input / button 交互要素' },
  ];
  const kindMeta = Object.fromEntries(KINDS.map((k) => [k.kind, k]));
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
  // 格式检查（与 65 门禁同标准；前端提示用，不阻断保存）
  function formatIssues(kind, content) {
    const c = String(content || '');
    const issues = [];
    if (kind === 'design') {
      if (!/(背景与目标|背景)/.test(c)) issues.push('缺「背景」章节');
      if (!/(总体架构|架构)/.test(c)) issues.push('缺「总体架构」章节');
    }
    if (kind === 'sequence' && !/sequenceDiagram/i.test(c)) issues.push('缺 sequenceDiagram 标记');
    if (kind === 'flow' && !/flowchart/i.test(c)) issues.push('缺 flowchart 标记');
    if (kind === 'prototype' && !(/<html/i.test(c) && /<input/i.test(c) && /<button/i.test(c))) issues.push('缺 html/input/button 交互要素');
    return issues;
  }
  async function putArtifact(reqId, kind, name, content) {
    const r = await fetch(
      '/api/agent/requirements/' + encodeURIComponent(reqId) + '/design-artifacts',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, name, content }),
      },
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && (j.error.msg || j.error.code)) || 'HTTP ' + r.status);
    return j;
  }
  // 补录/编辑弹窗
  function openEditor(reqId, presetKind, existing) {
    const ov = document.getElementById('da-editor-overlay');
    if (ov) ov.remove();
    const kind = kindMeta[presetKind] || KINDS[0];
    const ovEl = document.createElement('div');
    ovEl.id = 'da-editor-overlay';
    ovEl.className = 'da-editor-overlay';
    const opts = KINDS.map((k) => '<option value="' + k.kind + '"' + (k.kind === kind.kind ? ' selected' : '') + '>' + esc(k.label) + '</option>').join('');
    ovEl.innerHTML =
      '<div class="da-editor">' +
      '<div class="da-editor-title">补录 / 编辑设计产物</div>' +
      '<label class="da-editor-label">产物类型</label><select class="da-editor-kind">' + opts + '</select>' +
      '<label class="da-editor-label">名称</label><input class="da-editor-name" value="' + esc(existing ? existing.name : kind.label) + '" maxlength="200" />' +
      '<label class="da-editor-label">内容（格式提示见下，保存后由确认门禁复核）</label>' +
      '<textarea class="da-editor-content" spellcheck="false">' + esc(existing ? existing.content : '') + '</textarea>' +
      '<div class="da-editor-issues"></div>' +
      '<div class="da-editor-actions">' +
      '<button class="da-editor-cancel">取消</button>' +
      '<button class="da-editor-save">保存</button>' +
      '</div></div>';
    document.body.appendChild(ovEl);
    const sel = ovEl.querySelector('.da-editor-kind');
    const nameEl = ovEl.querySelector('.da-editor-name');
    const contentEl = ovEl.querySelector('.da-editor-content');
    const issuesEl = ovEl.querySelector('.da-editor-issues');
    const refreshIssues = () => {
      const meta = kindMeta[sel.value] || KINDS[0];
      const issues = formatIssues(sel.value, contentEl.value);
      const metaOk = !issues.length;
      issuesEl.innerHTML = '<div class="da-editor-hint">格式要求：' + esc(meta.hint) + '</div>' +
        (issues.length ? '<div class="da-editor-bad">⚠ ' + issues.map(esc).join('；') + '（保存后确认门禁将拦截，请补全）</div>' : '<div class="da-editor-good">✓ 格式要素齐全</div>');
      return metaOk;
    };
    sel.addEventListener('change', refreshIssues);
    contentEl.addEventListener('input', refreshIssues);
    refreshIssues();
    const close = () => ovEl.remove();
    ovEl.querySelector('.da-editor-cancel').addEventListener('click', close);
    ovEl.addEventListener('click', (e) => { if (e.target === ovEl) close(); });
    ovEl.querySelector('.da-editor-save').addEventListener('click', async () => {
      const btn = ovEl.querySelector('.da-editor-save');
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        await putArtifact(reqId, sel.value, nameEl.value.trim() || kindMeta[sel.value].label, contentEl.value);
        close();
        await load(reqId, ovEl.getAttribute('data-root') || activeRoot);
      } catch (e) {
        issuesEl.innerHTML = '<div class="da-editor-bad">保存失败：' + esc(String(e && e.message || e)) + '</div>';
        btn.disabled = false;
        btn.textContent = '保存';
      }
    });
  }
  let activeRoot = null;
  async function load(reqId, rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    activeRoot = rootId;
    try {
      const r = await fetch(
        '/api/agent/requirements/' + encodeURIComponent(reqId) + '/design-artifacts',
        { headers: { accept: 'application/json' } },
      );
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const kinds = Object.keys(j || {});
      if (!kinds.length) {
        root.innerHTML =
          '<div class="da-empty">尚无设计产物。可在「设计」阶段发起真实 EXEC 作业（design/ 目录自动沉淀），或直接人工补录：</div>' +
          '<div class="da-empty-actions">' + KINDS.map((k) => '<button class="da-edit-btn" data-kind="' + k.kind + '">补录' + esc(k.label) + '</button>').join('') + '</div>';
        root.querySelectorAll('.da-edit-btn').forEach((b) =>
          b.addEventListener('click', () => openEditor(reqId, b.getAttribute('data-kind'), null)),
        );
        return;
      }
      let html = '';
      if (j.design) html += daBlock('方案设计文档', md2html(j.design.content), 'design');
      if (j.sequence) html += daBlock('时序图（Mermaid）', '<div class="da-mermaid" data-mermaid="' + esc(j.sequence.content) + '"></div>', 'sequence');
      if (j.flow) html += daBlock('流程图（Mermaid）', '<div class="da-mermaid" data-mermaid="' + esc(j.flow.content) + '"></div>', 'flow');
      if (j.prototype) html += daBlock('可交互原型', '<iframe class="da-frame" sandbox="allow-scripts" srcdoc="' + esc(j.prototype.content).replace(/"/g, '&quot;') + '"></iframe>', 'prototype');
      html += '<div class="da-empty-actions da-add-more"><button class="da-edit-btn" data-kind="">+ 补录/编辑产物</button></div>';
      root.innerHTML = html;
      // 渲染 mermaid
      const mels = root.querySelectorAll('.da-mermaid');
      if (mels.length && window.mermaid) {
        window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
        mels.forEach((el, idx) => {
          const src = el.getAttribute('data-mermaid') || '';
          // 剥离 fence：```flowchart / ```sequenceDiagram / ```mermaid 整行剥掉；保留类型声明行
          const clean = src.replace(/^```[^\n]*/, '').replace(/```\s*$/, '').trim();
          window.mermaid
            .render('da-mmd-' + idx + '-' + Date.now(), clean)
            .then(({ svg }) => { el.innerHTML = svg; })
            .catch((err) => { el.innerHTML = '<div class="da-err">图渲染失败：' + esc(String(err && err.message || err)) + '</div><pre class="da-code">' + esc(clean) + '</pre>'; });
        });
      } else if (mels.length) {
        mels.forEach((el) => { el.innerHTML = '<pre class="da-code">' + esc(el.getAttribute('data-mermaid')) + '</pre>'; });
      }
      root.querySelectorAll('.da-edit-btn').forEach((b) =>
        b.addEventListener('click', () => {
          const k = b.getAttribute('data-kind') || 'design';
          openEditor(reqId, k, (k && j[k]) || null);
        }),
      );
    } catch (e) {
      root.innerHTML = '<div class="da-err">设计产物加载失败：' + esc(String(e && e.message || e)) + '</div>';
    }
  }
  function daBlock(title, body, kind) {
    return (
      '<section class="da-block"><div class="da-block-title"><span>' + esc(title) + '</span>' +
      '<button class="da-edit-btn" data-kind="' + esc(kind || '') + '" data-edit="1">编辑</button></div>' +
      body + '</section>'
    );
  }
  function card(reqId) {
    const id = 'da-root-' + String(Date.now()).slice(-6) + '-' + Math.floor(Math.random() * 1e3);
    setTimeout(() => load(reqId, id), 0);
    return '<section class="card da-card"><header><span>' + P.icon('layers') + ' 方案与设计图</span></header><div id="' + id + '"><div class="da-empty">加载中…</div></div></section>';
  }
  window.PFCDesignArtifacts = { card, load, md2html };
})();
