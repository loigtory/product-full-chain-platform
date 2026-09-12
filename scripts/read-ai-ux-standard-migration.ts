import { createDatabase } from '@pfc/persistence';
import { sql } from 'kysely';

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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('AIUX_STANDARD_MIGRATION_READBACK_TARGET_INVALID');
}

const database = createDatabase({ connectionString, maxConnections: 1 });
try {
  await database.transaction().execute(async (transaction) => {
    await sql`set transaction read only`.execute(transaction);
    const migrations = await sql<{ name: string }>`
      select name
      from public.kysely_migration
      where name in (${sql.join(targetMigrations.map((name) => sql.lit(name)))})
      order by name
    `.execute(transaction);
    const tables = await sql<{ table_name: string }>`
      select table_name
      from information_schema.tables
      where table_schema = 'pfc'
        and table_name in (${sql.join(targetTables.map((name) => sql.lit(name)))})
      order by table_name
    `.execute(transaction);
    const indexes = await sql<{ indexname: string }>`
      select indexname
      from pg_indexes
      where schemaname = 'pfc'
        and indexname in (${sql.join(targetIndexes.map((name) => sql.lit(name)))})
      order by indexname
    `.execute(transaction);
    if (
      migrations.rows.length !== targetMigrations.length ||
      tables.rows.length !== targetTables.length ||
      indexes.rows.length !== targetIndexes.length
    ) {
      throw new Error('AIUX_STANDARD_MIGRATION_READBACK_INCOMPLETE');
    }
    console.log(
      `AIUX_STANDARD_MIGRATION_READBACK_PASS database=pfc_local schema=pfc readOnly=true migrations=${migrations.rows.length} tables=${tables.rows.length} indexes=${indexes.rows.length}`,
    );
  });
} finally {
  await database.destroy();
}
