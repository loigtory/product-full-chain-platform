'use strict';
const fs = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const { read, repo, fault } = require('./profile');
const { connection } = require('./ops-config');
const {
  assertPrivate,
  privateDirectory,
  atomicJson,
  readJson,
  manifest,
  safeChild,
  pgTool,
} = require('./ops-files');
const { acquire } = require('./workspace-lock');
const { registry, assertReady } = require('../persistence/migrations');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function pgEnv(p) {
  const { pg } = connection(p);
  return {
    PGHOST: pg.host,
    PGPORT: String(pg.port),
    PGDATABASE: pg.database,
    PGUSER: pg.user,
    PGPASSWORD: pg.password,
    PGCONNECT_TIMEOUT: '3',
  };
}
async function snapshot(p) {
  const pool = new Pool({
    ...connection(p).pg,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
  });
  try {
    await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await pool.query("SET LOCAL timezone='UTC'");
    await pool.query('SET LOCAL search_path TO "' + p.schema + '",pg_catalog');
    await assertReady(
      {
        schema: p.schema,
        pool,
        targetVersion: p.targetVersion ?? '006',
        assertScope() {},
      },
      pool,
    );
    const names = (
      await pool.query(
        'SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',
        [p.schema],
      )
    ).rows.map((x) => x.tablename);
    const tables = [];
    for (const name of names) {
      if (!/^[a-z_]+$/.test(name)) throw fault('LOCAL_BACKUP_OBJECT_INVALID');
      const rows = (
        await pool.query(
          'SELECT to_jsonb(t)::text value FROM "' +
            p.schema +
            '"."' +
            name +
            '" t ORDER BY value',
        )
      ).rows.map((x) => x.value);
      tables.push({ name, rows: rows.length, sha256: hash(rows.join('\n')) });
    }
    const constraints = (
      await pool.query(
        'SELECT c.relname table_name,k.conname,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY 1,2',
        [p.schema],
      )
    ).rows;
    const functions = (
      await pool.query(
        'SELECT proname name,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY 1',
        [p.schema],
      )
    ).rows;
    const triggers = (
      await pool.query(
        'SELECT c.relname table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY 1,2',
        [p.schema],
      )
    ).rows;
    const indexes = (
      await pool.query(
        'SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname',
        [p.schema],
      )
    ).rows;
    const sequences = (
      await pool.query(
        'SELECT sequencename name,start_value,min_value,max_value,increment_by,cycle,cache_size FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename',
        [p.schema],
      )
    ).rows;
    for (const s of sequences) {
      if (s.name !== 'domain_events_seq_seq')
        throw fault('LOCAL_BACKUP_OBJECT_INVALID');
      s.state = (
        await pool.query(
          'SELECT last_value::text,is_called FROM "' +
            p.schema +
            '"."' +
            s.name +
            '"',
        )
      ).rows[0];
    }
    const references = (
      await pool.query(
        'SELECT file_ref path,size::int,hash sha256 FROM "' +
          p.schema +
          '".file_objects ORDER BY file_ref',
      )
    ).rows;
    const readback = {
      requirements: (
        await pool.query(
          'SELECT public_id id FROM "' + p.schema + '".reqs ORDER BY public_id',
        )
      ).rows,
      downloads: (
        await pool.query(
          'SELECT r.public_id req_id,m.public_id material_id,v.version,f.hash sha256,f.size::int FROM "' +
            p.schema +
            '".material_versions v JOIN "' +
            p.schema +
            '".materials m ON m.id=v.material_id JOIN "' +
            p.schema +
            '".reqs r ON r.id=m.req_id JOIN "' +
            p.schema +
            '".file_objects f ON f.id=v.file_id ORDER BY 1,2,3',
        )
      ).rows,
    };
    await pool.query('ROLLBACK');
    return {
      tables,
      constraints,
      functions,
      triggers,
      indexes,
      sequences,
      references,
      readback,
    };
  } finally {
    await pool.end();
  }
}
function filesMatch(root, references) {
  const actual = manifest(root, 104857600);
  const expected = references
    .map((r) => ({
      path: r.path.replace(/\\/g, '/'),
      size: r.size,
      sha256: r.sha256,
    }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  for (const item of expected) safeChild(root, item.path);
  const sorted = [...actual.files].sort((a, b) =>
    a.path.localeCompare(b.path, 'en'),
  );
  if (JSON.stringify(sorted) !== JSON.stringify(expected))
    throw fault('LOCAL_BACKUP_FILES_MISMATCH');
  return actual;
}
function registryFile(p) {
  return resolve(p.root, 'backup-registry.json');
}
function registered(p) {
  if (!fs.existsSync(registryFile(p))) return [];
  assertPrivate(registryFile(p));
  const list = readJson(registryFile(p));
  if (
    !Array.isArray(list) ||
    list.some(
      (r) =>
        r.attemptId !== p.attemptId ||
        !/^[a-f0-9-]{36}$/.test(r.id) ||
        !/^[a-f0-9]{64}$/.test(r.manifestHash),
    )
  )
    throw fault('LOCAL_BACKUP_REGISTRY_INVALID');
  return list;
}
function verify(p, id) {
  if (!/^[a-f0-9-]{36}$/.test(id || ''))
    throw fault('LOCAL_BACKUP_ID_REQUIRED', 400);
  const entry = registered(p).find((r) => r.id === id);
  if (!entry) throw fault('LOCAL_BACKUP_NOT_REGISTERED');
  const folder = safeChild(p.backupsRoot, id);
  assertPrivate(folder);
  const file = safeChild(folder, 'manifest.json');
  const m = readJson(file, 4 * 1048576);
  if (hash(fs.readFileSync(file)) !== entry.manifestHash)
    throw fault('LOCAL_BACKUP_MANIFEST_MISMATCH');
  if (
    m.format !== 1 ||
    !['006', '007'].includes(m.targetVersion ?? '006') ||
    (m.targetVersion ?? '006') !== (p.targetVersion ?? '006') ||
    m.status !== 'COMPLETE' ||
    m.id !== id ||
    m.attemptId !== p.attemptId ||
    m.schema !== p.schema ||
    JSON.stringify(m.migrations) !==
      JSON.stringify(
        registry(m.targetVersion ?? '006').map(({ version, checksum }) => ({
          version,
          checksum,
        })),
      )
  )
    throw fault('LOCAL_BACKUP_INCOMPATIBLE');
  const actual = manifest(folder);
  const content = actual.files.filter((x) => x.path !== 'manifest.json');
  if (JSON.stringify(content) !== JSON.stringify(m.packageFiles))
    throw fault('LOCAL_BACKUP_CONTENT_MISMATCH');
  filesMatch(resolve(folder, 'files'), m.snapshot.references);
  return { folder, manifest: m };
}
async function backup(target, { failAfter } = {}) {
  const p = read(target.profileFile);
  if (p.scope === 'restore' || (failAfter && p.scope !== 'source'))
    throw fault('LOCAL_OPERATION_FORBIDDEN');
  const lock = await acquire(p);
  let partial;
  try {
    const status = await require('./lifecycle').status(p);
    if (status.status !== 'STOPPED') throw fault('LOCAL_STOP_REQUIRED', 409);
    const preflight = await require('./preflight').preflight(p);
    if (preflight.status !== 'READY')
      throw fault(preflight.code || 'LOCAL_BACKUP_NOT_READY');
    const prior = registered(p);
    if (prior.length >= 7) throw fault('LOCAL_BACKUP_COUNT_LIMIT');
    privateDirectory(p.backupsRoot);
    if (
      fs
        .readdirSync(p.backupsRoot)
        .some(
          (name) =>
            !name.endsWith('.partial') && !prior.some((r) => r.id === name),
        )
    )
      throw fault('LOCAL_BACKUP_REGISTRY_INVALID');
    const used = manifest(p.backupsRoot).bytes;
    const snap = await snapshot(p),
      originals = filesMatch(p.filesRoot, snap.references);
    if (used + originals.bytes >= 1073741824)
      throw fault('LOCAL_STORAGE_LIMIT');
    const id = randomUUID();
    partial = safeChild(p.backupsRoot, id + '.partial');
    privateDirectory(partial);
    const dump = resolve(partial, 'database.dump');
    await pgTool(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--schema=' + p.schema,
        '--file=' + dump,
      ],
      pgEnv(p),
    );
    if (failAfter === 'dump') throw fault('SYNTHETIC_BACKUP_INTERRUPTED');
    privateDirectory(resolve(partial, 'files'));
    for (const item of originals.files) {
      const to = safeChild(resolve(partial, 'files'), item.path);
      fs.mkdirSync(require('node:path').dirname(to), { recursive: true });
      fs.copyFileSync(
        safeChild(p.filesRoot, item.path),
        to,
        fs.constants.COPYFILE_EXCL,
      );
    }
    filesMatch(resolve(partial, 'files'), snap.references);
    if (
      JSON.stringify(await snapshot(p)) !== JSON.stringify(snap) ||
      JSON.stringify(filesMatch(p.filesRoot, snap.references)) !==
        JSON.stringify(originals)
    )
      throw fault('LOCAL_BACKUP_SOURCE_CHANGED');
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      stdio: 'pipe',
    }).trim();
    const m = {
      format: 1,
      id,
      status: 'COMPLETE',
      createdAt: new Date().toISOString(),
      sourceCommit,
      schema: p.schema,
      attemptId: p.attemptId,
      identity: {
        tenantId: p.tenantId,
        memberId: p.memberId,
        ownerName: p.ownerName,
      },
      targetVersion: p.targetVersion ?? '006',
      migrations: registry(p.targetVersion ?? '006').map(
        ({ version, checksum }) => ({
          version,
          checksum,
        }),
      ),
      snapshot: snap,
      packageFiles: manifest(partial).files,
    };
    atomicJson(resolve(partial, 'manifest.json'), m);
    if (used + manifest(partial).bytes > 1073741824)
      throw fault('LOCAL_STORAGE_LIMIT');
    const complete = safeChild(p.backupsRoot, id);
    fs.renameSync(partial, complete);
    partial = null;
    atomicJson(registryFile(p), [
      ...prior,
      {
        id,
        attemptId: p.attemptId,
        createdAt: m.createdAt,
        manifestHash: hash(fs.readFileSync(resolve(complete, 'manifest.json'))),
      },
    ]);
    verify(p, id);
    return {
      status: 'COMPLETE',
      id,
      createdAt: m.createdAt,
      tables: snap.tables.length,
      rows: snap.tables.reduce((n, t) => n + t.rows, 0),
      files: originals.files.length,
    };
  } catch (e) {
    if (partial)
      atomicJson(resolve(partial, 'failure.json'), {
        status: 'INCOMPLETE',
        code: /^[A-Z_0-9]+$/.test(e.code || '')
          ? e.code
          : 'LOCAL_BACKUP_FAILED',
      });
    throw e;
  } finally {
    await lock.release();
  }
}
function latest(p) {
  const item = registered(p).at(-1);
  return item ? { id: item.id, createdAt: item.createdAt } : null;
}
module.exports = { backup, verify, snapshot, filesMatch, pgEnv, hash, latest };
