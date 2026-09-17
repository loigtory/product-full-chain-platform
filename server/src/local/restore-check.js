'use strict';
const fs = require('node:fs');
const { resolve } = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { layout, read, noLinks, prefix, fault, repo } = require('./profile');
const {
  privateDirectory,
  atomicJson,
  manifest: fileManifest,
  safeChild,
  pgTool,
  pgPath,
  processInfo,
} = require('./ops-files');
const { verify, snapshot, hash, pgEnv } = require('./backup');
const { portFree, metadata } = require('./preflight');
const { acquire } = require('./workspace-lock');
const lifecycle = require('./lifecycle');
function checkToc(text, m) {
  const tables = new Set(m.snapshot.tables.map((t) => t.name));
  const functions = new Set(m.snapshot.functions.map((f) => f.name + '()'));
  const indexes = new Set(m.snapshot.indexes.map((i) => i.indexname));
  const sequences = new Set(m.snapshot.sequences.map((s) => s.name));
  const constraints = new Set(
    m.snapshot.constraints.map((c) => c.table_name + ' ' + c.conname),
  );
  const triggers = new Set(
    m.snapshot.triggers.map((t) => t.table_name + ' ' + t.tgname),
  );
  let schemaCount = 0,
    dataCount = 0;
  for (const line of text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith(';'))) {
    const match = line.match(
      /^\d+; \d+ \d+ (FK CONSTRAINT|TABLE DATA|SEQUENCE SET|SEQUENCE|SCHEMA|COMMENT|FUNCTION|TABLE|INDEX|CONSTRAINT|TRIGGER) (\S+) (.+) pfc_app_local$/,
    );
    if (!match) throw fault('LOCAL_RESTORE_OBJECT_FORBIDDEN');
    const [, kind, scope, object] = match;
    if (kind === 'SCHEMA') {
      if (scope !== '-' || object !== m.schema)
        throw fault('LOCAL_RESTORE_OBJECT_FORBIDDEN');
      schemaCount++;
      continue;
    }
    if (kind === 'COMMENT') {
      if (scope !== '-' || object !== 'SCHEMA ' + m.schema)
        throw fault('LOCAL_RESTORE_OBJECT_FORBIDDEN');
      continue;
    }
    if (scope !== m.schema) throw fault('LOCAL_RESTORE_OBJECT_FORBIDDEN');
    const allowed = kind.startsWith('SEQUENCE')
      ? sequences.has(object)
      : kind === 'FUNCTION'
        ? functions.has(object)
        : kind === 'INDEX'
          ? indexes.has(object)
          : ['CONSTRAINT', 'FK CONSTRAINT'].includes(kind)
            ? constraints.has(object)
            : kind === 'TRIGGER'
              ? triggers.has(object)
              : tables.has(object);
    if (!allowed) throw fault('LOCAL_RESTORE_OBJECT_FORBIDDEN');
    if (kind === 'TABLE DATA') dataCount++;
  }
  if (schemaCount !== 1 || dataCount !== tables.size)
    throw fault('LOCAL_RESTORE_OBJECT_INCOMPLETE');
}
async function restoreCheck(target, id, { oldCookie, failAfter } = {}) {
  const source = read(target.profileFile);
  const timings = {};
  let lastStage = Date.now();
  const mark = (name) => {
    const now = Date.now();
    timings[name] = now - lastStage;
    lastStage = now;
  };
  if (
    source.scope === 'restore' ||
    ((oldCookie || failAfter) && source.scope !== 'source')
  )
    throw fault('LOCAL_OPERATION_FORBIDDEN');
  const lock = await acquire(source);
  let restore,
    root,
    pgInfo,
    child,
    admin,
    rootOwned = false;
  let sourceBefore, filesBefore;
  try {
    if ((await lifecycle.status(source)).status !== 'STOPPED')
      throw fault('LOCAL_STOP_REQUIRED');
    sourceBefore = await snapshot(source);
    filesBefore = fileManifest(source.filesRoot, 104857600);
    mark('sourceSnapshot');
    const packageData = verify(source, id),
      m = packageData.manifest;
    const dump = resolve(packageData.folder, 'database.dump');
    checkToc(await pgTool('pg_restore', ['--list', dump]), m);
    mark('packageCheck');
    const runId = source.remediation
      ? source.runId
      : prefix + '_' + randomUUID();
    restore = layout({
      scope: 'restore',
      runId,
      sourceScope: source.scope,
      targetVersion: m.targetVersion ?? '006',
    });
    if (!(await portFree(restore.dbPort)) || !(await portFree(restore.apiPort)))
      throw fault('LOCAL_RESTORE_PORT_OCCUPIED');
    const disk = fs.statfsSync(repo);
    if (disk.bavail * disk.bsize < 3 * 1073741824)
      throw fault('LOCAL_DISK_SPACE_REQUIRED');
    root = resolve(restore.root, '..');
    noLinks(root);
    if (fs.existsSync(root)) throw fault('LOCAL_RESTORE_TARGET_EXISTS');
    privateDirectory(root);
    rootOwned = true;
    atomicJson(resolve(root, 'ownership.json'), {
      runId,
      sourceAttempt: source.attemptId,
      backupId: id,
      port: restore.dbPort,
    });
    privateDirectory(restore.root);
    const adminPassword = randomBytes(32).toString('base64url'),
      appPassword = randomBytes(32).toString('base64url');
    const passwordFile = resolve(root, 'pg-password.txt');
    fs.writeFileSync(passwordFile, adminPassword, { flag: 'wx' });
    const data = resolve(root, 'pgdata'),
      dataAlias = pgPath(data);
    await pgTool('initdb', [
      '-D',
      dataAlias,
      '-U',
      'pfc_restore_admin',
      '--pwfile=' + pgPath(passwordFile),
      '--auth-local=scram-sha-256',
      '--auth-host=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
    ]);
    fs.unlinkSync(passwordFile);
    mark('initdb');
    fs.appendFileSync(
      resolve(data, 'postgresql.conf'),
      "\nlisten_addresses='127.0.0.1'\nport=" +
        restore.dbPort +
        "\nunix_socket_directories=''\nmax_connections=12\nshared_buffers='32MB'\nlog_statement='none'\nlog_min_error_statement='panic'\n",
    );
    await pgTool('pg_ctl', [
      '-D',
      dataAlias,
      '-l',
      pgPath(resolve(root, 'postgres.log')),
      '-w',
      '-t',
      '20',
      'start',
    ]);
    const pid = Number(
      fs
        .readFileSync(resolve(data, 'postmaster.pid'), 'utf8')
        .split(/\r?\n/)[0],
    );
    pgInfo = processInfo(pid);
    if (
      !pgInfo ||
      fs.realpathSync(pgInfo.exe).toLowerCase() !==
        fs
          .realpathSync(
            resolve(repo, '.tools/postgresql-18.6/bin/postgres.exe'),
          )
          .toLowerCase()
    )
      throw fault('LOCAL_RESTORE_PROCESS_MISMATCH');
    atomicJson(resolve(root, 'process.json'), {
      ...pgInfo,
      port: restore.dbPort,
      runId,
    });
    mark('clusterStart');
    admin = new Client({
      host: '127.0.0.1',
      port: restore.dbPort,
      database: 'postgres',
      user: 'pfc_restore_admin',
      password: adminPassword,
      connectionTimeoutMillis: 3000,
      statement_timeout: 10000,
    });
    await admin.connect();
    await admin.query(
      "CREATE ROLE pfc_app_local LOGIN PASSWORD '" + appPassword + "'",
    );
    await admin.query('CREATE DATABASE pfc_local OWNER pfc_app_local');
    await admin.end();
    admin = null;
    const connectionString =
      'postgresql://pfc_app_local:' +
      appPassword +
      '@127.0.0.1:' +
      restore.dbPort +
      '/pfc_local';
    atomicJson(resolve(restore.root, 'pg-connection.json'), {
      connectionString,
    });
    await pgTool(
      'pg_restore',
      [
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--single-transaction',
        '--dbname=pfc_local',
        dump,
      ],
      pgEnv(restore),
    );
    if (failAfter === 'restore') throw fault('SYNTHETIC_RESTORE_INTERRUPTED');
    mark('databaseRestore');
    privateDirectory(restore.filesRoot);
    for (const f of m.snapshot.references) {
      const to = safeChild(restore.filesRoot, f.path);
      fs.mkdirSync(require('node:path').dirname(to), { recursive: true });
      fs.copyFileSync(
        safeChild(resolve(packageData.folder, 'files'), f.path),
        to,
        fs.constants.COPYFILE_EXCL,
      );
    }
    const cold = await snapshot(restore);
    if (JSON.stringify(cold) !== JSON.stringify(m.snapshot))
      throw fault('LOCAL_RESTORE_DATABASE_MISMATCH');
    require('./backup').filesMatch(restore.filesRoot, m.snapshot.references);
    mark('coldReadback');
    const key = randomBytes(32).toString('base64url'),
      owned = await metadata(restore);
    const profile = {
      format: 1,
      scope: 'restore',
      targetVersion: m.targetVersion ?? '006',
      sourceScope: source.scope,
      runId,
      state: 'READY',
      attemptId: source.attemptId,
      ...m.identity,
      marker: source.marker,
      ownedOid: owned.oid,
      verifier: await require('./session-store').createVerifier(key),
      jwtSecret: randomBytes(32).toString('base64url'),
    };
    atomicJson(restore.profileFile, profile);
    fs.writeFileSync(resolve(restore.root, 'access-key.txt'), key, {
      flag: 'wx',
    });
    atomicJson(restore.usersFile, [
      { name: profile.ownerName, tenantId: profile.tenantId, role: 'owner' },
    ]);
    restore = read(restore.profileFile);
    child = await lifecycle.start(restore);
    mark('runtimeStart');
    const base = 'http://127.0.0.1:' + restore.apiPort;
    const request = (path, options = {}) =>
      fetch(base + path, {
        ...options,
        headers: {
          Origin: base,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: AbortSignal.timeout(10000),
      });
    const prior = await request('/api/auth/me', {
      headers: {
        Cookie:
          oldCookie ||
          'pfc_local_session=' + randomBytes(32).toString('base64url'),
      },
    });
    if (prior.status !== 401) throw fault('LOCAL_RESTORE_OLD_SESSION_ACCEPTED');
    const login = await request('/api/auth/local-session', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    if (!login.ok) throw fault('LOCAL_RESTORE_LOGIN_FAILED');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const json = async (path) => {
      const r = await request(path, { headers: { Cookie: cookie } });
      if (!r.ok) throw fault('LOCAL_RESTORE_API_READBACK_FAILED');
      return r.json();
    };
    for (const r of m.snapshot.readback.requirements) {
      const detail = await json('/api/reqs/' + r.id);
      if (detail.req.id !== r.id)
        throw fault('LOCAL_RESTORE_API_READBACK_FAILED');
      // Detailed requirement includes versions. Dedicated workspaces independently read linked history.
      if (
        m.snapshot.readback.requirements.length <= 3 ||
        detail.req.stage !== 'idea'
      )
        for (const suffix of [
          '/artifact-workspace',
          '/verification-workspace',
          '/release-workspace',
        ])
          await json('/api/reqs/' + r.id + suffix);
    }
    for (const f of m.snapshot.readback.downloads) {
      const r = await request(
        '/api/reqs/' +
          f.req_id +
          '/materials/' +
          f.material_id +
          '/content?version=' +
          f.version,
        { headers: { Cookie: cookie } },
      );
      if (!r.ok || hash(Buffer.from(await r.arrayBuffer())) !== f.sha256)
        throw fault('LOCAL_RESTORE_DOWNLOAD_MISMATCH');
    }
    mark('apiReadback');
    await lifecycle.stop(restore);
    await child.exit;
    child = null;
    const afterRecovery = await snapshot(restore);
    const changedAfterRecovery = afterRecovery.tables
      .filter(
        (t) => t.sha256 !== cold.tables.find((c) => c.name === t.name)?.sha256,
      )
      .map((t) => t.name);
    if (
      changedAfterRecovery.some(
        (name) =>
          name.startsWith('release_') ||
          [
            'artifact_versions',
            'artifact_groups',
            'test_results',
            'product_acceptances',
            'final_acceptances',
          ].includes(name),
      )
    )
      throw fault('LOCAL_RESTORE_HISTORY_CHANGED');
    if (fileManifest(root).bytes > 1073741824)
      throw fault('LOCAL_RESTORE_STORAGE_LIMIT');
    return {
      status: 'PASS',
      runId,
      pgPid: pgInfo.pid,
      port: restore.dbPort,
      coldDatabaseEqual: true,
      originalBytesEqual: true,
      requirements: m.snapshot.readback.requirements.length,
      downloads: m.snapshot.readback.downloads.length,
      oldSessionRejected: true,
      newSessionAccepted: true,
      changedAfterRecovery,
      timings,
      cleanup: 'PASS',
    };
  } finally {
    const cleanup = async () => {
      try {
        await admin?.end();
        if (child) {
          await lifecycle.stop(restore);
          await child.exit;
        }
        if (rootOwned) {
          const data = resolve(root, 'pgdata'),
            pidFile = resolve(data, 'postmaster.pid');
          if (fs.existsSync(pidFile)) {
            const lines = fs.readFileSync(pidFile, 'utf8').split(/\r?\n/),
              actual = processInfo(Number(lines[0]));
            if (
              !pgInfo ||
              actual?.pid !== pgInfo.pid ||
              actual.started !== pgInfo.started ||
              actual.exe !== pgInfo.exe ||
              Number(lines[3]) !== restore.dbPort ||
              resolve(lines[1]) !== pgPath(data)
            )
              throw fault('LOCAL_RESTORE_CLEANUP_NOT_OWNED');
            await pgTool('pg_ctl', [
              '-D',
              pgPath(data),
              '-w',
              '-t',
              '5',
              '-m',
              'fast',
              'stop',
            ]);
          }
          if (
            !(await portFree(restore.dbPort)) ||
            !(await portFree(restore.apiPort))
          )
            throw fault('LOCAL_RESTORE_PROCESS_REMAINS');
          const own = require('./ops-files').readJson(
            resolve(root, 'ownership.json'),
          );
          if (own.runId !== restore.runId || own.backupId !== id)
            throw fault('LOCAL_RESTORE_CLEANUP_NOT_OWNED');
          fileManifest(root);
          noLinks(root);
          fs.rmSync(root, { recursive: true });
          if (fs.existsSync(root)) throw fault('LOCAL_RESTORE_FILES_REMAIN');
        }
        if (
          sourceBefore &&
          (JSON.stringify(await snapshot(source)) !==
            JSON.stringify(sourceBefore) ||
            JSON.stringify(fileManifest(source.filesRoot, 104857600)) !==
              JSON.stringify(filesBefore))
        )
          throw fault('LOCAL_RESTORE_SOURCE_CHANGED');
      } finally {
        await lock.release();
      }
    };
    await cleanup();
    mark('cleanup');
  }
}
module.exports = { restoreCheck, checkToc };
