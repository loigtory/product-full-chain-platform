import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 3_000,
  idleTimeoutMillis: 1_000,
});

try {
  const result = await pool.query(
    "select schema_name from information_schema.schemata where schema_name like 'codex\\_test\\_%' escape '\\' order by schema_name",
  );
  if (result.rows.length > 0) {
    throw new Error(
      `TEST_SCHEMA_CLEANUP_FAILED count=${result.rows.length} schemas=${result.rows.map(({ schema_name }) => schema_name).join(',')}`,
    );
  }
  console.log('TEST_SCHEMA_CLEANUP_OK remaining=0');
} finally {
  await pool.end();
}
