import { sql } from 'kysely';

import {
  ACTION_PROPOSAL_KINDS,
  EXECUTION_EVIDENCE_OUTCOMES,
  EXECUTION_EVIDENCE_SOURCE_TYPES,
  MCP_CAPABILITY_EFFECTS,
  MCP_CAPABILITY_STATUSES,
  MCP_READ_STATUSES,
  PRODUCT_WORK_SESSION_EVENT_TYPES,
  SENSITIVITY_LEVELS,
} from '@pfc/contracts';

import type { LifecycleKysely } from '../database.ts';

const migrationName = '202609080009_create_execution_evidence_mcp';

function allowedValues(values: readonly string[]) {
  return sql.join(values.map((value) => sql.lit(value)));
}

function assertIsolatedSchema(schemaName: string): void {
  if (!/^codex_test_m2r3_[a-z0-9_]{1,40}$/.test(schemaName)) {
    throw new Error('M2_R3_ISOLATED_SCHEMA_REQUIRED');
  }
}

async function createTables(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  const schema = database.schema.withSchema(schemaName);
  const table = (name: string) => `${schemaName}.${name}`;

  await schema
    .createTable('execution_evidence')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
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
    .addColumn('source_type', 'varchar(40)', (column) => column.notNull())
    .addColumn('source_id', 'varchar(200)', (column) => column.notNull())
    .addColumn('outcome', 'varchar(20)', (column) => column.notNull())
    .addColumn('safe_summary', 'varchar(16384)', (column) => column.notNull())
    .addColumn('content_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('sensitivity', 'varchar(20)', (column) => column.notNull())
    .addColumn('artifact_version_id', 'varchar(160)', (column) =>
      column
        .references(`${table('artifact_versions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('gate_run_id', 'varchar(160)', (column) =>
      column.references(`${table('gate_runs')}.id`).onDelete('restrict'),
    )
    .addColumn('retention_class', 'varchar(30)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('execution_evidence_source_unique', [
      'source_type',
      'source_id',
      'content_hash',
    ])
    .addCheckConstraint(
      'execution_evidence_source_valid',
      sql`source_type in (${allowedValues(EXECUTION_EVIDENCE_SOURCE_TYPES)})`,
    )
    .addCheckConstraint(
      'execution_evidence_outcome_valid',
      sql`outcome in (${allowedValues(EXECUTION_EVIDENCE_OUTCOMES)})`,
    )
    .addCheckConstraint(
      'execution_evidence_sensitivity_valid',
      sql`sensitivity in (${allowedValues(SENSITIVITY_LEVELS)})`,
    )
    .addCheckConstraint(
      'execution_evidence_hash_valid',
      sql`content_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .addCheckConstraint(
      'execution_evidence_summary_valid',
      sql`length(btrim(safe_summary)) between 1 and 16384`,
    )
    .addCheckConstraint(
      'execution_evidence_binding_valid',
      sql`artifact_version_id is not null or gate_run_id is not null`,
    )
    .addCheckConstraint(
      'execution_evidence_retention_valid',
      sql`retention_class in ('PRODUCT_FACT', 'GATE_EVIDENCE')`,
    )
    .execute();

  await schema
    .createTable('mcp_capability_registrations')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('logical_capability_id', 'varchar(160)', (column) =>
      column.notNull(),
    )
    .addColumn('server_name', 'varchar(160)', (column) => column.notNull())
    .addColumn('tool_name', 'varchar(160)', (column) => column.notNull())
    .addColumn('input_schema_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('config_fingerprint', 'varchar(80)', (column) =>
      column.notNull(),
    )
    .addColumn('effect', 'varchar(20)', (column) => column.notNull())
    .addColumn('risk_level', 'varchar(20)', (column) => column.notNull())
    .addColumn('max_input_bytes', 'integer', (column) => column.notNull())
    .addColumn('max_output_bytes', 'integer', (column) => column.notNull())
    .addColumn('timeout_ms', 'integer', (column) => column.notNull())
    .addColumn('allowed_team_ids', 'jsonb', (column) => column.notNull())
    .addColumn('allowed_requirement_ids', 'jsonb', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('reviewed_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('reviewed_at', 'timestamptz', (column) => column.notNull())
    .addColumn('review_evidence_ref', 'varchar(500)', (column) =>
      column.notNull(),
    )
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'mcp_capability_effect_valid',
      sql`effect in (${allowedValues(MCP_CAPABILITY_EFFECTS)})`,
    )
    .addCheckConstraint(
      'mcp_capability_status_valid',
      sql`status in (${allowedValues(MCP_CAPABILITY_STATUSES)})`,
    )
    .addCheckConstraint(
      'mcp_capability_hashes_valid',
      sql`input_schema_hash ~ '^sha256:[A-Fa-f0-9]{64}$' and config_fingerprint ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .addCheckConstraint(
      'mcp_capability_limits_valid',
      sql`max_input_bytes between 1 and 32768 and max_output_bytes between 1 and 262144 and timeout_ms between 1 and 30000`,
    )
    .addCheckConstraint(
      'mcp_capability_scopes_valid',
      sql`jsonb_typeof(allowed_team_ids) = 'array' and jsonb_array_length(allowed_team_ids) > 0 and jsonb_array_length(allowed_team_ids) <= 50 and jsonb_typeof(allowed_requirement_ids) = 'array' and jsonb_array_length(allowed_requirement_ids) > 0 and jsonb_array_length(allowed_requirement_ids) <= 50`,
    )
    .addCheckConstraint(
      'mcp_capability_review_valid',
      sql`risk_level in ('LOW', 'MEDIUM', 'HIGH') and length(btrim(review_evidence_ref)) > 0 and row_version >= 0`,
    )
    .execute();

  await sql`create unique index ${sql.id(`${schemaName}_mcp_capability_active_unique`)} on ${sql.id(schemaName, 'mcp_capability_registrations')} (logical_capability_id) where status = 'ACTIVE'`.execute(
    database,
  );

  await schema
    .createTable('mcp_read_requests')
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
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('team_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('teams')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('capability_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('mcp_capability_registrations')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('artifact_version_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('artifact_versions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('input_payload', 'jsonb', (column) => column.notNull())
    .addColumn('input_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('sensitivity', 'varchar(20)', (column) => column.notNull())
    .addColumn('material_ref_ids', 'jsonb', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('bridge_id', 'varchar(160)', (column) =>
      column
        .references(`${table('bridge_registrations')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('external_thread_id', 'varchar(200)')
    .addColumn('output_summary', 'varchar(16384)')
    .addColumn('output_hash', 'varchar(80)')
    .addColumn('output_bytes', 'integer')
    .addColumn('output_truncated', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('duration_ms', 'integer')
    .addColumn('evidence_id', 'varchar(200)', (column) =>
      column
        .references(`${table('execution_evidence')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('failure_reason', 'varchar(500)')
    .addColumn('recovery_action', 'varchar(160)')
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
    .addCheckConstraint(
      'mcp_read_status_valid',
      sql`status in (${allowedValues(MCP_READ_STATUSES)})`,
    )
    .addCheckConstraint(
      'mcp_read_input_valid',
      sql`jsonb_typeof(input_payload) = 'object' and octet_length(input_payload::text) <= 32768 and input_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .addCheckConstraint(
      'mcp_read_materials_valid',
      sql`jsonb_typeof(material_ref_ids) = 'array' and jsonb_array_length(material_ref_ids) <= 50`,
    )
    .addCheckConstraint(
      'mcp_read_sensitivity_valid',
      sql`sensitivity in (${allowedValues(SENSITIVITY_LEVELS)})`,
    )
    .addCheckConstraint(
      'mcp_read_result_shape_valid',
      sql`(
        status = 'COMPLETED'
        and output_summary is not null
        and output_hash ~ '^sha256:[A-Fa-f0-9]{64}$'
        and output_bytes >= 0
        and duration_ms >= 0
        and evidence_id is not null
        and failure_reason is null
        and recovery_action is null
        and terminal_at is not null
      ) or (
        status in ('FAILED', 'UNKNOWN')
        and output_summary is null
        and output_hash is null
        and output_bytes is null
        and duration_ms is null
        and evidence_id is null
        and length(btrim(failure_reason)) > 0
        and length(btrim(recovery_action)) > 0
        and terminal_at is not null
      ) or (
        status not in ('COMPLETED', 'FAILED', 'UNKNOWN')
        and output_summary is null
        and output_hash is null
        and output_bytes is null
        and duration_ms is null
        and evidence_id is null
        and failure_reason is null
        and recovery_action is null
        and terminal_at is null
      )`,
    )
    .addCheckConstraint('mcp_read_row_version_valid', sql`row_version >= 0`)
    .execute();

  await sql`create unique index ${sql.id(`${schemaName}_mcp_read_session_active_unique`)} on ${sql.id(schemaName, 'mcp_read_requests')} (session_id) where status in ('REQUESTED', 'QUEUED', 'LEASED', 'RUNNING')`.execute(
    database,
  );
  await schema
    .createIndex('mcp_read_request_status_index')
    .on('mcp_read_requests')
    .columns(['status', 'created_at'])
    .execute();

  await sql`alter table ${sql.id(schemaName, 'product_work_turn_commands')} drop constraint if exists product_work_turn_commands_type_valid`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'product_work_turn_commands')} add constraint product_work_turn_commands_type_valid check (command_type in ('START_PRODUCT_WORK_TURN', 'INTERRUPT_PRODUCT_WORK_TURN', 'VERIFY_PRODUCT_WORK_TURN', 'EXECUTE_MCP_READ'))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'product_action_proposals')} drop constraint if exists product_action_proposals_kind_valid`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'product_action_proposals')} add constraint product_action_proposals_kind_valid check (kind in (${allowedValues(ACTION_PROPOSAL_KINDS)}))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'product_action_proposals')} add constraint product_action_proposals_target_valid check (target_type in ('REQUIREMENT', 'QUESTION', 'ARTIFACT', 'AGENT_RUN', 'TRACE_LINK', 'MCP_CAPABILITY'))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'product_work_session_events')} drop constraint if exists product_work_session_events_type_valid`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'product_work_session_events')} add constraint product_work_session_events_type_valid check (event_type in (${allowedValues(PRODUCT_WORK_SESSION_EVENT_TYPES)}))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'scoped_action_authorizations')} drop constraint if exists scoped_authorizations_target_valid`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'scoped_action_authorizations')} add constraint scoped_authorizations_target_valid check (target in ('APPROVED_AI', 'APPROVED_SKILL', 'MCP'))`.execute(
    database,
  );

  await sql`
    create function ${sql.id(schemaName, 'prevent_execution_evidence_mutation')}()
    returns trigger language plpgsql as $function$
    begin
      raise exception using errcode = 'P0001', message = 'EXECUTION_EVIDENCE_IMMUTABLE';
    end;
    $function$
  `.execute(database);
  await sql`create trigger ${sql.id('prevent_execution_evidence_mutation')} before update or delete on ${sql.id(schemaName, 'execution_evidence')} for each row execute function ${sql.id(schemaName, 'prevent_execution_evidence_mutation')}()`.execute(
    database,
  );
}

export async function createM2R3EvidenceMcpTables(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  assertIsolatedSchema(schemaName);
  await createTables(database, schemaName);
}

export async function up(database: LifecycleKysely): Promise<void> {
  if (
    process.env.PFC_M2_R3_STANDARD_MIGRATION_AUTHORIZATION !== migrationName
  ) {
    throw new Error('M2_R3_STANDARD_MIGRATION_NOT_AUTHORIZED');
  }
  await createTables(database, 'pfc');
}
