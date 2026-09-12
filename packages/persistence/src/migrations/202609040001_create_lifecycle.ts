import { sql } from 'kysely';

import {
  GATE_CONFIRMATION_ROLES,
  GATE_RESULTS,
  GATE_RUN_RESULTS,
  LIFECYCLE_STAGES,
  MATERIAL_IMPACT_CONFIRMATION_ROLES,
  MATERIAL_IMPACT_DECISIONS,
  MATERIAL_PURPOSES,
  MATERIAL_SOURCE_TYPES,
  QUESTION_CONFIRMATION_ROLES,
  QUESTION_DECISION_KINDS,
  QUESTION_STATUSES,
  SENSITIVITY_LEVELS,
} from '@pfc/contracts';

import type { LifecycleKysely } from '../database.ts';

const protectedSchema = 'pfc';
const lifecycleTables = [
  'requirements',
  'material_baselines',
  'material_refs',
  'material_impact_assessments',
  'questions',
  'decisions',
  'gate_runs',
  'gate_checks',
  'gate_run_evidence',
  'stage_advancements',
  'timeline_events',
  'outbox_events',
  'audit_events',
  'idempotency_records',
] as const;

function assertSchemaName(schemaName: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName)) {
    throw new Error('INVALID_LIFECYCLE_SCHEMA_NAME');
  }
}

function allowedValues(values: readonly string[]) {
  return sql.join(values.map((value) => sql.lit(value)));
}

export async function createLifecycleSchema(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  assertSchemaName(schemaName);
  await database.schema.createSchema(schemaName).execute();
  const schema = database.schema.withSchema(schemaName);
  const table = (name: string) => `${schemaName}.${name}`;

  await schema
    .createTable('requirements')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('original_idea', 'text', (column) => column.notNull())
    .addColumn('initiator_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('business_owner_id', 'varchar(160)')
    .addColumn('current_stage', 'varchar(3)', (column) =>
      column.notNull().defaultTo('G0'),
    )
    .addColumn('current_baseline_id', 'varchar(160)')
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('draft_source_type', 'varchar(40)')
    .addColumn('draft_source_description', 'text')
    .addColumn('draft_material_purpose', 'varchar(40)')
    .addColumn('draft_sensitivity', 'varchar(20)')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint('requirements_name_not_blank', sql`btrim(name) <> ''`)
    .addCheckConstraint(
      'requirements_original_idea_not_blank',
      sql`btrim(original_idea) <> ''`,
    )
    .addCheckConstraint(
      'requirements_current_stage_valid',
      sql`current_stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint('requirements_row_version_valid', sql`row_version >= 0`)
    .addCheckConstraint(
      'requirements_draft_source_valid',
      sql`draft_source_type is null or draft_source_type in (${allowedValues(MATERIAL_SOURCE_TYPES)})`,
    )
    .addCheckConstraint(
      'requirements_draft_purpose_valid',
      sql`draft_material_purpose is null or draft_material_purpose in (${allowedValues(MATERIAL_PURPOSES)})`,
    )
    .addCheckConstraint(
      'requirements_draft_sensitivity_valid',
      sql`draft_sensitivity is null or draft_sensitivity in (${allowedValues(SENSITIVITY_LEVELS)})`,
    )
    .execute();

  await schema
    .createTable('material_baselines')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('version_number', 'integer', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('source_type', 'varchar(40)', (column) => column.notNull())
    .addColumn('source_description', 'text')
    .addColumn('material_purpose', 'varchar(40)', (column) => column.notNull())
    .addColumn('sensitivity', 'varchar(20)', (column) => column.notNull())
    .addColumn('confirmed_by', 'varchar(160)', (column) => column.notNull())
    .addColumn('confirmed_at', 'timestamptz', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('material_baselines_requirement_version_unique', [
      'requirement_id',
      'version_number',
    ])
    .addUniqueConstraint('material_baselines_requirement_id_unique', [
      'requirement_id',
      'id',
    ])
    .addCheckConstraint(
      'material_baselines_version_positive',
      sql`version_number > 0`,
    )
    .addCheckConstraint(
      'material_baselines_status_valid',
      sql`status in ('CURRENT', 'HISTORICAL', 'CANDIDATE')`,
    )
    .addCheckConstraint(
      'material_baselines_source_valid',
      sql`source_type in (${allowedValues(MATERIAL_SOURCE_TYPES)})`,
    )
    .addCheckConstraint(
      'material_baselines_purpose_valid',
      sql`material_purpose in (${allowedValues(MATERIAL_PURPOSES)})`,
    )
    .addCheckConstraint(
      'material_baselines_sensitivity_valid',
      sql`sensitivity in (${allowedValues(SENSITIVITY_LEVELS)})`,
    )
    .addCheckConstraint(
      'material_baselines_other_description_valid',
      sql`(source_type = 'OTHER' and source_description is not null and btrim(source_description) <> '') or (source_type <> 'OTHER' and source_description is null)`,
    )
    .execute();

  await schema
    .createIndex('material_baselines_one_current')
    .unique()
    .on('material_baselines')
    .column('requirement_id')
    .where(sql.ref('status'), '=', 'CURRENT')
    .execute();

  await schema
    .alterTable('requirements')
    .addForeignKeyConstraint(
      'requirements_current_baseline_fk',
      ['id', 'current_baseline_id'],
      table('material_baselines'),
      ['requirement_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .execute();

  await schema
    .createTable('material_refs')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('baseline_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('material_baselines')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('reference_type', 'varchar(80)', (column) => column.notNull())
    .addColumn('source', 'text', (column) => column.notNull())
    .addColumn('version', 'varchar(160)')
    .addColumn('content_hash', 'varchar(160)')
    .addColumn('location', 'text', (column) => column.notNull())
    .addColumn('sensitivity', 'varchar(20)', (column) => column.notNull())
    .addColumn('validity', 'varchar(20)', (column) =>
      column.notNull().defaultTo('VALID'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'material_refs_sensitivity_valid',
      sql`sensitivity in (${allowedValues(SENSITIVITY_LEVELS)})`,
    )
    .addCheckConstraint(
      'material_refs_validity_valid',
      sql`validity in ('VALID', 'INVALIDATED')`,
    )
    .addUniqueConstraint('material_refs_id_baseline_unique', [
      'id',
      'baseline_id',
    ])
    .execute();

  await schema
    .createTable('material_impact_assessments')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('original_baseline_id', 'varchar(160)', (column) =>
      column.notNull(),
    )
    .addColumn('candidate_baseline_id', 'varchar(160)', (column) =>
      column.notNull(),
    )
    .addColumn('recommended_stage', 'varchar(3)', (column) => column.notNull())
    .addColumn('selected_stage', 'varchar(3)')
    .addColumn('decision', 'varchar(20)')
    .addColumn('reason', 'text')
    .addColumn('status', 'varchar(20)', (column) =>
      column.notNull().defaultTo('PENDING'),
    )
    .addColumn('confirmed_role', 'varchar(80)')
    .addColumn('confirmed_by', 'varchar(160)')
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('invalidated_gate_run_ids', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addForeignKeyConstraint(
      'material_impacts_original_baseline_fk',
      ['requirement_id', 'original_baseline_id'],
      table('material_baselines'),
      ['requirement_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addForeignKeyConstraint(
      'material_impacts_candidate_baseline_fk',
      ['requirement_id', 'candidate_baseline_id'],
      table('material_baselines'),
      ['requirement_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addCheckConstraint(
      'material_impacts_recommended_stage_valid',
      sql`recommended_stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint(
      'material_impacts_selected_stage_valid',
      sql`selected_stage is null or selected_stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint(
      'material_impacts_status_valid',
      sql`status in ('PENDING', 'CONFIRMED', 'CANCELLED')`,
    )
    .addCheckConstraint(
      'material_impacts_confirmation_valid',
      sql`(status = 'PENDING' and selected_stage is null and decision is null and reason is null and confirmed_role is null and confirmed_by is null and confirmed_at is null and jsonb_typeof(invalidated_gate_run_ids) = 'array' and jsonb_array_length(invalidated_gate_run_ids) = 0) or (status = 'CONFIRMED' and decision in (${allowedValues(MATERIAL_IMPACT_DECISIONS)}) and reason is not null and btrim(reason) <> '' and confirmed_role in (${allowedValues(MATERIAL_IMPACT_CONFIRMATION_ROLES)}) and confirmed_by is not null and confirmed_at is not null and jsonb_typeof(invalidated_gate_run_ids) = 'array' and ((decision = 'IMPACTS' and selected_stage is not null) or (decision = 'NO_IMPACT' and selected_stage is null and jsonb_array_length(invalidated_gate_run_ids) = 0))) or status = 'CANCELLED'`,
    )
    .execute();

  await schema
    .createIndex('material_impacts_one_pending')
    .unique()
    .on('material_impact_assessments')
    .column('requirement_id')
    .where(sql.ref('status'), '=', 'PENDING')
    .execute();

  await schema
    .createTable('questions')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('baseline_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('prompt', 'text', (column) => column.notNull())
    .addColumn('reason', 'text')
    .addColumn('candidates', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('owner_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('close_by_stage', 'varchar(3)', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('current_decision_id', 'varchar(160)')
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addForeignKeyConstraint(
      'questions_requirement_baseline_fk',
      ['requirement_id', 'baseline_id'],
      table('material_baselines'),
      ['requirement_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addCheckConstraint('questions_prompt_not_blank', sql`btrim(prompt) <> ''`)
    .addCheckConstraint(
      'questions_close_stage_valid',
      sql`close_by_stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint(
      'questions_status_valid',
      sql`status in (${allowedValues(QUESTION_STATUSES)})`,
    )
    .addCheckConstraint(
      'questions_candidates_array_valid',
      sql`jsonb_typeof(candidates) = 'array'`,
    )
    .addCheckConstraint('questions_row_version_valid', sql`row_version >= 0`)
    .execute();

  await schema
    .createTable('decisions')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('question_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('questions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('decision_kind', 'varchar(20)', (column) => column.notNull())
    .addColumn('raw_answer', 'text', (column) => column.notNull())
    .addColumn('explanation', 'text')
    .addColumn('scope', 'jsonb', (column) => column.notNull())
    .addColumn('version_number', 'integer', (column) => column.notNull())
    .addColumn('confirmed_role', 'varchar(80)')
    .addColumn('confirmed_by', 'varchar(160)')
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('validity', 'varchar(20)', (column) =>
      column.notNull().defaultTo('CURRENT'),
    )
    .addColumn('supersedes_decision_id', 'varchar(160)', (column) =>
      column.references(`${table('decisions')}.id`).onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('decisions_question_version_unique', [
      'question_id',
      'version_number',
    ])
    .addUniqueConstraint('decisions_question_id_unique', ['question_id', 'id'])
    .addCheckConstraint(
      'decisions_kind_valid',
      sql`decision_kind in (${allowedValues(QUESTION_DECISION_KINDS)})`,
    )
    .addCheckConstraint(
      'decisions_raw_answer_not_blank',
      sql`btrim(raw_answer) <> ''`,
    )
    .addCheckConstraint('decisions_version_positive', sql`version_number > 0`)
    .addCheckConstraint(
      'decisions_validity_valid',
      sql`validity in ('CURRENT', 'SUPERSEDED')`,
    )
    .addCheckConstraint(
      'decisions_confirmed_role_valid',
      sql`confirmed_role is null or confirmed_role in (${allowedValues(QUESTION_CONFIRMATION_ROLES)})`,
    )
    .addCheckConstraint(
      'decisions_confirmation_shape_valid',
      sql`(confirmed_role is null and confirmed_by is null and confirmed_at is null) or (confirmed_role is not null and confirmed_by is not null and confirmed_at is not null)`,
    )
    .addCheckConstraint(
      'decisions_deferral_confirmation_valid',
      sql`decision_kind <> 'DEFERRAL' or (explanation is not null and btrim(explanation) <> '' and confirmed_role is not null)`,
    )
    .execute();

  await schema
    .alterTable('questions')
    .addForeignKeyConstraint(
      'questions_current_decision_fk',
      ['id', 'current_decision_id'],
      table('decisions'),
      ['question_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .execute();

  await schema
    .createTable('gate_runs')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('baseline_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('stage', 'varchar(3)', (column) => column.notNull())
    .addColumn('mode', 'varchar(20)', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('result', 'varchar(30)')
    .addColumn('validity', 'varchar(30)', (column) =>
      column.notNull().defaultTo('CURRENT'),
    )
    .addColumn('owner_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('confirmed_role', 'varchar(80)')
    .addColumn('confirmed_by', 'varchar(160)')
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('started_at', 'timestamptz', (column) => column.notNull())
    .addColumn('completed_at', 'timestamptz')
    .addColumn('failure_reason', 'text')
    .addColumn('unknown_reason', 'text')
    .addColumn('registration_note', 'text')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addForeignKeyConstraint(
      'gate_runs_requirement_baseline_fk',
      ['requirement_id', 'baseline_id'],
      table('material_baselines'),
      ['requirement_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addCheckConstraint(
      'gate_runs_stage_valid',
      sql`stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint(
      'gate_runs_mode_valid',
      sql`mode in ('AUTOMATIC', 'MANUAL')`,
    )
    .addCheckConstraint(
      'gate_runs_status_valid',
      sql`status in ('IN_PROGRESS', 'COMPLETED')`,
    )
    .addCheckConstraint(
      'gate_runs_result_valid',
      sql`result is null or result in (${allowedValues(GATE_RUN_RESULTS)})`,
    )
    .addCheckConstraint(
      'gate_runs_validity_valid',
      sql`validity in ('CURRENT', 'INVALIDATED', 'STALE_BASELINE')`,
    )
    .addCheckConstraint(
      'gate_runs_completion_shape_valid',
      sql`(status = 'IN_PROGRESS' and result is null and completed_at is null) or (status = 'COMPLETED' and result is not null and completed_at is not null)`,
    )
    .addCheckConstraint(
      'gate_runs_unknown_reason_valid',
      sql`result <> 'UNKNOWN' or (unknown_reason is not null and btrim(unknown_reason) <> '')`,
    )
    .addCheckConstraint(
      'gate_runs_manual_confirmation_valid',
      sql`(mode = 'MANUAL' and registration_note is not null and btrim(registration_note) <> '' and confirmed_role is not null and confirmed_by is not null and confirmed_at is not null) or (mode = 'AUTOMATIC' and registration_note is null and confirmed_role is null and confirmed_by is null and confirmed_at is null)`,
    )
    .addCheckConstraint(
      'gate_runs_confirmed_role_valid',
      sql`confirmed_role is null or confirmed_role in (${allowedValues(GATE_CONFIRMATION_ROLES)})`,
    )
    .addUniqueConstraint('gate_runs_aggregate_binding_unique', [
      'id',
      'requirement_id',
      'baseline_id',
      'stage',
    ])
    .addUniqueConstraint('gate_runs_id_baseline_unique', ['id', 'baseline_id'])
    .execute();

  await schema
    .createIndex('gate_runs_one_in_progress')
    .unique()
    .on('gate_runs')
    .columns(['requirement_id', 'baseline_id', 'stage'])
    .where(sql.ref('status'), '=', 'IN_PROGRESS')
    .execute();

  await schema
    .createTable('gate_checks')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('gate_run_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('gate_runs')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('check_key', 'varchar(160)', (column) => column.notNull())
    .addColumn('result', 'varchar(30)', (column) => column.notNull())
    .addColumn('reason', 'text')
    .addColumn('owner_id', 'varchar(160)')
    .addColumn('close_point', 'varchar(160)')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('gate_checks_run_key_unique', [
      'gate_run_id',
      'check_key',
    ])
    .addCheckConstraint(
      'gate_checks_result_valid',
      sql`result in (${allowedValues(GATE_RESULTS)})`,
    )
    .addCheckConstraint(
      'gate_checks_not_applicable_reason_valid',
      sql`result <> 'NOT_APPLICABLE' or (reason is not null and btrim(reason) <> '')`,
    )
    .addCheckConstraint(
      'gate_checks_unknown_reason_valid',
      sql`result <> 'UNKNOWN' or (reason is not null and btrim(reason) <> '')`,
    )
    .execute();

  await schema
    .createTable('gate_run_evidence')
    .addColumn('gate_run_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('baseline_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('evidence_ref_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('access_decision', 'varchar(20)', (column) => column.notNull())
    .addColumn('action_authorization_ref', 'varchar(160)')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('gate_run_evidence_pk', [
      'gate_run_id',
      'evidence_ref_id',
    ])
    .addForeignKeyConstraint(
      'gate_run_evidence_gate_baseline_fk',
      ['gate_run_id', 'baseline_id'],
      table('gate_runs'),
      ['id', 'baseline_id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addForeignKeyConstraint(
      'gate_run_evidence_ref_baseline_fk',
      ['evidence_ref_id', 'baseline_id'],
      table('material_refs'),
      ['id', 'baseline_id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addCheckConstraint(
      'gate_run_evidence_access_valid',
      sql`access_decision in ('ALLOWED', 'DENIED', 'UNKNOWN')`,
    )
    .execute();

  await schema
    .createTable('stage_advancements')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('gate_run_id', 'varchar(160)', (column) =>
      column.notNull().unique(),
    )
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
    .addColumn('from_stage', 'varchar(3)', (column) => column.notNull())
    .addColumn('to_stage', 'varchar(3)', (column) => column.notNull())
    .addColumn('advanced_at', 'timestamptz', (column) => column.notNull())
    .addForeignKeyConstraint(
      'stage_advancements_gate_binding_fk',
      ['gate_run_id', 'requirement_id', 'baseline_id', 'from_stage'],
      table('gate_runs'),
      ['id', 'requirement_id', 'baseline_id', 'stage'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addCheckConstraint(
      'stage_advancements_from_valid',
      sql`from_stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint(
      'stage_advancements_to_valid',
      sql`to_stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint(
      'stage_advancements_sequential',
      sql`substring(to_stage from 2)::integer = substring(from_stage from 2)::integer + 1`,
    )
    .execute();

  await schema
    .createTable('timeline_events')
    .addColumn('sequence', 'serial', (column) => column.notNull().unique())
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('aggregate_type', 'varchar(80)', (column) => column.notNull())
    .addColumn('aggregate_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('event_type', 'varchar(120)', (column) => column.notNull())
    .addColumn('actor_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('before_summary', 'jsonb')
    .addColumn('after_summary', 'jsonb', (column) => column.notNull())
    .addColumn('aggregate_version', 'integer', (column) => column.notNull())
    .addColumn('occurred_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'timeline_events_version_valid',
      sql`aggregate_version >= 0`,
    )
    .execute();

  await schema
    .createTable('outbox_events')
    .addColumn('sequence', 'bigserial', (column) => column.notNull().unique())
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('event_type', 'varchar(120)', (column) => column.notNull())
    .addColumn('aggregate_type', 'varchar(80)', (column) => column.notNull())
    .addColumn('aggregate_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('aggregate_version', 'integer', (column) => column.notNull())
    .addColumn('payload_summary', 'jsonb', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) =>
      column.notNull().defaultTo('PENDING'),
    )
    .addColumn('occurred_at', 'timestamptz', (column) => column.notNull())
    .addColumn('published_at', 'timestamptz')
    .addCheckConstraint(
      'outbox_events_version_valid',
      sql`aggregate_version >= 0`,
    )
    .addCheckConstraint(
      'outbox_events_status_valid',
      sql`status in ('PENDING', 'PUBLISHED', 'FAILED')`,
    )
    .execute();

  await schema
    .createTable('audit_events')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('actor_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('action', 'varchar(120)', (column) => column.notNull())
    .addColumn('target_type', 'varchar(80)', (column) => column.notNull())
    .addColumn('target_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('decision', 'varchar(80)', (column) => column.notNull())
    .addColumn('reason', 'text')
    .addColumn('scope_summary', 'jsonb', (column) => column.notNull())
    .addColumn('request_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('occurred_at', 'timestamptz', (column) => column.notNull())
    .execute();

  await schema
    .createTable('idempotency_records')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('actor_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('route', 'varchar(200)', (column) => column.notNull())
    .addColumn('idempotency_key', 'varchar(200)', (column) => column.notNull())
    .addColumn('request_hash', 'varchar(160)', (column) => column.notNull())
    .addColumn('result_reference', 'varchar(200)')
    .addColumn('response_summary', 'jsonb')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('idempotency_actor_route_key_unique', [
      'actor_id',
      'route',
      'idempotency_key',
    ])
    .execute();

  await sql`
    create function ${sql.id(schemaName, 'prevent_lifecycle_delete')}()
    returns trigger
    language plpgsql
    as $function$
    begin
      raise exception using errcode = 'P0001', message = 'PHYSICAL_DELETE_FORBIDDEN';
    end;
    $function$
  `.execute(database);

  for (const tableName of lifecycleTables) {
    await sql`
      create trigger ${sql.id(`prevent_${tableName}_delete`)}
      before delete on ${sql.id(schemaName, tableName)}
      for each row execute function ${sql.id(schemaName, 'prevent_lifecycle_delete')}()
    `.execute(database);
  }

  await sql`
    create function ${sql.id(schemaName, 'enforce_stage_advancement')}()
    returns trigger
    language plpgsql
    set search_path = ${sql.id(schemaName)}, pg_temp
    as $function$
    begin
      if not exists (
        select 1
        from gate_runs
        where id = new.gate_run_id
          and requirement_id = new.requirement_id
          and baseline_id = new.baseline_id
          and stage = new.from_stage
          and status = 'COMPLETED'
          and result = 'PASS'
          and validity = 'CURRENT'
      ) then
        raise exception using errcode = '23514', message = 'INVALID_STAGE_ADVANCEMENT';
      end if;
      return new;
    end;
    $function$
  `.execute(database);

  await sql`
    create trigger ${sql.id('enforce_stage_advancement')}
    before insert or update on ${sql.id(schemaName, 'stage_advancements')}
    for each row execute function ${sql.id(schemaName, 'enforce_stage_advancement')}()
  `.execute(database);
}

export async function dropLifecycleSchema(
  database: LifecycleKysely,
  schemaName: string,
  options: Readonly<{ allowApplicationSchema?: boolean }> = {},
): Promise<void> {
  assertSchemaName(schemaName);
  const isTestSchema = schemaName.startsWith('codex_test_');
  const applicationSchemaAllowed =
    schemaName === protectedSchema && options.allowApplicationSchema === true;
  if (!isTestSchema && !applicationSchemaAllowed) {
    throw new Error('LIFECYCLE_SCHEMA_DROP_NOT_AUTHORIZED');
  }
  await database.schema.dropSchema(schemaName).ifExists().cascade().execute();
}

export async function up(database: LifecycleKysely): Promise<void> {
  await createLifecycleSchema(database, protectedSchema);
}

export async function down(database: LifecycleKysely): Promise<void> {
  await dropLifecycleSchema(database, protectedSchema, {
    allowApplicationSchema: true,
  });
}

export const lifecycleMigration = { up, down } as const;
