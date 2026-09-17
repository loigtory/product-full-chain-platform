'use strict';
const fs = require('node:fs');
const net = require('node:net');
const { resolve } = require('node:path');
const {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { read, repo, fault } = require('./profile');
const {
  assertPrivate,
  atomicJson,
  readJson,
  processInfo,
} = require('./ops-files');
const { environment } = require('./ops-config');
const { preflight, portFree } = require('./preflight');
function buildInfo() {
  const options = {
    cwd: repo,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
    stdio: 'pipe',
  };
  return {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
    sourceDirty: !!execFileSync(
      'git',
      [
        '-c',
        'core.safecrlf=false',
        'status',
        '--porcelain',
        '--',
        'server/src',
        'output/pfc-workbench-prototype/index.html',
        'output/pfc-workbench-prototype/original',
      ],
      options,
    ).trim(),
  };
}
function pipe(p, id) {
  return (
    '\\\\.\\pipe\\pfc-local-' +
    createHash('sha256')
      .update(p.profileFile + ':' + id)
      .digest('hex')
  );
}
function record(p) {
  if (!fs.existsSync(p.instanceFile)) return null;
  assertPrivate(p.instanceFile);
  const r = readJson(p.instanceFile);
  if (
    r.profileFile !== p.profileFile ||
    r.port !== p.apiPort ||
    !/^[a-f0-9-]{36}$/.test(r.id || '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(r.secret || '') ||
    r.exe !== resolve(repo, '.tools/node-v24.20.0-win-x64/node.exe')
  )
    throw fault('LOCAL_INSTANCE_INVALID');
  return r;
}
async function status(target) {
  const p = read(target.profileFile),
    r = record(p);
  if (!r)
    return {
      status: (await portFree(p.apiPort)) ? 'STOPPED' : 'PORT_OCCUPIED',
      port: p.apiPort,
    };
  const actual = processInfo(r.pid);
  if (!actual)
    return {
      status: (await portFree(p.apiPort)) ? 'STOPPED' : 'PORT_OCCUPIED',
      stale: true,
      port: p.apiPort,
    };
  if (
    actual.exe?.toLowerCase() !== r.exe.toLowerCase() ||
    actual.started !== r.started
  )
    throw fault('LOCAL_PROCESS_IDENTITY_MISMATCH');
  const response = await fetch(
    'http://127.0.0.1:' + p.apiPort + '/api/health',
    { signal: AbortSignal.timeout(3000) },
  );
  const h = await response.json();
  if (
    !response.ok ||
    h.instanceId !== r.id ||
    h.profile !== 'personal' ||
    h.schemaVersion !== (p.targetVersion ?? '006')
  )
    throw fault('LOCAL_HEALTH_IDENTITY_MISMATCH');
  return {
    status: 'RUNNING',
    pid: r.pid,
    port: p.apiPort,
    instanceId: r.id,
    schemaVersion: p.targetVersion ?? '006',
    sourceCommit: r.sourceCommit,
    sourceDirty: r.sourceDirty,
  };
}
async function beforeStart(p) {
  const s = await status(p);
  if (s.status !== 'STOPPED')
    throw fault(
      s.status === 'RUNNING' ? 'LOCAL_ALREADY_RUNNING' : 'LOCAL_PORT_OCCUPIED',
      409,
    );
  if (s.stale) fs.unlinkSync(p.instanceFile);
}
async function attach(p, shutdown) {
  const info = processInfo(process.pid);
  if (!info || info.exe.toLowerCase() !== process.execPath.toLowerCase())
    throw fault('LOCAL_PROCESS_CHECK_FAILED');
  const r = {
    ...buildInfo(),
    ...info,
    exe: process.execPath,
    id: randomUUID(),
    secret: randomBytes(32).toString('base64url'),
    profileFile: p.profileFile,
    port: p.apiPort,
  };
  const sockets = new Set();
  const ipc = net.createServer((socket) => {
    sockets.add(socket);
    socket.setTimeout(1500, () => socket.destroy());
    let input = '';
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (b) => {
      input += b.toString();
      if (input.length > 1024) return socket.destroy();
      if (!input.includes('\n')) return;
      try {
        const q = JSON.parse(input.trim());
        if (
          q.action !== 'stop' ||
          q.id !== r.id ||
          typeof q.secret !== 'string' ||
          q.secret.length !== r.secret.length ||
          !timingSafeEqual(Buffer.from(q.secret), Buffer.from(r.secret))
        )
          return socket.destroy();
        socket.end('{"status":"STOPPING"}\n');
        void shutdown();
      } catch {
        socket.destroy();
      }
    });
  });
  await new Promise((ok, no) =>
    ipc.once('error', no).listen(pipe(p, r.id), ok),
  );
  try {
    atomicJson(p.instanceFile, r);
    assertPrivate(p.instanceFile);
  } catch (e) {
    ipc.close();
    throw e;
  }
  return {
    id: r.id,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((ok) => ipc.close(ok));
      if (record(p)?.id === r.id) fs.unlinkSync(p.instanceFile);
    },
  };
}
async function stop(target) {
  const p = read(target.profileFile),
    s = await status(p);
  if (s.status === 'STOPPED') return s;
  if (s.status !== 'RUNNING') throw fault('LOCAL_PORT_OCCUPIED');
  const r = record(p);
  await new Promise((ok, no) => {
    const socket = net.connect(pipe(p, r.id));
    socket.setTimeout(2000, () => {
      socket.destroy();
      no(fault('LOCAL_STOP_TIMEOUT'));
    });
    socket.on('error', () => no(fault('LOCAL_STOP_FAILED')));
    socket.on('connect', () =>
      socket.write(
        JSON.stringify({ action: 'stop', id: r.id, secret: r.secret }) + '\n',
      ),
    );
    socket.on('data', (b) => {
      socket.destroy();
      b.toString().includes('STOPPING') ? ok() : no(fault('LOCAL_STOP_FAILED'));
    });
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!fs.existsSync(p.instanceFile) && (await portFree(p.apiPort)))
      return { status: 'STOPPED', port: p.apiPort };
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw fault('LOCAL_STOP_TIMEOUT');
}
function log(p, code) {
  if (!/^[A-Z_0-9]+$/.test(code)) code = 'LOCAL_RUNTIME_ERROR';
  const file = resolve(p.root, 'operations.log');
  if (fs.existsSync(file) && fs.statSync(file).size >= 5 * 1048576) {
    const third = file + '.2';
    if (fs.existsSync(third)) fs.unlinkSync(third);
    if (fs.existsSync(file + '.1')) fs.renameSync(file + '.1', third);
    fs.renameSync(file, file + '.1');
  }
  fs.appendFileSync(file, new Date().toISOString() + ' ' + code + '\n');
}
async function start(target) {
  const p = read(target.profileFile),
    check = await preflight(p);
  if (check.status !== 'READY') throw fault(check.code || check.status);
  await beforeStart(p);
  const child = spawn(
    resolve(repo, '.tools/node-v24.20.0-win-x64/node.exe'),
    ['server/src/index.js'],
    {
      cwd: repo,
      env: environment(p),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let exited = false,
    failureCode;
  const exit = once(child, 'exit').then(() => {
    exited = true;
  });
  child.on('error', () => {});
  // Do not persist raw output, request content, credentials, or child command lines.
  child.stdout.on('data', () => {});
  child.stderr.on('data', (b) => {
    const code = b.toString().match(/启动失败：([A-Z_0-9]+)/)?.[1];
    if (code) failureCode = code;
    log(p, code || 'RUNTIME_ERROR');
  });
  const deadline = Date.now() + 20000;
  while (!exited && Date.now() < deadline) {
    try {
      const s = await status(p);
      if (s.status === 'RUNNING' && s.pid === child.pid) {
        log(p, 'STARTED');
        return { child, exit, info: s };
      }
    } catch {
      /* Non-authoritative diagnostic/readiness output cannot establish success. */
    }
    await new Promise((ok) => setTimeout(ok, 100));
  }
  // This handle is the exact child created above; no PID lookup/foreign process kill.
  if (!exited) {
    child.kill();
    await exit;
  }
  throw fault(failureCode || 'LOCAL_START_FAILED');
}
module.exports = { beforeStart, attach, status, start, stop, log, buildInfo };
