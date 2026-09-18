// 62 号：预算/资源耗用报表面板（独立自包含；调 GET /api/agent/budget，事实源=本地账本）
(function () {
  'use strict';
  const css = document.createElement('style');
  css.textContent = `.bp-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;padding:6vh 4vw;z-index:1000}.bp-modal{background:#fff;border-radius:12px;max-width:880px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(0,0,0,.25)}.bp-head{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #e6e9f0}.bp-head h3{margin:0;font-size:16px}.bp-close{border:0;background:transparent;font-size:22px;cursor:pointer;color:#64748b;line-height:1}.bp-body{padding:16px 20px;overflow:auto}.bp-overall{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px}.bp-overall span{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;font-size:13px;color:#475569}.bp-overall b{color:#0f172a;font-size:15px}.bp-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:720px){.bp-grid{grid-template-columns:1fr}}.bp-card{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#fbfcfe}.bp-card h4{margin:0 0 10px;font-size:14px}.bp-progress{display:flex;align-items:center;gap:10px;margin-bottom:10px}.bp-track{flex:1;height:8px;background:#e2e8f0;border-radius:99px;overflow:hidden}.bp-fill{height:100%;background:#2563eb;border-radius:99px}.bp-progress span{font-size:12px;color:#475569;white-space:nowrap}.bp-status-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.bp-status{font-size:11px;padding:2px 8px;border-radius:99px;background:#e2e8f0;color:#334155}.bp-succeeded{background:#dcfce7;color:#166534}.bp-failed{background:#fee2e2;color:#991b1b}.bp-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}.bp-table caption{text-align:left;font-weight:600;font-size:12px;color:#64748b;padding:6px 0}.bp-table th,.bp-table td{border:1px solid #e6e9f0;padding:5px 8px;text-align:left}.bp-table th{background:#f8fafc;color:#475569}.bp-dim{color:#94a3b8;font-size:12px}.bp-link{font-size:11px;padding:2px 8px;border:1px solid #bfdbfe;border-radius:99px;background:#eff6ff;color:#1d4ed8;cursor:pointer}.bp-note{margin:12px 0 0}`;
  document.head.appendChild(css);
  const esc = (s) =>
    String(s ?? '—')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  function pct(turns, max) {
    return max > 0 ? Math.min(100, Math.round((turns / max) * 100)) : 0;
  }
  function ledgerCard(title, l) {
    const p = pct(l.usage.turns, l.limits.maxTurns);
    const statusRow = Object.entries(l.byStatus)
      .map(([k, v]) => `<span class="bp-status bp-${k.toLowerCase()}">${esc(k)} ${v}</span>`)
      .join('');
    return `<section class="bp-card">
      <h4>${esc(title)}</h4>
      <div class="bp-progress"><div class="bp-track"><div class="bp-fill" style="width:${p}%"></div></div><span>${l.usage.turns}/${l.limits.maxTurns} turns（${p}%）· 已用 ${l.usage.seconds}s · 剩余 ${l.usage.remainingTurns}</span></div>
      <div class="bp-status-row">${statusRow || '<span class="bp-dim">无记录</span>'}</div>
      ${
        l.byStage.length
          ? `<table class="bp-table"><caption>按阶段</caption><thead><tr><th>阶段</th><th>turns</th><th>秒</th></tr></thead><tbody>${l.byStage
              .map((s) => `<tr><td>${esc(s.stage)}</td><td>${s.turns}</td><td>${s.seconds}</td></tr>`)
              .join('')}</tbody></table>`
          : ''
      }
      ${
        l.byDay.length
          ? `<table class="bp-table"><caption>按日期</caption><thead><tr><th>日期</th><th>turns</th><th>秒</th></tr></thead><tbody>${l.byDay
              .map((d) => `<tr><td>${esc(d.date)}</td><td>${d.turns}</td><td>${d.seconds}</td></tr>`)
              .join('')}</tbody></table>`
          : ''
      }
    </section>`;
  }
  function open() {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.innerHTML = `<div class="bp-overlay" data-action="budget-close">
      <div class="bp-modal" role="dialog" aria-modal="true" aria-label="预算/资源耗用报表">
        <div class="bp-head"><h3>预算 / 资源耗用报表</h3><button class="bp-close" data-action="budget-close" aria-label="关闭">×</button></div>
        <div class="bp-body" id="bp-body">加载中…</div>
      </div>
    </div>`;
    const body = document.getElementById('bp-body');
    fetch('/api/agent/budget', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        body.innerHTML = `<div class="bp-overall">
          <span>总 turns <b>${j.overall.turns}</b></span>
          <span>总秒 <b>${j.overall.seconds}s</b></span>
          <span>EXEC 剩余 <b>${j.overall.remainingExecTurns}</b></span>
        </div>
        <div class="bp-grid">${ledgerCard('EXEC 作业账本（上限 80）', j.ledgers.exec)}${ledgerCard('Remediation 账本', j.ledgers.remediation)}</div>
        ${
          j.ledgers.exec.recent.length
            ? `<section class="bp-card"><h4>最近 EXEC 明细</h4><table class="bp-table"><thead><tr><th>attempt</th><th>状态</th><th>阶段</th><th>工具</th><th>秒</th><th>时间</th><th>执行流</th></tr></thead><tbody>${j.ledgers.exec.recent
                .map(
                  (x) =>
                    `<tr><td>${esc(x.attemptId)}</td><td>${esc(x.status)}</td><td>${esc(x.stage)}</td><td>${esc(x.tool)}</td><td>${x.seconds}</td><td>${esc(x.createdAt)}</td><td>${x.jobId ? `<button class="bp-link" onclick="window.PFCExecStream&&window.PFCExecStream.open(null,'${'${x.jobId}'}')">执行流</button>` : '—'}</td></tr>`,
                )
                .join('')}</tbody></table></section>`
            : ''
        }
        <p class="bp-dim bp-note">事实源：本地预算账本（remediation + host-exec），汇总现算不缓存。</p>`;
      })
      .catch((e) => {
        body.innerHTML = `<p class="bp-dim">加载失败：${esc(e)}</p>`;
      });
  }
  function close() {
    const root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
  }
  document.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-action="budget-close"]') : null;
    if (el) close();
  });
  window.PFCBudget = { open, close };
})();
