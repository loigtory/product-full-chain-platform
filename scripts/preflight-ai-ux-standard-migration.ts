import { sql } from 'kysely';

import { createDatabase } from '@pfc/persistence';

const requiredMigration = '202609060005_create_m2_approval_control';
const targetMigrations = [
  '202609070006_create_scoped_action_authorizations',
  '202609070007_create_product_work_sessions',
] as const;
const requiredTables = [
  'accounts',
  'bridge_registrations',
  'material_baselines',
  'material_refs',
  'requirements',
  'skill_releases',
  'teams',
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('AIUX_STANDARD_MIGRATION_TARGET_INVALID');
}

const database = createDatabase({ connectionString, maxConnections: 1 });
try {
  await database.transaction().execute(async (transaction) => {
    await sql`set transaction read only`.execute(transaction);
    const identity = await sql<{
      database_name: string;
      server_address: string;
      server_port: number;
      transaction_read_only: string;
    }>`
      select current_database() as database_name,
        coalesce(inet_server_addr()::text, 'local') as server_address,
        inet_server_port() as server_port,
        current_setting('transaction_read_only') as transaction_read_only
    `.execute(transaction);
    const migrations = await sql<{ name: string }>`
      select name
      from public.kysely_migration
      order by timestamp
    `.execute(transaction);
    const tableShape = await sql<{ table_name: string }>`
      select table_name
      from information_schema.tables
      where table_schema = 'pfc'
        and table_name in (${sql.join(
          [...requiredTables, ...targetTables].map((name) => sql.lit(name)),
        )})
      order by table_name
    `.execute(transaction);
    const indexShape = await sql<{ indexname: string }>`
      select indexname
      from pg_indexes
      where schemaname = 'pfc'
        and indexname in (${sql.join(targetIndexes.map((name) => sql.lit(name)))})
      order by indexname
    `.execute(transaction);

    const server = identity.rows[0];
    const serverAddress = server?.server_address.split('/')[0];
    if (
      server?.database_name !== 'pfc_local' ||
      !serverAddress ||
      !['127.0.0.1', '::1'].includes(serverAddress) ||
      Number(server.server_port) !== 5432 ||
      server.transaction_read_only !== 'on'
    ) {
      throw new Error(
        `AIUX_STANDARD_MIGRATION_DATABASE_IDENTITY_INVALID:database=${server?.database_name ?? 'missing'}:host=${server?.server_address ?? 'missing'}:port=${server?.server_port ?? 'missing'}:readOnly=${server?.transaction_read_only ?? 'missing'}`,
      );
    }
    const migrationNames = migrations.rows.map(({ name }) => name);
    if (!migrationNames.includes(requiredMigration)) {
      throw new Error('AIUX_STANDARD_MIGRATION_PREREQUISITE_MISSING');
    }
    if (targetMigrations.some((name) => migrationNames.includes(name))) {
      throw new Error('AIUX_STANDARD_MIGRATION_ALREADY_APPLIED');
    }
    const tableNames = tableShape.rows.map(({ table_name }) => table_name);
    if (requiredTables.some((name) => !tableNames.includes(name))) {
      throw new Error('AIUX_STANDARD_MIGRATION_REQUIRED_TABLE_MISSING');
    }
    if (targetTables.some((name) => tableNames.includes(name))) {
      throw new Error('AIUX_STANDARD_MIGRATION_TARGET_TABLE_CONFLICT');
    }
    if (indexShape.rows.length > 0) {
      throw new Error('AIUX_STANDARD_MIGRATION_TARGET_INDEX_CONFLICT');
    }

    console.log(
      `AIUX_STANDARD_MIGRATION_PREFLIGHT_PASS database=pfc_local host=${serverAddress} port=${server.server_port} schema=pfc readOnly=true required=${requiredMigration} targets=${targetMigrations.join(',')} requiredTables=${requiredTables.length} targetTablesAbsent=${targetTables.length} targetIndexesAbsent=${targetIndexes.length}`,
    );
  });
} finally {
  await database.destroy();
}
