'use strict';
const { Pool } = require('pg');
const { URL } = require('node:url');

function storageError(code) {
  return Object.assign(new Error(code), { code });
}
function validateTarget({ connectionString, schema, authorizedSchema } = {}) {
  if (
    (!/^codex_test_m2c_[a-z0-9_]{1,40}$/.test(schema || '') &&
      !/^codex_test_ai_tools_20260914_(api|real|browser|exec|execbrowser|exece2e|closedloop|control)$/.test(
        schema || '',
      ) &&
      !/^codex_test_ai_fix_20260916_(api|ops|browser)$/.test(schema || '') &&
      schema !== 'pfc_workbench') ||
    schema !== authorizedSchema
  ) {
    throw storageError('SCHEMA_NOT_AUTHORIZED');
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw storageError('PG_CONFIG_REQUIRED');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/pfc_local' ||
    url.search ||
    url.hash ||
    !url.username ||
    !url.password
  ) {
    throw storageError('PG_TARGET_NOT_AUTHORIZED');
  }
  // Build individual options: libpq/connection-string query parameters cannot override the checked host.
  const pg = {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: 'pfc_local',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
  };
  if (pg.user !== 'pfc_app_local') throw storageError('PG_ROLE_NOT_AUTHORIZED');
  if (/^codex_test_ai_tools_/.test(schema) && ![5432, 5548].includes(pg.port))
    throw storageError('PG_TARGET_NOT_AUTHORIZED');
  if (
    /^codex_test_ai_fix_/.test(schema) &&
    !(
      pg.port === 5432 ||
      (schema === 'codex_test_ai_fix_20260916_ops' && pg.port === 5549)
    )
  )
    throw storageError('PG_TARGET_NOT_AUTHORIZED');
  return { schema, pg };
}

async function openDatabase(options = {}) {
  if (options.mode === 'memory')
    return Object.freeze({ mode: 'memory', close: async () => {} });
  if (options.mode !== 'pg') throw storageError('MODE_REQUIRED');
  const { schema, pg } = validateTarget(options);
  const statementTimeout = options.statementTimeoutMs ?? 3000;
  if (
    !Number.isInteger(statementTimeout) ||
    statementTimeout < 50 ||
    statementTimeout > 10000
  )
    throw storageError('INVALID_TIMEOUT');
  const pool = new Pool({
    ...pg,
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 1000,
    statement_timeout: statementTimeout,
    idle_in_transaction_session_timeout: 5000,
    application_name:
      schema === 'pfc_workbench' ? 'pfc-workbench' : 'pfc-m2c-storage-test',
  });
  pool.on('error', () => {}); // Idle failures are not fatal to the process; every subsequent query still fails explicitly.
  let closed = false;
  const db = Object.freeze({
    mode: 'pg',
    schema,
    targetVersion: options.targetVersion || '001',
    pool,
    assertScope() {
      if (closed) throw storageError('DATABASE_CLOSED');
      if (schema !== options.authorizedSchema)
        throw storageError('SCHEMA_NOT_AUTHORIZED');
    },
    async close() {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  });
  try {
    let target;
    try {
      target = (
        await pool.query(`SELECT current_database() db,current_user role,
        current_setting('listen_addresses') listen,current_setting('server_version_num')::int version`)
      ).rows[0];
    } catch {
      throw storageError('PG_CONNECT_FAILED');
    }
    if (
      target.db !== 'pfc_local' ||
      target.role !== 'pfc_app_local' ||
      target.listen !== '127.0.0.1' ||
      target.version < 180000 ||
      target.version >= 190000
    )
      throw storageError('PG_TARGET_NOT_AUTHORIZED');
    if (options.requireReady !== false)
      await require('./migrations').assertReady(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
module.exports = { openDatabase, validateTarget, storageError };
