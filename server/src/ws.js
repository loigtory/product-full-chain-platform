'use strict';
/* =====================================================================
 * Bridge / Web 双通道 WebSocket 层（M2b）
 *   /ws/bridge?token=   本地 Bridge（Zed/Codex/VS Code 会话代理）——任务流接收方
 *   /ws/web?token=      浏览器工作台——增量行/运行状态/通知推送订阅方
 * 协议（13 号文档第四节）：
 *   服务端 → bridge: job.start {runId, reqId, operation, plan}
 *   bridge → 服务端: job.line / job.snapshot / job.done {exitCode} / job.error
 *   bridge → 服务端: heartbeat（30s；90s 未心跳 → 离线广播）
 *   服务端 → web: job.line / run.status / notice
 * 诚实标注：M2b 为协议可用版；真实终端适配（Zed 插件等）在后续 Bridge 客户端。
 * ===================================================================== */
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { S, pushAudit } = require('./domain/store');

const SECRET = process.env.JWT_SECRET || 'pfc-dev-secret-change-me';
const HEARTBEAT_MS = 30 * 1000;
const OFFLINE_MS = 90 * 1000;

let wssBridge = null;
let wssWeb = null;
const bridges = new Map(); // bridgeId -> {id, name, ws, lastHeartbeat, status, connectedAt}
const webClients = new Set();

function authOk(url) {
  try {
    const q = new URL(url, 'http://x').searchParams.get('token');
    if (!q) return null;
    const payload = jwt.verify(q, SECRET);
    return payload;
  } catch {
    return null;
  }
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  for (const c of webClients) {
    if (c.readyState === 1) {
      try {
        c.send(msg);
      } catch {
        /* ignore */
      }
    }
  }
}

/* 向在线 Bridge 派发任务；无在线 Bridge 返回 false（调用方回退模拟） */
function dispatchJob(runId, run, planText) {
  for (const b of bridges.values()) {
    if (b.status === 'ONLINE' && b.ws.readyState === 1) {
      run.bridgeId = b.id;
      run.bridgeName = b.name;
      run.executionMode = b.simulated ? 'bridge-simulation' : 'bridge-unverified';
      b.ws.send(
        JSON.stringify({
          type: 'job.start',
          runId,
          reqId: run.reqId,
          operation: run.operation,
          plan: planText,
        }),
      );
      return true;
    }
  }
  return false;
}

function bridgeList() {
  return [...bridges.values()].map((b) => ({
    id: b.id,
    name: b.name,
    status: b.status,
    connectedAt: b.connectedAt,
  }));
}

function init(server) {
  /* noServer + 手动 path 分发：多个 WSS 共用同一 http server 时，
     带 path 的 WebSocketServer 会 abort 不匹配路径的请求（400）——必须 noServer */
  wssBridge = new WebSocketServer({ noServer: true });
  wssWeb = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0];
    const target = path === '/ws/bridge' ? wssBridge : path === '/ws/web' ? wssWeb : null;
    if (!target) {
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
  });

  /* ---- Bridge 连接 ---- */
  wssBridge.on('connection', (ws, req) => {
    const user = authOk(req.url);
    if (!user || user.role !== 'bridge') {
      ws.close(4001, 'UNAUTHORIZED');
      return;
    }
    const bridgeId = user.sub || 'bridge-' + Date.now();
    const name = user.name || '本地 Bridge';
    const b = { id: bridgeId, name, ws, lastHeartbeat: Date.now(), status: 'ONLINE', connectedAt: new Date().toISOString() };
    bridges.set(bridgeId, b);
    broadcast('bridge.status', { bridgeId, name, status: 'ONLINE' });

    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type === 'heartbeat') {
        b.lastHeartbeat = Date.now();
        b.status = 'ONLINE';
        return;
      }
      if (m.type === 'bridge.hello') { b.simulated = m.simulated === true; return; }
      const assigned = S.runs.get(m.runId);
      if (!assigned || assigned.bridgeId !== bridgeId || !['RUNNING', 'CANCELLING'].includes(assigned.status)) return;
      if (m.type === 'job.cancelled' && assigned.status === 'CANCELLING') {
        assigned.status = 'CANCELLED';
        broadcast('run.status', { runId: assigned.id, reqId: assigned.reqId, status: assigned.status });
        return;
      }
      if (assigned.status === 'CANCELLING') return;
      if (m.type === 'job.line') {
        const list = S.lines.get(m.runId) || [];
        const line = { seq: list.length + 1, cls: ['info','cmd','ok','warn','error'].includes(m.cls) ? m.cls : 'info', text: String(m.text || '').slice(0, 16000), at: new Date().toISOString() };
        list.push(line);
        S.lines.set(m.runId, list);
        broadcast('job.line', { runId: m.runId, reqId: assigned.reqId, ...line });
        return;
      }
      if (m.type === 'job.snapshot') {
        const steps = S.replays.get(m.runId) || [];
        steps.push({ stepNo: m.stepNo || steps.length + 1, label: m.label || '', snapshotRef: m.snapshotRef || '' });
        S.replays.set(m.runId, steps);
        return;
      }
      if (m.type === 'job.done') {
        const run = S.runs.get(m.runId);
        if (run) {
          run.exitCode = m.exitCode;
          run.status = m.exitCode === 0 ? 'SUCCEEDED' : 'FAILED';
          run.pct = 100;
          run.step = (S.replays.get(m.runId) || []).length;
          run.revision++;
          pushAudit('Bridge:' + name, '作业完成', m.runId + ' exit=' + m.exitCode);
        }
        broadcast('run.status', { runId: m.runId, reqId: run.reqId, status: run.status, pct: 100, step: run.step, exitCode: run.exitCode, revision:run.revision });
        return;
      }
      if (m.type === 'job.error') {
        const run = S.runs.get(m.runId);
        if (run) {
          run.status = 'FAILED';
          pushAudit('Bridge:' + name, '作业失败', m.runId + '：' + (m.message || ''));
        }
        broadcast('run.status', { runId: m.runId, status: 'FAILED' });
      }
    });

    ws.on('close', () => {
      if (bridges.get(bridgeId) !== b) return;
      b.status = 'OFFLINE';
      for (const run of S.runs.values()) {
        if (run.bridgeId !== bridgeId || !['RUNNING', 'CANCELLING'].includes(run.status)) continue;
        run.status = 'UNKNOWN';
        broadcast('run.status', {runId:run.id, reqId:run.reqId, status:'UNKNOWN'});
      }
      broadcast('bridge.status', { bridgeId, name, status: 'OFFLINE' });
    });
  });

  /* ---- Web 工作台连接 ---- */
  wssWeb.on('connection', (ws, req) => {
    const user = authOk(req.url);
    if (!user) {
      ws.close(4001, 'UNAUTHORIZED');
      return;
    }
    webClients.add(ws);
    /* 握手后推送当前 Bridge 状态快照 */
    for (const b of bridges.values()) {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: 'bridge.status', bridgeId: b.id, name: b.name, status: b.status }));
        } catch {
          /* ignore */
        }
      }
    }
    ws.on('close', () => webClients.delete(ws));
    ws.on('error', () => webClients.delete(ws));
  });

  /* 心跳超时扫描 */
  setInterval(() => {
    const now = Date.now();
    for (const b of bridges.values()) {
      if (b.status === 'ONLINE' && now - b.lastHeartbeat > OFFLINE_MS) {
        b.status = 'OFFLINE';
        broadcast('bridge.status', { bridgeId: b.id, name: b.name, status: 'OFFLINE' });
      }
    }
  }, HEARTBEAT_MS);
}

function cancelJob(run) {
  const b = bridges.get(run.bridgeId);
  if (!b || b.status !== 'ONLINE' || b.ws.readyState !== 1) return false;
  b.ws.send(JSON.stringify({type:'job.cancel', runId:run.id}));
  return true;
}
module.exports = { init, dispatchJob, cancelJob, broadcast, bridgeList };
