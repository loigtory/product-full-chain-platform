import fs from 'node:fs';
import { summarize } from '../test-support/gate-result.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const hostPackage = process.env.PFC_HOST_EXEC_TEST_PACKAGE === '48';
export const runId = hostPackage
  ? 'CODEx_TEST_AI_HOST_20260917_b601306c-a342-4a04-b27a-82080b615dd9'
  : 'CODEx_TEST_AI_FIX_20260916_2467aece-52f1-4f7c-b1de-844b759e1b1a';
export const evidenceRoot = path.join(
  repoRoot,
  hostPackage
    ? 'docs/quality-gate/reports/ai-tools-host-exec-20260917'
    : 'docs/quality-gate/reports/ai-tools-remediation-20260916',
  runId,
);
export const workRoot = path.join(
  repoRoot,
  hostPackage
    ? '.local/ai-tools-host-exec-20260917'
    : '.local/ai-tools-remediation-20260916',
  runId,
);
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function reportFor(scope) {
  return {
    at: new Date().toISOString(),
    runId,
    scope,
    status: 'FAIL',
    tests: [],
    errors: [],
    modelCalls: 0,
    data: 'deterministic synthetic only',
    cleanup: 'not applicable',
  };
}
export async function scenario(report, name, fn) {
  try {
    const details = await fn();
    report.tests.push({ name, details, status: 'PASS' });
  } catch (e) {
    const error = String(e.code || e.message).slice(0, 600);
    report.tests.push({
      name,
      error,
      status: 'FAIL',
      ...(e.code === 'ERR_ASSERTION'
        ? { assertion: String(e.message).slice(0, 1200) }
        : {}),
    });
    report.errors.push({ name, error });
  }
}
export function saveReport(report, prefix) {
  report.status = summarize(report);
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        'docs/quality-gate/reports/ai-tools-remediation-plan-20260916/implementation-package.json',
      ),
      'utf8',
    ),
  );
  const amendmentFile = path.join(
    evidenceRoot,
    'scope-amendment-connection-preflight-confirmed.json',
  );
  if (fs.existsSync(amendmentFile))
    pkg.entries.push(
      ...JSON.parse(fs.readFileSync(amendmentFile, 'utf8')).files,
    );
  if (hostPackage)
    pkg.entries.push(
      ...JSON.parse(
        fs.readFileSync(path.join(evidenceRoot, 'authorization.json')),
      ).entries,
    );
  report.source = [...new Map(pkg.entries.map((e) => [e.path, e])).values()]
    .filter((e) => fs.existsSync(path.join(repoRoot, e.path)))
    .map((e) => ({
      path: e.path,
      sha256: hash(fs.readFileSync(path.join(repoRoot, e.path))),
    }));
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const file = path.join(evidenceRoot, `${prefix}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      failures: report.errors,
      file: path.relative(repoRoot, file),
    }),
  );
  process.exitCode =
    report.status === 'PASS' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
  return file;
}
export async function patched(object, key, replacement, fn) {
  const before = object[key];
  object[key] = replacement;
  try {
    return await fn();
  } finally {
    object[key] = before;
  }
}

export async function databaseFixture(scope = 'api', version = '007') {
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const { parseEnv } = await import('node:util');
  const { randomUUID } = await import('node:crypto');
  const require = createRequire(import.meta.url);
  const { Pool } = require('pg');
  const {
    validateTarget,
    openDatabase,
  } = require('../src/persistence/connection');
  if (!['api', 'ops', 'browser'].includes(scope))
    throw Error('TEST_SCOPE_INVALID');
  const schema = 'codex_test_ai_fix_20260916_' + scope;
  if (!['006', '007'].includes(version)) throw Error('TEST_VERSION_INVALID');
  const options = {
    mode: 'pg',
    schema,
    authorizedSchema: schema,
    targetVersion: version,
    connectionString: parseEnv(
      readFileSync(new URL('../../.env.local', import.meta.url), 'utf8'),
    ).DATABASE_URL,
  };
  const { pg } = validateTarget(options);
  if (pg.port !== 5432) throw Error('TEST_PORT_INVALID');
  const admin = new Pool({
    ...pg,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  let ownedOid, db, before;
  const createdIds = [];
  const attemptId = randomUUID();
  const marker = 'CODEx_TEST_M2C_AI_FIX_20260916:' + attemptId;
  const fingerprint = async () =>
    createHash('sha256')
      .update(
        JSON.stringify(
          (
            await admin.query(
              "SELECT n.nspname,c.relname,c.relkind,a.attname,a.atttypid,a.attnotnull FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND n.nspname<>$1 ORDER BY 1,2,3,4",
              [schema],
            )
          ).rows,
        ),
      )
      .digest('hex');
  const cleanup = async () => {
    await db?.close();
    try {
      let totalRows = 0;
      if (ownedOid) {
        const owner = (
          await admin.query(
            "SELECT oid,obj_description(oid,'pg_namespace') marker FROM pg_namespace WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)",
            [schema],
          )
        ).rows[0];
        if (owner?.oid !== ownedOid || owner.marker !== marker)
          throw Error('TEST_OWNERSHIP_CHANGED');
        const m = require('../src/persistence/migrations');
        const allowed = [
          ...m.tables,
          ...m.domainTables,
          ...m.governanceTables,
          ...m.artifactTables,
          ...require('../src/persistence/verification-readiness').tables,
          ...require('../src/persistence/release-readiness').tables,
          ...require('../src/persistence/agent-jobs').tables,
        ];
        const actual = (
          await admin.query(
            'SELECT tablename FROM pg_tables WHERE schemaname=$1',
            [schema],
          )
        ).rows.map((r) => r.tablename);
        if (actual.some((t) => !allowed.includes(t)))
          throw Error('TEST_TABLE_UNEXPECTED');
        for (const table of actual)
          totalRows += Number(
            (await admin.query(`SELECT count(*) n FROM "${schema}"."${table}"`))
              .rows[0].n,
          );
        if (totalRows > 10000) throw Error('TEST_ROW_LIMIT');
        if (
          actual.includes('tenants') &&
          (
            await admin.query(
              `SELECT id FROM "${schema}".tenants WHERE left(name,$1)<>$2`,
              [runId.length, runId],
            )
          ).rowCount
        )
          throw Error('NON_SYNTHETIC_TEST_DATA');
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
      const remaining = (
        await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
          schema,
        ])
      ).rowCount;
      const unchanged = !before || before === (await fingerprint());
      if (remaining || !unchanged) throw Error('TEST_CLEANUP_MISMATCH');
      return {
        schema,
        runId,
        createdIds,
        totalRows,
        remaining,
        externalSchemaMetadataUnchanged: unchanged,
        poolsClosed: true,
      };
    } finally {
      await admin.end();
    }
  };
  try {
    const target = (
      await admin.query(
        "SELECT current_database() db,current_user role,current_setting('listen_addresses') listen,current_setting('server_version_num')::int version",
      )
    ).rows[0];
    if (
      target.db !== 'pfc_local' ||
      target.role !== 'pfc_app_local' ||
      target.listen !== '127.0.0.1' ||
      target.version < 180000 ||
      target.version >= 190000
    )
      throw Error('TEST_TARGET_MISMATCH');
    if (
      (
        await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
          schema,
        ])
      ).rowCount
    )
      throw Error('TEST_SCHEMA_EXISTS');
    before = await fingerprint();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    ownedOid = (
      await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
        schema,
      ])
    ).rows[0].oid;
    await admin.query(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`);
    db = await openDatabase({ ...options, requireReady: false });
    const seed = async () => {
      const ctx = {
        tenantId: randomUUID(),
        memberId: randomUUID(),
        actor: runId + '_owner',
        role: 'owner',
      };
      await db.pool.query(
        `INSERT INTO "${schema}".tenants(id,name) VALUES($1,$2)`,
        [ctx.tenantId, runId],
      );
      await db.pool.query(
        `INSERT INTO "${schema}".members(id,tenant_id,public_id,name,role,active) VALUES($1,$2,$3,$4,'owner',true)`,
        [ctx.memberId, ctx.tenantId, 'MEM-' + randomUUID(), ctx.actor],
      );
      const result =
        await require('../src/persistence/requirements').createRequirement(
          db,
          ctx,
          { name: runId + '_积分提醒', goal: '提前7天提醒', scope: '合成数据' },
        );
      createdIds.push(ctx.tenantId, ctx.memberId, result.requirement.id);
      return { ctx, req: result.requirement };
    };
    return {
      db,
      admin,
      options,
      runId,
      marker,
      ownedOid,
      attemptId,
      createdIds,
      cleanup,
      seed,
    };
  } catch (e) {
    if (ownedOid) await cleanup();
    else await admin.end();
    throw e;
  }
}
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
export async function profileFixture(fixture, identity, scope = 'ops') {
  const profile = require('../src/local/profile');
  const files = require('../src/local/ops-files');
  const p = profile.layout({
    scope: 'source',
    runId,
    fixtureScope: scope,
    targetVersion: fixture.db.targetVersion,
  });
  profile.noLinks(p.root);
  if (fs.existsSync(p.root)) throw Error('TEST_FILES_EXIST');
  files.privateDirectory(p.root);
  files.privateDirectory(p.filesRoot);
  const key = randomBytes(32).toString('base64url');
  files.atomicJson(p.profileFile, {
    format: 1,
    scope: 'source',
    runId,
    state: 'READY',
    targetVersion: fixture.db.targetVersion,
    attemptId: fixture.attemptId,
    tenantId: identity.ctx.tenantId,
    memberId: identity.ctx.memberId,
    ownerName: identity.ctx.actor,
    marker: fixture.marker,
    ownedOid: fixture.ownedOid,
    verifier: await require('../src/local/session-store').createVerifier(key),
    jwtSecret: randomBytes(32).toString('base64url'),
  });
  files.atomicJson(p.usersFile, [
    {
      name: identity.ctx.actor,
      tenantId: identity.ctx.tenantId,
      role: 'owner',
    },
  ]);
  const result = profile.read(p.profileFile);
  return {
    profile: result,
    key,
    async cleanup() {
      const own = profile.read(p.profileFile);
      if (
        own.attemptId !== fixture.attemptId ||
        own.runId !== runId ||
        !p.root.startsWith(workRoot + path.sep)
      )
        throw Error('TEST_FILES_NOT_OWNED');
      if (!(await require('../src/local/preflight').portFree(p.apiPort)))
        throw Error('TEST_PROCESS_REMAINS');
      profile.noLinks(p.root);
      files.manifest(p.root, 104857600);
      fs.rmSync(p.root, { recursive: true });
      return {
        remaining: fs.existsSync(p.root),
        root: path.relative(repoRoot, p.root),
      };
    },
  };
}
