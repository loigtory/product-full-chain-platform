import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FileMigrationProvider, Migrator } from 'kysely/migration';

import { createDatabase } from '../packages/persistence/src/index.ts';

const migrationFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../packages/persistence/src/migrations',
);
const provider = new FileMigrationProvider({
  fs,
  path,
  migrationFolder,
  import: (modulePath) => import(pathToFileURL(modulePath).href),
});

if (process.argv.includes('--dry-run')) {
  const migrations = await provider.getMigrations();
  console.log(
    `MIGRATION_PLAN names=${Object.keys(migrations).sort().join(',')}`,
  );
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');

const database = createDatabase({ connectionString, maxConnections: 1 });

try {
  const migrator = new Migrator({
    db: database,
    provider,
  });
  const result = await migrator.migrateToLatest();
  for (const migration of result.results ?? []) {
    console.log(
      `MIGRATION_${migration.status} name=${migration.migrationName}`,
    );
  }
  if (result.error) throw result.error;
  console.log('MIGRATION_PASS target=latest');
} finally {
  await database.destroy();
}
