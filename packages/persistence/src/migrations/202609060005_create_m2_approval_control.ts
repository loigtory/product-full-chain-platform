import { sql } from 'kysely';

import {
  AGENT_APPROVAL_DECISIONS,
  AGENT_APPROVAL_KINDS,
  AGENT_RUN_EVENT_TYPES,
  AGENT_RUN_OPERATIONS,
  AGENT_RUN_RESULT_OUTCOMES,
  AGENT_RUN_STATUSES,
} from '@pfc/contracts';

import type { LifecycleKysely } from '../database.ts';

const protectedSchema = 'pfc';

function assertSchemaName(schemaName: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName)) {
    throw new Error('INVALID_M2_R2_SCHEMA_NAME');
  }
}

function allowedValues(values: readonly string[]) {
  return sql.join(values.map((value) => sql.lit(value)));
}

export async function createM2ApprovalControlTables(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  assertSchemaName(schemaName);
  const schema = database.schema.withSchema(schemaName);
  const table = (name: string) => `${schemaName}.${name}`;

  await schema
    .alterTable('agent_runs')
    .dropConstraint('agent_runs_operation_valid')
    .execute();
  await schema
    .alterTable('agent_runs')
    .dropConstraint('agent_runs_status_valid')
    .execute();
  await schema
    .alterTable('agent_runs')
    .addColumn('execution_instance_id', 'varchar(200)')
    .addColumn('result_outcome', 'varchar(20)')
    .addColumn('run_scope', 'jsonb')
    .addColumn('run_scope_hash', 'varchar(80)')
    .addColumn('execution_started_at', 'timestamptz')
    .addColumn('cancel_requested_at', 'timestamptz')
    .addColumn('terminal_at', 'timestamptz')
    .execute();
  await sql`alter table ${sql.id(schemaName, 'agent_runs')} add constraint ${sql.id('agent_runs_operation_valid')} check (operation in (${allowedValues(AGENT_RUN_OPERATIONS)}))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'agent_runs')} add constraint ${sql.id('agent_runs_status_valid')} check (status in (${allowedValues(AGENT_RUN_STATUSES)}))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'agent_runs')} add constraint ${sql.id('agent_runs_result_outcome_valid')} check (result_outcome is null or result_outcome in (${allowedValues(AGENT_RUN_RESULT_OUTCOMES)}))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'agent_runs')} add constraint ${sql.id('agent_runs_scope_hash_valid')} check (run_scope_hash is null or run_scope_hash ~ '^sha256:[A-Fa-f0-9]{64}$')`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'agent_runs')} add constraint ${sql.id('agent_runs_write_scope_valid')} check ((access_mode = 'READ_ONLY' and operation = 'ARTIFACT_CHECK' and execution_instance_id is null and run_scope is null and run_scope_hash is null) or (access_mode = 'WORKSPACE_WRITE' and operation = 'CONTROLLED_ARTIFACT_EDIT' and execution_instance_id is not null and run_scope is not null and jsonb_typeof(run_scope) = 'object' and run_scope_hash is not null))`.execute(
    database,
  );

  await schema
    .alterTable('agent_run_events')
    .dropConstraint('agent_run_events_type_valid')
    .execute();
  await sql`alter table ${sql.id(schemaName, 'agent_run_events')} add constraint ${sql.id('agent_run_events_type_valid')} check (event_type in (${allowedValues(AGENT_RUN_EVENT_TYPES)}))`.execute(
    database,
  );

  await schema
    .alterTable('agent_run_commands')
    .dropConstraint('agent_run_commands_type_valid')
    .execute();
  await schema
    .alterTable('agent_run_commands')
    .dropConstraint('agent_run_commands_status_valid')
    .execute();
  await schema
    .alterTable('agent_run_commands')
    .addColumn('priority', 'integer', (column) =>
      column.notNull().defaultTo(100),
    )
    .addColumn('execution_instance_id', 'varchar(200)')
    .execute();
  await sql`alter table ${sql.id(schemaName, 'agent_run_commands')} add constraint ${sql.id('agent_run_commands_type_valid')} check (command_type in ('START_READ_ONLY_RUN', 'START_WORKSPACE_WRITE_RUN', 'RESOLVE_APPROVAL', 'INTERRUPT_RUN', 'VERIFY_RUN_STATE'))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'agent_run_commands')} add constraint ${sql.id('agent_run_commands_status_valid')} check (status in ('PENDING', 'LEASED', 'ACKNOWLEDGED', 'CANCELLED', 'EXPIRED', 'UNKNOWN', 'FAILED'))`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'agent_run_commands')} add constraint ${sql.id('agent_run_commands_priority_valid')} check (priority between 0 and 1000)`.execute(
    database,
  );
  await sql`create unique index ${sql.id(`${schemaName}_agent_run_write_start_unique`)} on ${sql.id(schemaName, 'agent_run_commands')} (run_id) where command_type = 'START_WORKSPACE_WRITE_RUN'`.execute(
    database,
  );

  await schema
    .createTable('approval_requests')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('run_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('agent_runs')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('execution_instance_id', 'varchar(200)', (column) =>
      column.notNull(),
    )
    .addColumn('app_server_request_id', 'varchar(200)')
    .addColumn('thread_id', 'varchar(200)')
    .addColumn('turn_id', 'varchar(200)')
    .addColumn('item_id', 'varchar(200)')
    .addColumn('callback_id', 'varchar(200)')
    .addColumn('kind', 'varchar(40)', (column) => column.notNull())
    .addColumn('requested_scope', 'jsonb', (column) => column.notNull())
    .addColumn('approved_scope', 'jsonb')
    .addColumn('scope_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('outside_capsule', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('decision', 'varchar(30)', (column) => column.notNull())
    .addColumn('requested_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('requested_at', 'timestamptz', (column) => column.notNull())
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('decided_by', 'varchar(160)', (column) =>
      column.references(`${table('accounts')}.id`).onDelete('restrict'),
    )
    .addColumn('decided_at', 'timestamptz')
    .addColumn('reason_code', 'varchar(200)')
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addUniqueConstraint('approval_requests_app_request_unique', [
      'run_id',
      'execution_instance_id',
      'app_server_request_id',
    ])
    .addCheckConstraint(
      'approval_requests_kind_valid',
      sql`kind in (${allowedValues(AGENT_APPROVAL_KINDS)})`,
    )
    .addCheckConstraint(
      'approval_requests_decision_valid',
      sql`decision in (${allowedValues(AGENT_APPROVAL_DECISIONS)})`,
    )
    .addCheckConstraint(
      'approval_requests_scope_hash_valid',
      sql`scope_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .addCheckConstraint(
      'approval_requests_identity_shape_valid',
      sql`(kind = 'RUN_START' and app_server_request_id is null and thread_id is null and turn_id is null and item_id is null and callback_id is null) or (kind <> 'RUN_START' and app_server_request_id is not null and thread_id is not null and turn_id is not null and item_id is not null)`,
    )
    .addCheckConstraint(
      'approval_requests_expiry_valid',
      sql`expires_at > requested_at`,
    )
    .addCheckConstraint(
      'approval_requests_version_valid',
      sql`row_version >= 0`,
    )
    .addCheckConstraint(
      'approval_requests_decision_shape_valid',
      sql`(decision = 'PENDING' and approved_scope is null and decided_by is null and decided_at is null and reason_code is null) or (decision = 'APPROVED' and approved_scope is not null and decided_by is not null and decided_at is not null and reason_code is not null) or (decision in ('REJECTED', 'REVOKED', 'CANCELLED') and approved_scope is null and decided_by is not null and decided_at is not null and reason_code is not null) or (decision = 'EXPIRED' and approved_scope is null and decided_at is not null and reason_code is not null)`,
    )
    .execute();

  await sql`create unique index ${sql.id(`${schemaName}_approval_run_start_unique`)} on ${sql.id(schemaName, 'approval_requests')} (run_id) where kind = 'RUN_START'`.execute(
    database,
  );

  await schema
    .createIndex('approval_requests_run_status_index')
    .on('approval_requests')
    .columns(['run_id', 'decision', 'requested_at'])
    .execute();

  await schema
    .createTable('agent_run_capsules')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('run_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('agent_runs')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('execution_instance_id', 'varchar(200)', (column) =>
      column.notNull(),
    )
    .addColumn('source_git_baseline', 'varchar(64)', (column) =>
      column.notNull(),
    )
    .addColumn('scope_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('before_manifest_hash', 'varchar(80)', (column) =>
      column.notNull(),
    )
    .addColumn('after_manifest_hash', 'varchar(80)')
    .addColumn('diff_summary', 'jsonb')
    .addColumn('lifecycle', 'varchar(30)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('verified_at', 'timestamptz')
    .addColumn('cleaned_at', 'timestamptz')
    .addUniqueConstraint('agent_run_capsules_run_execution_unique', [
      'run_id',
      'execution_instance_id',
    ])
    .addCheckConstraint(
      'agent_run_capsules_lifecycle_valid',
      sql`lifecycle in ('MATERIALIZED', 'RUNNING', 'VERIFIED', 'CLEANED', 'UNKNOWN')`,
    )
    .addCheckConstraint(
      'agent_run_capsules_hashes_valid',
      sql`scope_hash ~ '^sha256:[A-Fa-f0-9]{64}$' and before_manifest_hash ~ '^sha256:[A-Fa-f0-9]{64}$' and (after_manifest_hash is null or after_manifest_hash ~ '^sha256:[A-Fa-f0-9]{64}$')`,
    )
    .execute();
}

export async function up(database: LifecycleKysely): Promise<void> {
  await createM2ApprovalControlTables(database, protectedSchema);
}
