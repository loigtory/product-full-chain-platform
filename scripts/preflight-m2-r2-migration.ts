import { createDatabase } from '@pfc/persistence';
import { sql } from 'kysely';

const targetMigration = '202609060005_create_m2_approval_control';
const requiredMigration = '202609060004_create_m2_agent_run';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('M2_R2_MIGRATION_TARGET_INVALID');
}

const database = createDatabase({ connectionString, maxConnections: 1 });
try {
  const migrations = await sql<{ name: string }>`
    select name
    from public.kysely_migration
    order by timestamp
  `.execute(database);
  const names = migrations.rows.map((row) => row.name);
  if (!names.includes(requiredMigration)) {
    throw new Error('M2_R2_REQUIRED_MIGRATION_MISSING');
  }
  if (names.includes(targetMigration)) {
    throw new Error('M2_R2_TARGET_MIGRATION_ALREADY_APPLIED');
  }
  const shape = await sql<{
    agent_runs: string | null;
    agent_run_commands: string | null;
    approval_requests: string | null;
  }>`
    select
      to_regclass('pfc.agent_runs')::text as agent_runs,
      to_regclass('pfc.agent_run_commands')::text as agent_run_commands,
      to_regclass('pfc.approval_requests')::text as approval_requests
  `.execute(database);
  const row = shape.rows[0];
  if (
    row?.agent_runs !== 'pfc.agent_runs' ||
    row.agent_run_commands !== 'pfc.agent_run_commands' ||
    row.approval_requests !== null
  ) {
    throw new Error('M2_R2_SCHEMA_PREFLIGHT_INVALID');
  }
  console.log(
    `M2_R2_MIGRATION_PREFLIGHT_PASS database=pfc_local schema=pfc required=${requiredMigration} target=${targetMigration}`,
  );
} finally {
  await database.destroy();
}
