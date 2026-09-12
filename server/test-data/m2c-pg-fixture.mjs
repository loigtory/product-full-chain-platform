import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
export const schema = 'codex_test_m2c_20260912_storage';
export const runId = 'CODEx_TEST_M2C_20260912_storage';
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
  };
}
const tables = [
  'schema_migrations',
  'tenants',
  'reqs',
  'req_versions',
  'audit_logs',
  'id_counters',
];
const fingerprint = async (pool) => {
  const { rows } = await pool.query(
    `SELECT n.nspname,c.relname,c.relkind,a.attname,a.atttypid,a.attnotnull
    FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid
    LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND n.nspname<>$1
    ORDER BY 1,2,3,4`,
    [schema],
  );
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
};
export async function fixture() {
  const {
    openDatabase,
    validateTarget,
  } = require('../src/persistence/connection');
  const options = config();
  const validated = validateTarget(options); // Must reject before connecting or writing.
  const admin = new Pool({
    ...validated.pg,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  let ownedOid, before, db;
  const marker = runId + ':' + randomUUID();
  const createdIds = [];
  const cleanup = async () => {
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
        if (totalRows > 200) throw Error('TEST_ROW_LIMIT');
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
      if (remaining || (before && before !== (await fingerprint(admin))))
        throw Error('CLEANUP_OR_EXTERNAL_SCHEMA_MISMATCH');
      return {
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
    before = await fingerprint(admin);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    ownedOid = (
      await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
        schema,
      ])
    ).rows[0].oid;
    await admin.query(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`); // Synthetic generated marker only.
    db = await openDatabase({ ...options, requireReady: false });
    return { db, admin, options, createdIds, cleanup };
  } catch (error) {
    if (ownedOid) await cleanup();
    else await admin.end();
    throw error;
  }
}

// Separate processes prove persistence without sharing Map/global state. No secrets in argv/stdout.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let db;
  try {
    const { openDatabase } = require('../src/persistence/connection');
    const repository = require('../src/persistence/requirements');
    db = await openDatabase(config());
    const result =
      process.argv[2] === 'write'
        ? await repository.createRequirement(db, context, {
            name: runId + '_restart',
            content: { title: '合成提醒' },
          })
        : await repository.getRequirement(db, context, process.argv[3]);
    console.log(JSON.stringify({ pid: process.pid, result }));
  } catch (e) {
    console.log(
      JSON.stringify({
        code: /^[A-Z_0-9]+$/.test(e.code || '') ? e.code : 'WORKER_FAILED',
      }),
    );
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}
