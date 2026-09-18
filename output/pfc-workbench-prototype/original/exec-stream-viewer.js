// 63 号：EXEC 作业执行流查看器（终端样式；调 GET /api/agent/requirements/:reqId/exec-stream）
(function () {
  'use strict';
  const css = document.createElement('style');
  css.textContent = `.es-overlay{position:fixed;inset:0;background:rgba(2,6,23,.7);display:flex;align-items:flex-start;justify-content:center;padding:6vh 4vw;z-index:1100}.es-modal{background:#0b1220;border:1px solid #1e293b;border-radius:12px;max-width:960px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(0,0,0,.5);color:#cbd5e1;font-family:Consolas,Menlo,monospace}.es-head{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #1e293b}.es-head h3{margin:0;font-size:14px;color:#e2e8f0;font-weight:600}.es-close{border:0;background:transparent;color:#64748b;font-size:20px;cursor:pointer;line-height:1}.es-body{padding:14px 18px;overflow:auto;flex:1;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-all}.es-line{margin:0}.es-stdout{color:#cbd5e1}.es-stderr{color:#fca5a5}.es-meta{padding:10px 18px;border-top:1px solid #1e293b;font-size:11.5px;color:#64748b;display:flex;gap:14px;flex-wrap:wrap}.es-meta b{color:#94a3b8;font-weight:600}.es-dim{color:#64748b}`;
  document.head.appendChild(css);

  async function open(reqId, jobId) {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.innerHTML = `<div class="es-overlay" data-action="es-close">
      <div class="es-modal" role="dialog" aria-modal="true" aria-label="EXEC 执行流">
        <div class="es-head"><h3>EXEC 执行流 · ${String(jobId).slice(0, 8)}…</h3><button class="es-close" data-action="es-close" aria-label="关闭">×</button></div>
        <div class="es-body" id="es-body">加载中…</div>
        <div class="es-meta" id="es-meta"></div>
      </div>
    </div>`;
    const body = document.getElementById('es-body');
    const meta = document.getElementById('es-meta');
    try {
      const r = await fetch(
        '/api/agent/exec-stream?jobId=' + encodeURIComponent(jobId),
        { headers: { accept: 'application/json' } },
      );
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.chunks || !j.chunks.length) {
        body.innerHTML = '<p class="es-dim">该作业尚无命令级输出流。</p>';
        return;
      }
      body.innerHTML = j.chunks
        .map((c) => `<div class="es-line ${c.stream === 'stderr' ? 'es-stderr' : 'es-stdout'}">${String(c.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`)
        .join('');
      meta.innerHTML = j.closed
        ? `<span>exit <b>${j.exit.exitCode}</b></span>${j.exit.timedOut ? '<span>timedOut</span>' : ''}<span>${j.chunks.length} 块</span>`
        : '<span class="es-dim">执行中…</span>';
      body.scrollTop = body.scrollHeight;
    } catch (e) {
      body.innerHTML = '<p class="es-dim">加载失败：' + String(e).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
    }
  }
  function close() {
    const root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
  }
  document.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-action="es-close"]') : null;
    if (el) close();
  });
  window.PFCExecStream = { open, close };
})();
