'use strict';
// Transport owns sockets only. Business events are handled by the domain service.
const { WebSocketServer } = require('ws'),
  jwt = require('jsonwebtoken'),
  runtime = require('./runtime');
const SECRET = process.env.JWT_SECRET || 'pfc-dev-secret-change-me';
const bridges = new Map(),
  webClients = new Set();
let wssBridge, wssWeb, heartbeat;
function auth(url) {
  try {
    const token = new URL(url, 'http://127.0.0.1').searchParams.get('token');
    return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}
async function broadcast(type, payload, tenantId) {
  const msg = JSON.stringify({ type, ...payload });
  if (Buffer.byteLength(msg) > 65536) return;
  for (const c of webClients) {
    if (runtime.isPg() && c.tenantId !== tenantId) continue;
    if (c.readyState !== 1) continue;
    if (c.bufferedAmount > 65536 * 1000) {
      c.close(4008, 'SLOW_CLIENT_RESYNC');
      continue;
    }
    try {
      if (runtime.isPg()) {
        if (c.claims.exp * 1000 <= Date.now()) {
          c.close(4001, 'TOKEN_EXPIRED');
          continue;
        }
        await require('./domain/membership-policy').authorizePush(
          runtime.db(),
          c.identity,
          () => {
            if (c.readyState === 1) c.send(msg);
          },
        );
      } else c.send(msg);
    } catch {
      c.close(4003, 'MEMBERSHIP_RESYNC');
    }
  }
}
function selectBridge(tenantId) {
  return (
    [...bridges.values()].find(
      (b) =>
        b.status === 'ONLINE' &&
        b.ws.readyState === 1 &&
        (!runtime.isPg() || (b.tenantId === tenantId && b.simulated)),
    ) || null
  );
}
function sendJob(bridgeId, message) {
  const b = bridges.get(bridgeId);
  if (!b || b.status !== 'ONLINE' || b.ws.readyState !== 1) return false;
  try {
    b.ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}
function dispatchJob(runId, run, plan) {
  const b = selectBridge();
  if (!b) return false;
  require('./domain/execution-service').memory.attachDispatch(run, b);
  return sendJob(b.id, {
    type: 'job.start',
    runId,
    reqId: run.reqId,
    operation: run.operation,
    plan,
  });
}
function cancelJob(run) {
  return sendJob(run.bridgeId, {
    type: 'job.cancel',
    runId: run.id,
    dispatchId: run.dispatchId,
  });
}
function bridgeList(tenantId) {
  return [...bridges.values()]
    .filter((b) => !runtime.isPg() || b.tenantId === tenantId)
    .map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      connectedAt: b.connectedAt,
      simulated: b.simulated,
    }));
}
function domain() {
  const service = require('./domain/execution-service');
  return runtime.isPg() ? service : service.memory;
}
async function offline(b) {
  if (bridges.get(b.id) !== b || b.status === 'OFFLINE') return;
  b.status = 'OFFLINE';
  try {
    await domain().disconnected(b.tenantId, b.id);
  } catch {}
  broadcast(
    'bridge.status',
    { bridgeId: b.id, name: b.name, status: 'OFFLINE' },
    b.tenantId,
  );
}
function init(server) {
  wssBridge = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  wssWeb = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on('upgrade', (req, socket, head) => {
    const path = req.url.split('?')[0],
      target =
        path === '/ws/bridge' ? wssBridge : path === '/ws/web' ? wssWeb : null;
    if (!target) return socket.destroy();
    target.handleUpgrade(req, socket, head, (ws) =>
      target.emit('connection', ws, req),
    );
  });
  wssBridge.on('connection', (ws, req) => {
    const user = auth(req.url);
    if (
      !user ||
      user.role !== 'bridge' ||
      (runtime.isPg() && (!user.tenant || user.simulated !== true))
    ) {
      ws.close(4001, 'UNAUTHORIZED');
      return;
    }
    if (bridges.has(user.sub) && bridges.get(user.sub).status === 'ONLINE') {
      ws.close(4009, 'DUPLICATE_BRIDGE');
      return;
    }
    const b = {
      id: user.sub,
      name: user.name || '模拟 Bridge',
      tenantId: user.tenant,
      simulated: runtime.isPg(),
      ws,
      lastHeartbeat: Date.now(),
      status: 'ONLINE',
      connectedAt: new Date().toISOString(),
    };
    bridges.set(b.id, b);
    let chain = Promise.resolve(),
      pending = 0;
    broadcast(
      'bridge.status',
      { bridgeId: b.id, name: b.name, status: 'ONLINE' },
      b.tenantId,
    );
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return ws.close(4002, 'INVALID_JSON');
      }
      if (m.type === 'heartbeat') {
        b.lastHeartbeat = Date.now();
        return;
      }
      if (m.type === 'bridge.hello') {
        if (runtime.isPg() && m.simulated !== true)
          return ws.close(4003, 'SIMULATION_REQUIRED');
        b.simulated = m.simulated === true;
        return;
      }
      if (++pending > 1000) {
        ws.close(4008, 'EVENT_BACKPRESSURE');
        return;
      }
      chain = chain
        .then(() => domain().receive(b, m))
        .catch((e) => {
          if (ws.readyState === 1)
            ws.send(
              JSON.stringify({
                type: 'protocol.error',
                code: e.status ? e.code : 'STORAGE_UNAVAILABLE',
                runId: m.runId,
              }),
            );
        })
        .finally(() => pending--);
    });
    ws.on('close', () => {
      void chain.finally(() => offline(b));
    });
    ws.on('error', () => {
      void offline(b);
    });
  });
  wssWeb.on('connection', async (ws, req) => {
    const user = auth(req.url);
    if (!user || user.role === 'bridge') {
      ws.close(4001, 'UNAUTHORIZED');
      return;
    }
    ws.on('error', () => webClients.delete(ws));
    ws.on('close', () => webClients.delete(ws));
    try {
      ws.identity = runtime.isPg()
        ? await require('./domain/membership-policy').identity(
            runtime.db(),
            user,
            runtime.config().users,
          )
        : user;
      ws.claims = user;
      ws.tenantId = user.tenant;
      if (ws.readyState !== 1) return;
      webClients.add(ws);
      const sendInitial = () => {
        for (const b of bridges.values())
          if (!runtime.isPg() || b.tenantId === user.tenant)
            ws.send(
              JSON.stringify({
                type: 'bridge.status',
                bridgeId: b.id,
                name: b.name,
                status: b.status,
              }),
            );
      };
      if (runtime.isPg())
        await require('./domain/membership-policy').authorizePush(
          runtime.db(),
          ws.identity,
          sendInitial,
        );
      else sendInitial();
      let pending = false;
      ws.on('message', async () => {
        if (pending) return ws.close(4008, 'EVENT_BACKPRESSURE');
        pending = true;
        try {
          if (runtime.isPg())
            await require('./domain/membership-policy').authorizePush(
              runtime.db(),
              ws.identity,
              () => {},
            );
        } catch {
          ws.close(4003, 'MEMBERSHIP_RESYNC');
        } finally {
          pending = false;
        }
      });
    } catch {
      ws.close(4003, 'MEMBERSHIP_RESYNC');
    }
  });
  heartbeat = setInterval(() => {
    for (const b of bridges.values())
      if (b.status === 'ONLINE' && Date.now() - b.lastHeartbeat > 90000) {
        void offline(b);
        b.ws.close(4000, 'HEARTBEAT_TIMEOUT');
      }
  }, 30000);
  heartbeat.unref();
}
function close() {
  clearInterval(heartbeat);
  for (const ws of webClients) ws.terminate();
  for (const b of bridges.values()) b.ws.terminate();
  wssBridge?.close();
  wssWeb?.close();
}
module.exports = {
  init,
  close,
  broadcast,
  selectBridge,
  sendJob,
  dispatchJob,
  cancelJob,
  bridgeList,
};
