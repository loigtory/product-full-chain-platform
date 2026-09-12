import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDatabase } from '@pfc/persistence';
import { sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';

const targetMigration = '202609060005_create_m2_approval_control';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('M2_R2_MIGRATION_TARGET_INVALID');
}

const migrationFolder = path.resolve(
  import.meta.dirname,
  '../packages/persistence/src/migrations',
);
const database = createDatabase({ connectionString, maxConnections: 1 });
try {
  const result = await new Migrator({
    db: database,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
      import: (modulePath) => import(pathToFileURL(modulePath).href),
    }),
  }).migrateTo(targetMigration);
  if (result.error) throw result.error;
  const unexpected = (result.results ?? []).filter(
    (item) => item.migrationName !== targetMigration,
  );
  if (unexpected.length) throw new Error('M2_R2_UNEXPECTED_MIGRATION_APPLIED');
  const readback = await sql<{ name: string }>`
    select name
    from public.kysely_migration
    where name = ${targetMigration}
  `.execute(database);
  if (readback.rows.length !== 1) {
    throw new Error('M2_R2_MIGRATION_READBACK_FAILED');
  }
  console.log(
    `M2_R2_MIGRATION_PASS database=pfc_local schema=pfc target=${targetMigration}`,
  );
} finally {
  await database.destroy();
}
