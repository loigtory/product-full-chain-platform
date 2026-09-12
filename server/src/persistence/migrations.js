'use strict';
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { withTransaction } = require('./transaction');
const error = (code) => Object.assign(new Error(code), { code });
function baseline() {
  // Git may convert line endings on Windows; migration identity is canonical UTF-8/LF.
  const sql = readFileSync(
    resolve(__dirname, '../../sql/m2c/001-persistence-baseline.sql'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  return {
    version: '001',
    checksum: createHash('sha256').update(sql).digest('hex'),
    sql,
  };
}

const tables = [
  'schema_migrations',
  'tenants',
  'id_counters',
  'reqs',
  'req_versions',
  'audit_logs',
];
const domainTables = [
  'questions',
  'req_version_reviews',
  'file_objects',
  'materials',
  'material_versions',
  'messages',
  'message_references',
  'runs',
  'run_plans',
  'run_lines',
  'replays',
  'quality_gates',
  'leases',
  'notices',
  'notice_reads',
  'command_receipts',
  'domain_events',
];
function registry(target = '001') {
  if (!['001', '002'].includes(target))
    throw error('MIGRATION_VERSION_INVALID');
  const list = [baseline()];
  if (target === '002') {
    const sql = readFileSync(
      resolve(__dirname, '../../sql/m2c/002-domain-workspace.sql'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    list.push({
      version: '002',
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return list;
}
async function assertReady(
  db,
  queryable = db.pool,
  target = db.targetVersion || '001',
) {
  db.assertScope();
  const expected = registry(target);
  if (db.schema === 'pfc_workbench') {
    const ownership = (
      await queryable.query(
        "SELECT obj_description(oid,'pg_namespace') marker FROM pg_namespace WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)",
        [db.schema],
      )
    ).rows[0];
    if (ownership?.marker !== 'PFC_WORKBENCH_M2C_002')
      throw error('WORKBENCH_SCHEMA_OWNERSHIP_REQUIRED');
  }
  let rows;
  try {
    rows = (
      await queryable.query(
        'SELECT version,checksum FROM "' +
          db.schema +
          '".schema_migrations ORDER BY version',
      )
    ).rows;
  } catch (e) {
    if (['42P01', '3F000'].includes(e.code)) throw error('MIGRATION_NOT_READY');
    throw e;
  }
  if (
    rows.length !== expected.length ||
    rows.some((r, i) => r.version !== expected[i].version)
  )
    throw error('MIGRATION_NOT_READY');
  if (rows.some((r, i) => r.checksum !== expected[i].checksum))
    throw error('MIGRATION_CHECKSUM_MISMATCH');
  const actual = (
    await queryable.query(
      'SELECT tablename FROM pg_tables WHERE schemaname=$1',
      [db.schema],
    )
  ).rows.map((r) => r.tablename);
  if (
    ![...tables, ...(target === '002' ? domainTables : [])].every((t) =>
      actual.includes(t),
    )
  )
    throw error('MIGRATION_NOT_READY');
  if (target === '002') {
    const cols = (
      await queryable.query(
        'SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema=$1',
        [db.schema],
      )
    ).rows;
    for (const [table, names] of Object.entries({
      reqs: ['revision', 'material_revision'],
      runs: ['dispatch_id', 'dispatch_state', 'last_bridge_seq'],
      materials: ['allowed', 'usage', 'version'],
      messages: ['metadata', 'status'],
      domain_events: ['seq', 'payload'],
      command_receipts: ['fingerprint', 'result'],
    }))
      if (
        names.some(
          (name) =>
            !cols.some((c) => c.table_name === table && c.column_name === name),
        )
      )
        throw error('MIGRATION_NOT_READY');
    const constraints = (
      await queryable.query(
        'SELECT c.relname,k.contype,k.convalidated,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1',
        [db.schema],
      )
    ).rows;
    for (const table of domainTables)
      if (
        !constraints.some(
          (c) => c.relname === table && c.contype === 'p' && c.convalidated,
        )
      )
        throw error('MIGRATION_NOT_READY');
    for (const table of domainTables.filter((t) => t !== 'domain_events'))
      if (
        !constraints.some(
          (c) => c.relname === table && c.contype === 'f' && c.convalidated,
        )
      )
        throw error('MIGRATION_NOT_READY');
    for (const [table, field] of [
      ['runs', 'status'],
      ['materials', 'classification'],
      ['messages', 'status'],
      ['file_objects', 'hash'],
      ['reqs', 'revision'],
    ])
      if (
        !constraints.some(
          (c) =>
            c.relname === table &&
            c.contype === 'c' &&
            c.convalidated &&
            c.definition.includes(field),
        )
      )
        throw error('MIGRATION_NOT_READY');
  }
}
async function migrate(db, options = {}) {
  db.assertScope();
  const target = options.targetVersion || db.targetVersion || '001',
    list = registry(target);
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      db.schema,
    ]);
    const owner = (
      await client.query(
        "SELECT obj_description(oid,'pg_namespace') marker FROM pg_namespace WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)",
        [db.schema],
      )
    ).rows[0];
    if (db.schema === 'pfc_workbench') {
      if (owner?.marker !== 'PFC_WORKBENCH_M2C_002')
        throw error('WORKBENCH_SCHEMA_OWNERSHIP_REQUIRED');
    } else if (!owner?.marker?.startsWith('CODEx_TEST_M2C_')) {
      throw error('TEST_SCHEMA_OWNERSHIP_REQUIRED');
    }
    const exists = (
      await client.query('SELECT to_regclass($1) name', [
        '"' + db.schema + '".schema_migrations',
      ])
    ).rows[0].name;
    if (!exists) {
      if (
        (
          await client.query(
            'SELECT 1 FROM pg_class WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1)',
            [db.schema],
          )
        ).rowCount
      )
        throw error('MIGRATION_REQUIRES_EMPTY_SCHEMA');
      await client.query(
        'CREATE TABLE "' +
          db.schema +
          '".schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(length(checksum)=64),applied_at timestamptz NOT NULL DEFAULT now())',
      );
    }
    const rows = (
      await client.query(
        'SELECT version,checksum FROM "' +
          db.schema +
          '".schema_migrations ORDER BY version',
      )
    ).rows;
    if (
      rows.length > list.length ||
      rows.some((r, i) => r.version !== list[i]?.version)
    )
      throw error('MIGRATION_NOT_READY');
    if (rows.some((r, i) => r.checksum !== list[i].checksum))
      throw error('MIGRATION_CHECKSUM_MISMATCH');
    if (rows.length) await assertReady(db, client, rows.at(-1).version);
    for (const migration of list.slice(rows.length)) {
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO "' +
          db.schema +
          '".schema_migrations(version,checksum) VALUES($1,$2)',
        [migration.version, migration.checksum],
      );
    }
    await assertReady(db, client, target);
    return {
      applied: rows.length < list.length,
      version: target,
      checksum: list.at(-1).checksum,
    };
  });
}
module.exports = {
  baseline,
  registry,
  assertReady,
  migrate,
  tables,
  domainTables,
};
