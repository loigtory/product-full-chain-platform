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
async function assertReady(db, queryable = db.pool) {
  db.assertScope();
  let rows;
  try {
    rows = (
      await queryable.query(
        `SELECT version,checksum FROM "${db.schema}".schema_migrations ORDER BY version`,
      )
    ).rows;
  } catch (e) {
    if (['42P01', '3F000'].includes(e.code)) throw error('MIGRATION_NOT_READY');
    throw e;
  }
  const expected = baseline();
  if (rows.length !== 1 || rows[0].version !== expected.version)
    throw error('MIGRATION_NOT_READY');
  if (rows[0].checksum !== expected.checksum)
    throw error('MIGRATION_CHECKSUM_MISMATCH');
  const tables = (
    await queryable.query(
      'SELECT tablename FROM pg_tables WHERE schemaname=$1',
      [db.schema],
    )
  ).rows.map((r) => r.tablename);
  if (
    ![
      'schema_migrations',
      'tenants',
      'id_counters',
      'reqs',
      'req_versions',
      'audit_logs',
    ].every((t) => tables.includes(t))
  ) {
    throw error('MIGRATION_NOT_READY');
  }
}
async function migrate(db) {
  db.assertScope();
  const expected = baseline();
  return withTransaction(db, async (client) => {
    // Serialize concurrent migration attempts within this exact disposable schema.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      db.schema,
    ]);
    const owner = (
      await client.query(
        `SELECT obj_description(oid,'pg_namespace') marker FROM pg_namespace
      WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`,
        [db.schema],
      )
    ).rows[0];
    if (!owner?.marker?.startsWith('CODEx_TEST_M2C_'))
      throw error('TEST_SCHEMA_OWNERSHIP_REQUIRED');
    const exists = (
      await client.query('SELECT to_regclass($1) name', [
        `"${db.schema}".schema_migrations`,
      ])
    ).rows[0].name;
    if (exists) {
      const rows = (
        await client.query(
          `SELECT version,checksum FROM "${db.schema}".schema_migrations`,
        )
      ).rows;
      if (rows.length !== 1 || rows[0].version !== expected.version)
        throw error('MIGRATION_NOT_READY');
      if (rows[0].checksum !== expected.checksum)
        throw error('MIGRATION_CHECKSUM_MISMATCH');
      await assertReady(db, client);
      return {
        applied: false,
        version: expected.version,
        checksum: expected.checksum,
      };
    }
    if (
      (
        await client.query(
          'SELECT 1 FROM pg_class WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1)',
          [db.schema],
        )
      ).rowCount
    ) {
      throw error('MIGRATION_REQUIRES_EMPTY_SCHEMA');
    }
    await client.query(`CREATE TABLE "${db.schema}".schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL CHECK(length(checksum)=64), applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(expected.sql);
    await client.query(
      `INSERT INTO "${db.schema}".schema_migrations(version,checksum) VALUES($1,$2)`,
      [expected.version, expected.checksum],
    );
    return {
      applied: true,
      version: expected.version,
      checksum: expected.checksum,
    };
  });
}
module.exports = { baseline, assertReady, migrate };
