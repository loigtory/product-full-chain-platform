(() => {
  'use strict';
  /* =====================================================================
   * PFC WebSocket 订阅层（M2b）
   * api 模式下连接 /ws/web，接收 Bridge 实时终端对话流：
   *   job.line    → 追加到对应 run.lines（终端面板实时滚动）
   *   run.status  → 更新 run 状态 / pct / step
   *   notice      → 通知中心 + toast
   *   bridge.status → 更新 P.s.bridges（Bridge 状态页）
   * 断线 5s 自动重连。非 api 模式不连接。
   * ===================================================================== */
  const W = (window.PFCWS = window.PFCWS || {});
  let ws = null;
  let timer = null;
  let stopped = false;

  W.connect = () => {
    try {
      if (stopped) return;
      if (!window.PFCStore || window.PFCStore.mode !== 'api') return;
      if (!window.PFCAPI || !window.PFCAPI.api) return;
      const base = window.PFC_API_BASE || '';
      if (!base) return;
      const token = window.PFCAPI.api.token();
      if (!token) return;
      const wsUrl = base.replace(/^http/, 'ws') + '/ws/web?token=' + encodeURIComponent(token);
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        console.log('[pfc-ws] 已连接 ' + wsUrl.split('?')[0]);
      };
      ws.onmessage = (ev) => {
        try {
          W.handle(JSON.parse(String(ev.data)));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (!stopped) timer = setTimeout(W.connect, 5000);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* ignore */
    }
  };

  W.handle = (m) => {
    const P = window.PFC;
    if (!P || !P.s) return;
    try {
      if (m.type === 'job.line') {
        const run = (P.s.runs || []).find((r) => r.id === m.runId);
        if (run) {
          run.lines = run.lines || [];
          run.lines.push({ cls: m.cls || 'info', text: m.text || '' });
          P.save();
          P.render();
        }
      } else if (m.type === 'run.status') {
        const run = (P.s.runs || []).find((r) => r.id === m.runId);
        if (run) {
          if (m.status) run.status = m.status;
          if (typeof m.pct === 'number') run.pct = m.pct;
          if (typeof m.step === 'number') run.step = m.step;
          P.save();
          P.render();
        }
      } else if (m.type === 'notice') {
        P.s.notices = P.s.notices || [];
        P.s.notices.unshift({
          id: 'NT-WS-' + Date.now(),
          title: m.title || '新通知',
          kind: m.kind || 'info',
          read: false,
          at: new Date().toISOString(),
        });
        P.save();
        P.render();
        if (P.toast) P.toast(m.title || '新通知');
      } else if (m.type === 'bridge.status') {
        P.s.bridges = P.s.bridges || [];
        const hit = P.s.bridges.find((b) => b.id === m.bridgeId);
        if (hit) hit.status = m.status;
        else {
          P.s.bridges.push({
            id: m.bridgeId,
            name: m.name || '本地 Bridge',
            status: m.status,
            workspace: 'D:\\Projects\\pfc-workspace',
          });
        }
        P.save();
        P.render();
      }
    } catch {
      /* 渲染失败不阻断推送 */
    }
  };

  W.disconnect = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      ws && ws.close();
    } catch {
      /* ignore */
    }
  };
})();
