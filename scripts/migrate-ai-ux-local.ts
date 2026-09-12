import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDatabase } from '@pfc/persistence';
import { sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';

const executionAuthorization =
  'POD-PFC-001_AI-UX-R1_STANDARD_LOCAL_006_007_20260907';
const requiredMigration = '202609060005_create_m2_approval_control';
const targetMigrations = [
  '202609070006_create_scoped_action_authorizations',
  '202609070007_create_product_work_sessions',
] as const;
const targetTables = [
  'product_action_proposals',
  'product_work_context_bindings',
  'product_work_session_events',
  'product_work_sessions',
  'product_work_turn_commands',
  'product_work_turns',
  'scoped_action_authorization_material_refs',
  'scoped_action_authorizations',
] as const;
const targetIndexes = [
  'pfc_product_action_proposals_pending_unique',
  'pfc_product_work_sessions_open_unique',
  'pfc_product_work_turns_active_unique',
  'product_work_turn_commands_pending_index',
  'scoped_authorizations_actor_requirement_index',
] as const;

const authorizationArgument = process.argv.find((argument) =>
  argument.startsWith('--authorization='),
);
if (authorizationArgument !== `--authorization=${executionAuthorization}`) {
  throw new Error('AIUX_STANDARD_MIGRATION_EXECUTION_NOT_AUTHORIZED');
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('AIUX_STANDARD_MIGRATION_TARGET_INVALID');
}

const migrationFolder = path.resolve(
  import.meta.dirname,
  '../packages/persistence/src/migrations',
);
const database = createDatabase({ connectionString, maxConnections: 1 });
const previousMigrationAuthorization =
  process.env.PFC_AIUX_STANDARD_MIGRATION_AUTHORIZATION;
try {
  const identity = await sql<{
    database_name: string;
    server_address: string;
    server_port: number;
  }>`
    select current_database() as database_name,
      coalesce(inet_server_addr()::text, 'local') as server_address,
      inet_server_port() as server_port
  `.execute(database);
  const server = identity.rows[0];
  const serverAddress = server?.server_address.split('/')[0];
  if (
    server?.database_name !== 'pfc_local' ||
    !serverAddress ||
    !['127.0.0.1', '::1'].includes(serverAddress) ||
    Number(server.server_port) !== 5432
  ) {
    throw new Error('AIUX_STANDARD_MIGRATION_DATABASE_IDENTITY_INVALID');
  }
  const before = await sql<{ name: string }>`
    select name
    from public.kysely_migration
    order by timestamp
  `.execute(database);
  const beforeNames = before.rows.map(({ name }) => name);
  if (!beforeNames.includes(requiredMigration)) {
    throw new Error('AIUX_STANDARD_MIGRATION_PREREQUISITE_MISSING');
  }
  if (targetMigrations.some((name) => beforeNames.includes(name))) {
    throw new Error('AIUX_STANDARD_MIGRATION_NOT_CLEAN_START');
  }
  const conflicts = await database
    .selectFrom('information_schema.tables')
    .select('table_name')
    .where('table_schema', '=', 'pfc')
    .where('table_name', 'in', [...targetTables])
    .execute();
  if (conflicts.length > 0) {
    throw new Error('AIUX_STANDARD_MIGRATION_TARGET_TABLE_CONFLICT');
  }
  const indexConflicts = await sql<{ indexname: string }>`
    select indexname
    from pg_indexes
    where schemaname = 'pfc'
      and indexname in (${sql.join(targetIndexes.map((name) => sql.lit(name)))})
  `.execute(database);
  if (indexConflicts.rows.length > 0) {
    throw new Error('AIUX_STANDARD_MIGRATION_TARGET_INDEX_CONFLICT');
  }

  const migrator = new Migrator({
    db: database,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
      import: (modulePath) => import(pathToFileURL(modulePath).href),
    }),
  });
  for (const migrationName of targetMigrations) {
    process.env.PFC_AIUX_STANDARD_MIGRATION_AUTHORIZATION = migrationName;
    const result = await migrator.migrateTo(migrationName);
    if (result.error) throw result.error;
    const changed = (result.results ?? []).filter(
      (item) => item.status === 'Success',
    );
    if (changed.length !== 1 || changed[0]?.migrationName !== migrationName) {
      throw new Error(
        `AIUX_STANDARD_MIGRATION_RESULT_INVALID:${migrationName}`,
      );
    }
  }

  const readback = await sql<{ name: string }>`
    select name
    from public.kysely_migration
    where name in (${sql.join(targetMigrations.map((name) => sql.lit(name)))})
    order by name
  `.execute(database);
  const tables = await database
    .selectFrom('information_schema.tables')
    .select('table_name')
    .where('table_schema', '=', 'pfc')
    .where('table_name', 'in', [...targetTables])
    .execute();
  if (
    readback.rows.length !== targetMigrations.length ||
    tables.length !== targetTables.length
  ) {
    throw new Error('AIUX_STANDARD_MIGRATION_READBACK_FAILED');
  }
  console.log(
    `AIUX_STANDARD_MIGRATION_PASS database=pfc_local schema=pfc targets=${targetMigrations.join(',')} tables=${tables.length} businessRowsCreated=0`,
  );
} finally {
  if (previousMigrationAuthorization === undefined) {
    delete process.env.PFC_AIUX_STANDARD_MIGRATION_AUTHORIZATION;
  } else {
    process.env.PFC_AIUX_STANDARD_MIGRATION_AUTHORIZATION =
      previousMigrationAuthorization;
  }
  await database.destroy();
}
