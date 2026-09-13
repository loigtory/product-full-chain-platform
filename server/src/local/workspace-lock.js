'use strict';
const { Pool } = require('pg');
const { connection } = require('./ops-config');
const { fault } = require('./profile');
async function acquire(p, lost = () => {}) {
  const { pg } = connection(p);
  const pool = new Pool({
    ...pg,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
    application_name: 'pfc-local-workspace-lock',
  });
  let client,
    released = false;
  pool.on('error', () => {
    if (!released) lost();
  });
  try {
    client = await pool.connect();
    const row = (
      await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [
        'pfc-local:' + p.schema,
      ])
    ).rows[0];
    if (!row.locked) throw fault('LOCAL_WORKSPACE_BUSY', 409);
    client.on('error', () => {
      if (!released) lost();
    });
    return {
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
            'pfc-local:' + p.schema,
          ]);
        } finally {
          client.release();
          await pool.end();
        }
      },
    };
  } catch (e) {
    client?.release();
    await pool.end();
    throw e;
  }
}
module.exports = { acquire };
