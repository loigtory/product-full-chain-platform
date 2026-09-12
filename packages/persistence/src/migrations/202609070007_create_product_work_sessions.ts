import { sql } from 'kysely';

import {
  ACTION_PROPOSAL_KINDS,
  ACTION_PROPOSAL_STATUSES,
  CONTEXT_BINDING_ROLES,
  LIFECYCLE_STAGES,
  PRODUCT_WORK_CONTEXT_TYPES,
  PRODUCT_WORK_SESSION_EVENT_TYPES,
  PRODUCT_WORK_SESSION_STATUSES,
  PRODUCT_WORK_TURN_STATUSES,
  SENSITIVITY_LEVELS,
} from '@pfc/contracts';
import type { LifecycleKysely } from '../database.ts';

const migrationName = '202609070007_create_product_work_sessions';

function allowedValues(values: readonly string[]) {
  return sql.join(values.map((value) => sql.lit(value)));
}

function assertIsolatedSchema(schemaName: string): void {
  if (!/^codex_test_(?:aiux|m2r3)_[a-z0-9_]{1,40}$/.test(schemaName)) {
    throw new Error('AIUX_ISOLATED_SCHEMA_REQUIRED');
  }
}

async function createTables(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  const schema = database.schema.withSchema(schemaName);
  const table = (name: string) => `${schemaName}.${name}`;
  await schema
    .createTable('product_work_sessions')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('team_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('teams')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('opened_requirement_version', 'integer', (column) =>
      column.notNull(),
    )
    .addColumn('current_requirement_version', 'integer', (column) =>
      column.notNull(),
    )
    .addColumn('opened_baseline_id', 'varchar(160)', (column) =>
      column
        .references(`${table('material_baselines')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('opened_stage', 'varchar(8)', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('control_surface', 'varchar(20)', (column) => column.notNull())
    .addColumn('active_turn_id', 'varchar(200)')
    .addColumn('last_sequence', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('owner_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('title', 'varchar(120)')
    .addColumn('block_reason', 'varchar(200)')
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
    .addColumn('archived_at', 'timestamptz')
    .addCheckConstraint(
      'product_work_sessions_versions_valid',
      sql`opened_requirement_version >= 0 and current_requirement_version >= opened_requirement_version`,
    )
    .addCheckConstraint(
      'product_work_sessions_stage_valid',
      sql`opened_stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint(
      'product_work_sessions_status_valid',
      sql`status in (${allowedValues(PRODUCT_WORK_SESSION_STATUSES)})`,
    )
    .addCheckConstraint(
      'product_work_sessions_control_valid',
      sql`control_surface = 'WEB'`,
    )
    .addCheckConstraint(
      'product_work_sessions_state_shape_valid',
      sql`(status = 'BLOCKED' and block_reason is not null) or (status <> 'BLOCKED' and block_reason is null)`,
    )
    .addCheckConstraint(
      'product_work_sessions_archive_shape_valid',
      sql`(status = 'ARCHIVED' and archived_at is not null) or (status <> 'ARCHIVED' and archived_at is null)`,
    )
    .addCheckConstraint(
      'product_work_sessions_counters_valid',
      sql`last_sequence >= 0 and row_version >= 0`,
    )
    .execute();

  await schema
    .createTable('product_work_turns')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('session_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('product_work_sessions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('sequence', 'integer', (column) => column.notNull())
    .addColumn('intent_kind', 'varchar(80)', (column) => column.notNull())
    .addColumn('input_text', 'text', (column) => column.notNull())
    .addColumn('visible_response', 'text')
    .addColumn('status', 'varchar(30)', (column) => column.notNull())
    .addColumn('skill_release_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('skill_releases')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('bridge_id', 'varchar(160)', (column) =>
      column
        .references(`${table('bridge_registrations')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('external_thread_id', 'varchar(200)')
    .addColumn('external_turn_id', 'varchar(200)')
    .addColumn('usage_summary', 'jsonb')
    .addColumn('failure_reason', 'varchar(500)')
    .addColumn('recovery_action', 'varchar(160)')
    .addColumn('content_retention_until', 'timestamptz')
    .addColumn('redacted_at', 'timestamptz')
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
    .addColumn('terminal_at', 'timestamptz')
    .addUniqueConstraint('product_work_turns_session_sequence_unique', [
      'session_id',
      'sequence',
    ])
    .addCheckConstraint('product_work_turns_sequence_valid', sql`sequence > 0`)
    .addCheckConstraint(
      'product_work_turns_input_valid',
      sql`char_length(input_text) between 1 and 8000`,
    )
    .addCheckConstraint(
      'product_work_turns_response_valid',
      sql`visible_response is null or char_length(visible_response) <= 32000`,
    )
    .addCheckConstraint(
      'product_work_turns_status_valid',
      sql`status in (${allowedValues(PRODUCT_WORK_TURN_STATUSES)})`,
    )
    .addCheckConstraint(
      'product_work_turns_version_valid',
      sql`row_version >= 0`,
    )
    .execute();

  await schema
    .alterTable('product_work_sessions')
    .addForeignKeyConstraint(
      'product_work_sessions_active_turn_fk',
      ['active_turn_id'],
      table('product_work_turns'),
      ['id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .execute();

  await schema
    .createTable('product_work_context_bindings')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('session_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('product_work_sessions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('turn_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('product_work_turns')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('context_type', 'varchar(40)', (column) => column.notNull())
    .addColumn('target_id', 'varchar(200)', (column) => column.notNull())
    .addColumn('target_version', 'integer')
    .addColumn('content_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('binding_role', 'varchar(20)', (column) => column.notNull())
    .addColumn('sensitivity', 'varchar(20)', (column) => column.notNull())
    .addColumn('invalidated_at', 'timestamptz')
    .addColumn('reason_code', 'varchar(200)')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('product_work_context_binding_identity_unique', [
      'session_id',
      'turn_id',
      'context_type',
      'target_id',
      'target_version',
    ])
    .addCheckConstraint(
      'product_work_context_type_valid',
      sql`context_type in (${allowedValues(PRODUCT_WORK_CONTEXT_TYPES)})`,
    )
    .addCheckConstraint(
      'product_work_context_role_valid',
      sql`binding_role in (${allowedValues(CONTEXT_BINDING_ROLES)})`,
    )
    .addCheckConstraint(
      'product_work_context_sensitivity_valid',
      sql`sensitivity in (${allowedValues(SENSITIVITY_LEVELS)})`,
    )
    .addCheckConstraint(
      'product_work_context_hash_valid',
      sql`content_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .execute();

  await schema
    .createTable('product_action_proposals')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('session_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('product_work_sessions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('turn_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('product_work_turns')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('kind', 'varchar(50)', (column) => column.notNull())
    .addColumn('schema_version', 'varchar(50)', (column) => column.notNull())
    .addColumn('target_type', 'varchar(40)', (column) => column.notNull())
    .addColumn('target_id', 'varchar(200)', (column) => column.notNull())
    .addColumn('target_version', 'integer', (column) => column.notNull())
    .addColumn('change_set', 'jsonb', (column) => column.notNull())
    .addColumn('display_diff', 'jsonb', (column) => column.notNull())
    .addColumn('scope_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('confirmation_requirement', 'varchar(80)', (column) =>
      column.notNull(),
    )
    .addColumn('status', 'varchar(30)', (column) => column.notNull())
    .addColumn('confirmed_by', 'varchar(160)', (column) =>
      column.references(`${table('accounts')}.id`).onDelete('restrict'),
    )
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('reason_code', 'varchar(200)')
    .addColumn('apply_lease_owner', 'varchar(200)')
    .addColumn('apply_lease_until', 'timestamptz')
    .addColumn('apply_attempt', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('result_type', 'varchar(40)')
    .addColumn('result_id', 'varchar(200)')
    .addColumn('result_version', 'integer')
    .addColumn('failure_reason', 'varchar(500)')
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'product_action_proposals_kind_valid',
      sql`kind in (${allowedValues(ACTION_PROPOSAL_KINDS)})`,
    )
    .addCheckConstraint(
      'product_action_proposals_status_valid',
      sql`status in (${allowedValues(ACTION_PROPOSAL_STATUSES)})`,
    )
    .addCheckConstraint(
      'product_action_proposals_json_valid',
      sql`jsonb_typeof(change_set) = 'object' and jsonb_typeof(display_diff) = 'array'`,
    )
    .addCheckConstraint(
      'product_action_proposals_scope_hash_valid',
      sql`scope_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .addCheckConstraint(
      'product_action_proposals_versions_valid',
      sql`target_version >= 0 and row_version >= 0 and apply_attempt >= 0`,
    )
    .execute();

  await schema
    .createTable('product_work_session_events')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('session_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('product_work_sessions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('sequence', 'integer', (column) => column.notNull())
    .addColumn('event_type', 'varchar(50)', (column) => column.notNull())
    .addColumn('aggregate_type', 'varchar(80)', (column) => column.notNull())
    .addColumn('aggregate_id', 'varchar(200)', (column) => column.notNull())
    .addColumn('safe_summary', 'jsonb', (column) => column.notNull())
    .addColumn('source_event_id', 'varchar(200)')
    .addColumn('occurred_at', 'timestamptz', (column) => column.notNull())
    .addColumn('received_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('product_work_session_events_sequence_unique', [
      'session_id',
      'sequence',
    ])
    .addUniqueConstraint('product_work_session_events_source_unique', [
      'session_id',
      'source_event_id',
    ])
    .addCheckConstraint(
      'product_work_session_events_sequence_valid',
      sql`sequence > 0`,
    )
    .addCheckConstraint(
      'product_work_session_events_type_valid',
      sql`event_type in (${allowedValues(PRODUCT_WORK_SESSION_EVENT_TYPES)})`,
    )
    .addCheckConstraint(
      'product_work_session_events_summary_valid',
      sql`jsonb_typeof(safe_summary) = 'object'`,
    )
    .execute();

  await schema
    .createTable('product_work_turn_commands')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('turn_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('product_work_turns')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('command_type', 'varchar(50)', (column) => column.notNull())
    .addColumn('payload_summary', 'jsonb', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('required_capability', 'varchar(80)', (column) =>
      column.notNull(),
    )
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
      'product_work_turn_commands_type_valid',
      sql`command_type in ('START_PRODUCT_WORK_TURN', 'INTERRUPT_PRODUCT_WORK_TURN', 'VERIFY_PRODUCT_WORK_TURN')`,
    )
    .addCheckConstraint(
      'product_work_turn_commands_status_valid',
      sql`status in ('PENDING', 'LEASED', 'ACKNOWLEDGED', 'CANCELLED', 'EXPIRED', 'UNKNOWN', 'FAILED')`,
    )
    .addCheckConstraint(
      'product_work_turn_commands_attempt_valid',
      sql`attempt >= 0 and attempt <= 3`,
    )
    .addCheckConstraint(
      'product_work_turn_commands_payload_valid',
      sql`jsonb_typeof(payload_summary) = 'object'`,
    )
    .execute();

  await sql`create unique index ${sql.id(`${schemaName}_product_work_sessions_open_unique`)} on ${sql.id(schemaName, 'product_work_sessions')} (owner_id, requirement_id, control_surface) where status <> 'ARCHIVED'`.execute(
    database,
  );
  await sql`create unique index ${sql.id(`${schemaName}_product_work_turns_active_unique`)} on ${sql.id(schemaName, 'product_work_turns')} (session_id) where status in ('RECEIVED', 'QUEUED', 'RUNNING', 'WAITING_INPUT', 'PROPOSING', 'CANCELLING', 'UNKNOWN')`.execute(
    database,
  );
  await sql`create unique index ${sql.id(`${schemaName}_product_action_proposals_pending_unique`)} on ${sql.id(schemaName, 'product_action_proposals')} (session_id) where status in ('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'APPLYING', 'UNKNOWN')`.execute(
    database,
  );
  await schema
    .createIndex('product_work_turn_commands_pending_index')
    .on('product_work_turn_commands')
    .columns(['status', 'required_capability', 'created_at'])
    .execute();
}

export async function createAIUXWorkSessionTables(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  assertIsolatedSchema(schemaName);
  await createTables(database, schemaName);
}

export async function up(database: LifecycleKysely): Promise<void> {
  if (process.env.PFC_AIUX_STANDARD_MIGRATION_AUTHORIZATION !== migrationName) {
    throw new Error('AIUX_STANDARD_MIGRATION_NOT_AUTHORIZED');
  }
  await createTables(database, 'pfc');
}
