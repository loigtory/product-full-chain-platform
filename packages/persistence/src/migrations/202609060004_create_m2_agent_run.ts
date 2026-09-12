import { sql } from 'kysely';

import {
  AGENT_RUN_ACCESS_MODES,
  AGENT_RUN_EVENT_TYPES,
  AGENT_RUN_OPERATIONS,
  AGENT_RUN_STATUSES,
  SKILL_EVALUATION_STATUSES,
  SKILL_RELEASE_STATUSES,
  SKILL_RISK_LEVELS,
  SKILL_SOURCE_TYPES,
} from '@pfc/contracts';

import type { LifecycleKysely } from '../database.ts';

const protectedSchema = 'pfc';

function assertSchemaName(schemaName: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName)) {
    throw new Error('INVALID_M2_SCHEMA_NAME');
  }
}

function allowedValues(values: readonly string[]) {
  return sql.join(values.map((value) => sql.lit(value)));
}

export async function createM2AgentRunTables(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  assertSchemaName(schemaName);
  const schema = database.schema.withSchema(schemaName);
  const table = (name: string) => `${schemaName}.${name}`;

  await schema
    .createTable('skill_releases')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('skill_key', 'varchar(160)', (column) => column.notNull())
    .addColumn('display_name', 'varchar(160)', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('source_type', 'varchar(30)', (column) => column.notNull())
    .addColumn('logical_source', 'varchar(500)', (column) => column.notNull())
    .addColumn('version', 'varchar(120)', (column) => column.notNull())
    .addColumn('content_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('license', 'varchar(120)')
    .addColumn('compatible_harnesses', 'jsonb', (column) => column.notNull())
    .addColumn('required_capabilities', 'jsonb', (column) => column.notNull())
    .addColumn('risk_level', 'varchar(20)', (column) => column.notNull())
    .addColumn('owner', 'varchar(160)', (column) => column.notNull())
    .addColumn('evaluation_status', 'varchar(30)', (column) => column.notNull())
    .addColumn('enabled_scopes', 'jsonb', (column) => column.notNull())
    .addColumn('context_cost', 'integer')
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('skill_releases_key_version_unique', [
      'skill_key',
      'version',
    ])
    .addCheckConstraint(
      'skill_releases_source_type_valid',
      sql`source_type in (${allowedValues(SKILL_SOURCE_TYPES)})`,
    )
    .addCheckConstraint(
      'skill_releases_risk_valid',
      sql`risk_level in (${allowedValues(SKILL_RISK_LEVELS)})`,
    )
    .addCheckConstraint(
      'skill_releases_evaluation_valid',
      sql`evaluation_status in (${allowedValues(SKILL_EVALUATION_STATUSES)})`,
    )
    .addCheckConstraint(
      'skill_releases_status_valid',
      sql`status in (${allowedValues(SKILL_RELEASE_STATUSES)})`,
    )
    .addCheckConstraint(
      'skill_releases_hash_valid',
      sql`content_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .execute();

  await schema
    .createTable('bridge_pairings')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('team_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('teams')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('code_digest', 'varchar(80)', (column) =>
      column.notNull().unique(),
    )
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'bridge_pairings_expiry_valid',
      sql`expires_at > created_at`,
    )
    .addCheckConstraint(
      'bridge_pairings_digest_valid',
      sql`code_digest ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .execute();

  await schema
    .createTable('bridge_registrations')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('team_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('teams')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('credential_digest', 'varchar(128)', (column) =>
      column.notNull(),
    )
    .addColumn('protocol_version', 'varchar(40)', (column) => column.notNull())
    .addColumn('bridge_version', 'varchar(80)', (column) => column.notNull())
    .addColumn('node_version', 'varchar(80)', (column) => column.notNull())
    .addColumn('codex_version', 'varchar(120)')
    .addColumn('zed_version', 'varchar(120)')
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('last_heartbeat_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'bridge_registrations_status_valid',
      sql`status in ('OFFLINE', 'ONLINE', 'DEGRADED', 'REVOKED')`,
    )
    .execute();

  await schema
    .createTable('bridge_workspace_bindings')
    .addColumn('bridge_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('bridge_registrations')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('workspace_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('workspaces')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('repository_fingerprint', 'varchar(200)', (column) =>
      column.notNull(),
    )
    .addColumn('allowed_relative_path', 'varchar(500)', (column) =>
      column.notNull(),
    )
    .addColumn('verification_status', 'varchar(20)', (column) =>
      column.notNull(),
    )
    .addColumn('current_git_baseline', 'varchar(64)')
    .addColumn('verified_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addPrimaryKeyConstraint('bridge_workspace_bindings_pk', [
      'bridge_id',
      'workspace_id',
    ])
    .addCheckConstraint(
      'bridge_workspace_verification_valid',
      sql`verification_status in ('UNVERIFIED', 'VERIFIED', 'FAILED')`,
    )
    .addCheckConstraint(
      'bridge_workspace_git_baseline_valid',
      sql`current_git_baseline is null or current_git_baseline ~ '^[A-Fa-f0-9]{40}([A-Fa-f0-9]{24})?$'`,
    )
    .execute();

  await schema
    .createTable('bridge_capability_snapshots')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('bridge_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('bridge_registrations')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('capabilities', 'jsonb', (column) => column.notNull())
    .addColumn('captured_at', 'timestamptz', (column) => column.notNull())
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'bridge_capability_snapshot_expiry_valid',
      sql`expires_at > captured_at`,
    )
    .execute();

  await schema
    .createTable('bridge_message_receipts')
    .addColumn('bridge_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('bridge_registrations')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('message_id', 'varchar(200)', (column) => column.notNull())
    .addColumn('nonce', 'varchar(200)', (column) => column.notNull())
    .addColumn('sent_at', 'timestamptz', (column) => column.notNull())
    .addColumn('received_at', 'timestamptz', (column) => column.notNull())
    .addPrimaryKeyConstraint('bridge_message_receipts_pk', [
      'bridge_id',
      'message_id',
    ])
    .addUniqueConstraint('bridge_message_receipts_nonce_unique', [
      'bridge_id',
      'nonce',
    ])
    .execute();

  await schema
    .createTable('agent_runs')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('baseline_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('material_baselines')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('workspace_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('workspaces')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('git_baseline', 'varchar(64)', (column) => column.notNull())
    .addColumn('skill_release_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('skill_releases')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('operation', 'varchar(40)', (column) => column.notNull())
    .addColumn('access_mode', 'varchar(30)', (column) => column.notNull())
    .addColumn('status', 'varchar(30)', (column) => column.notNull())
    .addColumn('parent_run_id', 'varchar(160)', (column) =>
      column.references(`${table('agent_runs')}.id`).onDelete('restrict'),
    )
    .addColumn('bridge_id', 'varchar(160)', (column) =>
      column
        .references(`${table('bridge_registrations')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('codex_thread_id', 'varchar(200)')
    .addColumn('codex_turn_id', 'varchar(200)')
    .addColumn('result_summary', 'text')
    .addColumn('failure_reason', 'text')
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('created_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'agent_runs_operation_valid',
      sql`operation in (${allowedValues(AGENT_RUN_OPERATIONS)})`,
    )
    .addCheckConstraint(
      'agent_runs_access_mode_valid',
      sql`access_mode in (${allowedValues(AGENT_RUN_ACCESS_MODES)})`,
    )
    .addCheckConstraint(
      'agent_runs_status_valid',
      sql`status in (${allowedValues(AGENT_RUN_STATUSES)})`,
    )
    .addCheckConstraint(
      'agent_runs_git_baseline_valid',
      sql`git_baseline ~ '^[A-Fa-f0-9]{40}([A-Fa-f0-9]{24})?$'`,
    )
    .addCheckConstraint('agent_runs_row_version_valid', sql`row_version >= 0`)
    .execute();

  await schema
    .createTable('agent_run_events')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('run_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('agent_runs')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('sequence', 'integer', (column) => column.notNull())
    .addColumn('event_type', 'varchar(50)', (column) => column.notNull())
    .addColumn('summary', 'jsonb', (column) => column.notNull())
    .addColumn('source_bridge_id', 'varchar(160)', (column) =>
      column
        .references(`${table('bridge_registrations')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('source_event_id', 'varchar(200)')
    .addColumn('occurred_at', 'timestamptz', (column) => column.notNull())
    .addColumn('received_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('agent_run_events_run_sequence_unique', [
      'run_id',
      'sequence',
    ])
    .addCheckConstraint('agent_run_events_sequence_valid', sql`sequence > 0`)
    .addCheckConstraint(
      'agent_run_events_type_valid',
      sql`event_type in (${allowedValues(AGENT_RUN_EVENT_TYPES)})`,
    )
    .execute();

  await sql`create unique index ${sql.id(`${schemaName}_agent_run_source_event_unique`)} on ${sql.id(schemaName, 'agent_run_events')} (source_bridge_id, run_id, source_event_id) where source_event_id is not null`.execute(
    database,
  );

  await schema
    .createTable('agent_run_commands')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('run_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('agent_runs')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('command_type', 'varchar(40)', (column) => column.notNull())
    .addColumn('payload', 'jsonb', (column) => column.notNull())
    .addColumn('status', 'varchar(30)', (column) => column.notNull())
    .addColumn('lease_owner', 'varchar(160)')
    .addColumn('lease_until', 'timestamptz')
    .addColumn('attempt', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('idempotency_key', 'varchar(240)', (column) =>
      column.notNull().unique(),
    )
    .addColumn('result_summary', 'jsonb')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'agent_run_commands_type_valid',
      sql`command_type in ('START_READ_ONLY_RUN', 'INTERRUPT_RUN')`,
    )
    .addCheckConstraint(
      'agent_run_commands_status_valid',
      sql`status in ('PENDING', 'LEASED', 'ACKNOWLEDGED', 'UNKNOWN', 'FAILED')`,
    )
    .addCheckConstraint('agent_run_commands_attempt_valid', sql`attempt >= 0`)
    .execute();
}

export async function up(database: LifecycleKysely): Promise<void> {
  await createM2AgentRunTables(database, protectedSchema);
}
