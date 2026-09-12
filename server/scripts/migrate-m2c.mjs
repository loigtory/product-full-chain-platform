import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../src/persistence/connection');
const { migrate } = require('../src/persistence/migrations');
let db;
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--schema')
    throw Object.assign(Error('BAD_ARGUMENTS'), { code: 'BAD_ARGUMENTS' });
  db = await openDatabase({
    mode: 'pg',
    connectionString: process.env.DATABASE_URL,
    schema: process.argv[3],
    authorizedSchema: process.env.PFC_M2C_AUTHORIZED_SCHEMA,
    requireReady: false,
  });
  console.log(JSON.stringify(await migrate(db)));
} catch (e) {
  console.log(
    JSON.stringify({
      status: 'FAIL',
      code: /^[A-Z_0-9]{2,60}$/.test(e.code || '')
        ? e.code
        : 'MIGRATION_FAILED',
    }),
  );
  process.exitCode = 1;
} finally {
  await db?.close();
}
