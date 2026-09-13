import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
export const schema = 'codex_test_m2c_20260912_domain';
export const runId = 'CODEx_TEST_M2C_20260912_domain';
export const context = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  actor: runId,
};
export const secondContext = {
  ...context,
  tenantId: '10000000-0000-4000-8000-000000000002',
};
export function config() {
  const local =
    process.env.DATABASE_URL ||
    parseEnv(readFileSync(new URL('../../.env.local', import.meta.url), 'utf8'))
      .DATABASE_URL;
  return {
    mode: 'pg',
    connectionString: local,
    schema,
    authorizedSchema: schema,
    targetVersion: '002',
  };
}
const tables = [
  ...require('../src/persistence/migrations').domainTables,
  ...(require('../src/persistence/migrations').governanceTables || []),
  ...(require('../src/persistence/migrations').artifactTables || []),
  ...require('../src/persistence/verification-readiness').tables,
  ...require('../src/persistence/release-readiness').tables,
  'schema_migrations',
  'tenants',
  'reqs',
  'req_versions',
  'audit_logs',
  'id_counters',
];
const fingerprint = async (pool, targetSchema) => {
  const { rows } = await pool.query(
    `SELECT n.nspname,c.relname,c.relkind,a.attname,a.atttypid,a.attnotnull
    FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid
    LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND n.nspname<>$1
    ORDER BY 1,2,3,4`,
    [targetSchema],
  );
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
};
export async function fixture({
  governance = false,
  artifacts = false,
  testing = false,
  release = false,
} = {}) {
  const schema = release
    ? 'codex_test_m2c_20260913_release'
    : testing
      ? 'codex_test_m2c_20260913_verification'
      : artifacts
        ? 'codex_test_m2c_20260913_artifacts'
        : governance
          ? 'codex_test_m2c_20260913_governance'
          : 'codex_test_m2c_20260912_domain';
  const runId = release
    ? 'CODEx_TEST_M2C_20260913_release'
    : testing
      ? 'CODEx_TEST_M2C_20260913_verification'
      : artifacts
        ? 'CODEx_TEST_M2C_20260913_artifacts'
        : governance
          ? 'CODEx_TEST_M2C_20260913_governance'
          : 'CODEx_TEST_M2C_20260912_domain';
  const {
    openDatabase,
    validateTarget,
  } = require('../src/persistence/connection');
  const options = { ...config(), schema, authorizedSchema: schema };
  const validated = validateTarget(options); // Must reject before connecting or writing.
  if (validated.pg.port !== 5432) throw Error('PG_PORT_NOT_AUTHORIZED');
  const admin = new Pool({
    ...validated.pg,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  let ownedOid, before, db;
  const marker = runId + ':' + randomUUID();
  const createdIds = [];
  const base = fileURLToPath(
    new URL(
      release
        ? '../../.local/m2c-4-release-observation-20260913/files/'
        : testing
          ? '../../.local/r3-test-acceptance-20260913/files/'
          : artifacts
            ? '../../.local/r2-artifacts-20260913/files/'
            : governance
              ? '../../.local/m2c-3-governance-20260913/files/'
              : '../../.local/m2c-2-domain-20260912/files/',
      import.meta.url,
    ),
  );
  const attempt = resolve(base, runId + '_' + randomUUID()),
    filesRoot = resolve(attempt, 'blobs'),
    usersFile = resolve(attempt, 'users.json');
  const relativePath = relative(base, attempt);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    existsSync(attempt)
  )
    throw Error('FILES_TARGET_NOT_OWNED');
  let filesOwned = false;
  const processes = new Set(),
    logs = [];
  const users = [
    { name: runId + '_owner', role: 'owner', tenantId: context.tenantId },
    { name: runId + '_executor', role: 'executor', tenantId: context.tenantId },
    { name: runId + '_viewer', role: 'viewer', tenantId: context.tenantId },
    { name: runId + '_other', role: 'owner', tenantId: secondContext.tenantId },
  ];
  if (governance)
    users.push(
      { name: runId + '_owner2', role: 'owner', tenantId: context.tenantId },
      { name: runId + '_inactive', role: 'viewer', tenantId: context.tenantId },
      {
        name: runId + '_pending',
        role: 'executor',
        tenantId: context.tenantId,
      },
    );
  const env = {
    ...process.env,
    PFC_DB: 'pg',
    DATABASE_URL: options.connectionString,
    PFC_DB_SCHEMA: schema,
    PFC_AUTHORIZED_SCHEMA: schema,
    PFC_LOCAL_USERS_FILE: usersFile,
    PFC_FILES_ROOT: filesRoot,
    PFC_FILE_QUOTA_BYTES: '104857600',
    JWT_SECRET: 'CODEx_TEST_M2C_20260912_domain_synthetic_secret',
  };
  async function stopServer(child) {
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      processes.delete(child);
      return;
    }
    const exit = once(child, 'exit');
    child.kill();
    await exit;
    processes.delete(child);
  }
  async function startServer(port = 5196, overrides = {}) {
    const probe = net.createServer();
    await new Promise((ok, no) =>
      probe.once('error', no).listen(port, '127.0.0.1', ok),
    );
    await new Promise((ok) => probe.close(ok));
    const child = spawn(process.execPath, ['server/src/index.js'], {
      cwd: resolve(import.meta.dirname, '../..'),
      env: { ...env, PORT: String(port), ...overrides },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processes.add(child);
    writeFileSync(
      resolve(attempt, 'manifest.json'),
      JSON.stringify({
        schema,
        ownedOid,
        marker,
        pids: [...processes].map((p) => p.pid),
        filesRoot,
      }),
    );
    child.stdout.on('data', (b) => logs.push(String(b)));
    child.stderr.on('data', (b) => logs.push(String(b)));
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null)
        throw Error(
          'SERVER_START_FAILED:' +
            logs
              .slice(-3)
              .join('')
              .replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]'),
        );
      try {
        if ((await fetch('http://127.0.0.1:' + port + '/api/health')).ok)
          return child;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    await stopServer(child);
    throw Error('SERVER_START_TIMEOUT');
  }
  const fileManifest = () => {
    const result = [];
    if (!filesOwned) return result;
    function visit(path) {
      for (const name of readdirSync(path)) {
        const full = resolve(path, name),
          rel = relative(attempt, full),
          stat = lstatSync(full);
        if (rel.startsWith('..') || isAbsolute(rel) || stat.isSymbolicLink())
          throw Error('FILE_CLEANUP_SCOPE_MISMATCH');
        if (stat.isDirectory()) visit(full);
        else
          result.push({
            path: rel,
            size: stat.size,
            hash: createHash('sha256').update(readFileSync(full)).digest('hex'),
          });
      }
    }
    visit(attempt);
    if (result.reduce((n, f) => n + f.size, 0) > 104857600)
      throw Error('FILE_LIMIT');
    return result;
  };
  const cleanup = async () => {
    for (const child of processes) await stopServer(child);
    await db?.close();
    let totalRows = 0;
    const readback = {};
    try {
      if (ownedOid) {
        const row = (
          await admin.query(
            `SELECT oid,obj_description(oid,'pg_namespace') marker
          FROM pg_namespace WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`,
            [schema],
          )
        ).rows[0];
        if (!row || row.oid !== ownedOid || row.marker !== marker)
          throw Error('SCHEMA_OWNERSHIP_CHANGED');
        const actual = (
          await admin.query(
            `SELECT tablename FROM pg_tables WHERE schemaname=$1`,
            [schema],
          )
        ).rows.map((r) => r.tablename);
        if (actual.some((t) => !tables.includes(t)))
          throw Error('UNEXPECTED_TEST_TABLE');
        for (const table of actual)
          totalRows += Number(
            (await admin.query(`SELECT count(*) n FROM "${schema}"."${table}"`))
              .rows[0].n,
          );
        if (totalRows > (release ? 6500 : testing ? 5000 : 3000))
          throw Error('TEST_ROW_LIMIT');
        for (const table of actual) {
          const rows = (
            await admin.query(`SELECT * FROM "${schema}"."${table}"`)
          ).rows;
          if (
            ['tenants', 'reqs'].includes(table) &&
            rows.some((r) => !r.name.startsWith(runId))
          )
            throw Error('NON_SYNTHETIC_DATA_DETECTED');
          readback[table] = rows;
        }
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
      const remaining = Number(
        (
          await admin.query(
            'SELECT count(*) n FROM pg_namespace WHERE nspname=$1',
            [schema],
          )
        ).rows[0].n,
      );
      if (
        remaining ||
        (before && before !== (await fingerprint(admin, schema)))
      )
        throw Error('CLEANUP_OR_EXTERNAL_SCHEMA_MISMATCH');
      const files = fileManifest();
      if (filesOwned) {
        if (
          relative(base, attempt) !== relativePath ||
          lstatSync(attempt).isSymbolicLink()
        )
          throw Error('FILE_CLEANUP_SCOPE_MISMATCH');
        rmSync(attempt, { recursive: true });
        filesOwned = false;
      }
      return {
        files,
        filesRemaining: existsSync(attempt) ? 1 : 0,
        processesRemaining: processes.size,
        schema,
        remaining,
        totalRows,
        externalSchemaMetadataUnchanged: true,
        createdIds,
        readback,
        poolsClosed: true,
      };
    } finally {
      await admin.end();
    }
  };
  try {
    const target = (
      await admin.query(
        `SELECT current_database() db,current_user role,current_setting('listen_addresses') listen`,
      )
    ).rows[0];
    if (
      target.db !== 'pfc_local' ||
      target.role !== 'pfc_app_local' ||
      target.listen !== '127.0.0.1'
    )
      throw Error('PG_TARGET_MISMATCH');
    if (
      (
        await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
          schema,
        ])
      ).rowCount
    )
      throw Error('TEST_SCHEMA_EXISTS');
    before = await fingerprint(admin, schema);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    ownedOid = (
      await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
        schema,
      ])
    ).rows[0].oid;
    await admin.query(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`); // Synthetic generated marker only.
    db = await openDatabase({ ...options, requireReady: false });
    mkdirSync(filesRoot, { recursive: true });
    filesOwned = true;
    writeFileSync(usersFile, JSON.stringify(users));
    writeFileSync(
      resolve(attempt, 'manifest.json'),
      JSON.stringify({ schema, ownedOid, marker, pids: [], filesRoot }),
    );
    return {
      get db() {
        return db;
      },
      schema,
      runId,
      async prepareRuntime() {
        await require('../src/persistence/migrations').migrate(db, {
          targetVersion: '003',
        });
        await db.close();
        db = await openDatabase({ ...options, targetVersion: '003' });
        const { initializeMembers } =
          await import('../scripts/initialize-m2c-members.mjs');
        const initialized = await initializeMembers(
          db,
          users.filter((u) => !u.name.endsWith('_pending')),
        );
        const repeated = await initializeMembers(
          db,
          users.filter((u) => !u.name.endsWith('_pending')),
        );
        if (repeated.some((row) => row.created))
          throw Error('MEMBER_INITIALIZATION_NOT_IDEMPOTENT');
        await require('../src/persistence/migrations').migrate(db, {
          targetVersion: '004',
        });
        await db.close();
        db = await openDatabase({ ...options, targetVersion: '004' });
        await require('../src/persistence/migrations').migrate(db, {
          targetVersion: '005',
        });
        await db.close();
        db = await openDatabase({ ...options, targetVersion: '005' });
        await require('../src/persistence/migrations').migrate(db, {
          targetVersion: '006',
        });
        await db.close();
        db = await openDatabase({ ...options, targetVersion: '006' });
        return initialized;
      },
      admin,
      options,
      createdIds,
      cleanup,
      filesRoot,
      users,
      env,
      startServer,
      stopServer,
      logs,
    };
  } catch (error) {
    if (ownedOid) await cleanup();
    else await admin.end();
    throw error;
  }
}
