import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';
const require = createRequire(import.meta.url);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'HTTP end-to-end smoke: 007 service boot, agent status route, real-mode message job with worker failure writeback',
  tests: [],
};
const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)));
const projectRoot = resolve(serverDir, '..');
const nodeBin = resolve(
  projectRoot,
  '.tools/node-v24.20.0-win-x64/node.exe',
);
const smokeDir = resolve(projectRoot, '.local/ai-tools-http-smoke-20260914');
const filesRoot = resolve(
  projectRoot,
  '.local/m2c-2-domain-20260912/files/ai-tools-http-smoke',
);
const port = 5201;
const jwtSecret = randomUUID() + randomUUID().replaceAll('-', '');
let fixture, child, ready = false;
try {
  const { aiDatabaseFixture } = await import('./test-data/ai-tools-fixture.mjs');
  fixture = await aiDatabaseFixture('browser');
  const { migrate, assertReady } = require('./src/persistence/migrations');
  await migrate(fixture.db);
  await assertReady(fixture.db);
  const { ctx, req } = await fixture.seed();
  const db = fixture.db;
  mkdirSync(smokeDir, { recursive: true });
  mkdirSync(filesRoot, { recursive: true });
  const usersFile = resolve(smokeDir, 'users.json');
  writeFileSync(
    usersFile,
    JSON.stringify([{ name: ctx.actor, tenantId: ctx.tenantId, role: 'owner' }]),
  );
  const jwt = require('jsonwebtoken').sign(
    { sub: ctx.actor, role: 'owner', tenant: ctx.tenantId },
    jwtSecret,
    { expiresIn: '1h' },
  );
  const env = {
    ...process.env,
    PORT: String(port),
    PFC_DB: 'pg',
    DATABASE_URL: fixture.options.connectionString,
    PFC_DB_SCHEMA: db.schema,
    PFC_AUTHORIZED_SCHEMA: db.schema,
    PFC_DB_TARGET_VERSION: '007',
    JWT_SECRET: jwtSecret,
    PFC_LOCAL_USERS_FILE: usersFile,
    PFC_FILE_QUOTA_BYTES: '10485760',
    PFC_FILES_ROOT: filesRoot,
  };
  delete env.PFC_CODEX_BINARY;
  delete env.PFC_CODEX_PREFLIGHT_CWD;
  delete env.PFC_CODEX_CONNECTION_SHA256;
  delete env.PFC_CODEX_BINARY_SHA256;
  child = spawn(nodeBin, ['src/index.js'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => {
    if (report.serverLogs) report.serverLogs += d.toString();
    else report.serverLogs = d.toString();
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, 'server did not become ready');
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.schemaVersion, '007');
  assert.equal(health.readiness, true);
  report.tests.push({
    name: '007 service boots with PFC_DB_TARGET_VERSION=007',
    status: 'PASS',
  });

  const auth = { Authorization: 'Bearer ' + jwt };
  const statusRes = await fetch(base + '/api/agent/status', { headers: auth });
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json();
  assert.equal(status.provider, 'codex');
  assert.equal(status.capable, false);
  assert.ok(status.budget && typeof status.budget.remaining === 'number');
  report.tests.push({
    name: 'GET /api/agent/status returns provider + budget snapshot',
    status: 'PASS',
  });

  const reqDetail = await (
    await fetch(base + `/api/reqs/${req.public_id}`, { headers: auth })
  ).json();
  // WS client: must receive the durable failure event over the wire.
  const wsUrl = base.replace('http', 'ws') + '/ws/web?token=' + jwt;
  const wsEvents = [];
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (ev) => {
    try {
      wsEvents.push(JSON.parse(ev.data));
    } catch {}
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WS_OPEN_FAILED'));
  });
  const msgRes = await fetch(base + `/api/reqs/${req.public_id}/messages`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: 'CODEx_TEST_http冒烟',
      mode: 'real',
      commandId: randomUUID(),
      expectedRevision: reqDetail.req.revision,
    }),
  });
  assert.equal(msgRes.status, 201);
  const msgBody = await msgRes.json();
  assert.ok(msgBody.jobId, 'real mode must return jobId');
  assert.equal(msgBody.reply.status, 'generating');
  const replyId = msgBody.reply.id;
  report.tests.push({
    name: 'POST messages mode=real enqueues job and returns jobId',
    status: 'PASS',
  });

  let final = null;
  for (let i = 0; i < 30; i++) {
    const list = await (
      await fetch(base + `/api/reqs/${req.public_id}/messages?stage=idea`, {
        headers: auth,
      })
    ).json();
    const ai = (list.items || []).find((m) => m.id === replyId);
    if (ai && ai.status !== 'generating') {
      final = ai;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(final, 'ai message never left generating state');
  assert.equal(final.status, 'failed');
  assert.equal(final.error, 'CONNECTION_UNAVAILABLE');
  assert.equal(final.real, true);
  report.tests.push({
    name: 'worker failure reaches HTTP message as explicit failed state',
    status: 'PASS',
  });

  // WS incremental: message.failed must arrive with the error code.
  let failedEvent = null;
  for (let i = 0; i < 30; i++) {
    failedEvent = wsEvents.find((m) => m.type === 'message.failed') || null;
    if (failedEvent) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(failedEvent, 'WS must deliver message.failed');
  assert.equal(failedEvent.error, 'CONNECTION_UNAVAILABLE');
  assert.equal(failedEvent.reqId, req.public_id);
  report.tests.push({
    name: 'WS delivers message.failed incrementally with error code',
    status: 'PASS',
  });
  ws.close();

  const after = await (await fetch(base + '/api/agent/status', { headers: auth })).json();
  assert.equal(after.budget.remaining, status.budget.remaining);
  report.tests.push({
    name: 'no model budget consumed during HTTP smoke',
    status: 'PASS',
  });

  report.status = 'PASS';
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: e.message };
  process.exitCode = 1;
} finally {
  if (child && !child.killed) child.kill();
  await new Promise((r) => setTimeout(r, 300));
  if (fixture) await fixture.cleanup();
  rmSync(smokeDir, { recursive: true, force: true });
  rmSync(filesRoot, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const file = `${root}/http-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      file,
      error: report.error,
      serverLogs: (report.serverLogs || '').slice(-400),
    }),
  );
}
