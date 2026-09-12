import { sql } from 'kysely';

import { createDatabase } from '@pfc/persistence';

const expectedTables = [
  'account_invitations',
  'accounts',
  'artifact_versions',
  'artifacts',
  'requirement_assignments',
  'requirement_workspaces',
  'sessions',
  'team_memberships',
  'teams',
  'workspaces',
] as const;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('M1_MIGRATION_TARGET_INVALID');
}

const database = createDatabase({ connectionString, maxConnections: 1 });
try {
  const identity = await sql<{
    database_name: string;
    server_address: string;
    server_port: number;
  }>`select current_database() as database_name,
      coalesce(inet_server_addr()::text, 'local') as server_address,
      inet_server_port() as server_port`.execute(database);
  const existing = await database
    .selectFrom('information_schema.tables')
    .select('table_name')
    .where('table_schema', '=', 'pfc')
    .where('table_name', 'in', expectedTables)
    .orderBy('table_name')
    .execute();
  const existingNames = existing.map((row) => row.table_name);
  const missing = expectedTables.filter(
    (name) => !existingNames.includes(name),
  );
  console.log(
    `M1_MIGRATION_PREFLIGHT_PASS database=${identity.rows[0]?.database_name} host=${identity.rows[0]?.server_address} port=${identity.rows[0]?.server_port} schema=pfc existing=${existingNames.join(',') || 'none'} missing=${missing.join(',') || 'none'}`,
  );
} finally {
  await database.destroy();
}
