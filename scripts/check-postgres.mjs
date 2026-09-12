import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL_REQUIRED');
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 3_000,
  idleTimeoutMillis: 1_000,
});

try {
  const result = await pool.query(
    "select current_database() as database, current_user as role, current_setting('listen_addresses') as listen_address, current_setting('port') as port",
  );
  const row = result.rows[0];
  if (
    row.database !== 'pfc_local' ||
    row.role !== 'pfc_app_local' ||
    row.listen_address !== '127.0.0.1'
  ) {
    throw new Error('POSTGRES_TARGET_MISMATCH');
  }
  console.log(
    `POSTGRES_OK database=${row.database} role=${row.role} listen=${row.listen_address}:${row.port}`,
  );
} finally {
  await pool.end();
}
