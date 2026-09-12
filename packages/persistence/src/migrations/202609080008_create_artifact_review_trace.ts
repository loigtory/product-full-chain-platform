import { sql } from 'kysely';

import {
  ARTIFACT_CONTENT_AVAILABILITIES,
  ARTIFACT_CONTENT_MEDIA_TYPES,
  ARTIFACT_REVIEW_CONCLUSIONS,
  ARTIFACT_REVIEW_RESPONSIBILITIES,
  TRACE_RELATION_TYPES,
  TRACE_SUBJECT_TYPES,
  TRACE_VALIDITIES,
} from '@pfc/contracts';

import type { LifecycleKysely } from '../database.ts';

const migrationName = '202609080008_create_artifact_review_trace';

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
    .createTable('artifact_version_contents')
    .addColumn('artifact_version_id', 'varchar(160)', (column) =>
      column
        .primaryKey()
        .references(`${table('artifact_versions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('media_type', 'varchar(40)', (column) => column.notNull())
    .addColumn('availability', 'varchar(32)', (column) => column.notNull())
    .addColumn('content_text', 'text')
    .addColumn('content_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('byte_size', 'integer', (column) => column.notNull())
    .addColumn('line_count', 'integer', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'artifact_version_contents_media_type_valid',
      sql`media_type in (${allowedValues(ARTIFACT_CONTENT_MEDIA_TYPES)})`,
    )
    .addCheckConstraint(
      'artifact_version_contents_availability_valid',
      sql`availability in (${allowedValues(ARTIFACT_CONTENT_AVAILABILITIES)})`,
    )
    .addCheckConstraint(
      'artifact_version_contents_shape_valid',
      sql`(
        availability = 'AVAILABLE'
        and content_text is not null
        and byte_size = octet_length(content_text)
        and byte_size <= 524288
        and line_count >= 1
        and line_count <= 20000
      ) or (
        availability <> 'AVAILABLE'
        and content_text is null
        and byte_size >= 0
        and line_count >= 0
      )`,
    )
    .addCheckConstraint(
      'artifact_version_contents_hash_valid',
      sql`content_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .execute();

  await schema
    .createTable('artifact_reviews')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('artifact_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('artifact_version_id', 'varchar(160)', (column) =>
      column.notNull(),
    )
    .addColumn('artifact_content_hash', 'varchar(80)', (column) =>
      column.notNull(),
    )
    .addColumn('conclusion', 'varchar(32)', (column) => column.notNull())
    .addColumn('responsibility', 'varchar(32)', (column) => column.notNull())
    .addColumn('comment', 'varchar(8000)')
    .addColumn('reviewed_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('supersedes_review_id', 'varchar(160)', (column) =>
      column.references(`${table('artifact_reviews')}.id`).onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addForeignKeyConstraint(
      'artifact_reviews_version_fk',
      ['artifact_id', 'artifact_version_id'],
      table('artifact_versions'),
      ['artifact_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addCheckConstraint(
      'artifact_reviews_hash_valid',
      sql`artifact_content_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .addCheckConstraint(
      'artifact_reviews_conclusion_valid',
      sql`conclusion in (${allowedValues(ARTIFACT_REVIEW_CONCLUSIONS)})`,
    )
    .addCheckConstraint(
      'artifact_reviews_responsibility_valid',
      sql`responsibility in (${allowedValues(ARTIFACT_REVIEW_RESPONSIBILITIES)})`,
    )
    .addCheckConstraint(
      'artifact_reviews_comment_valid',
      sql`conclusion = 'APPROVED' or length(btrim(comment)) > 0`,
    )
    .execute();

  await schema
    .createTable('trace_subjects')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('subject_type', 'varchar(40)', (column) => column.notNull())
    .addColumn('native_id', 'varchar(200)', (column) => column.notNull())
    .addColumn('native_version', 'varchar(120)', (column) => column.notNull())
    .addColumn('content_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('authority_artifact_version_id', 'varchar(160)', (column) =>
      column
        .references(`${table('artifact_versions')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('locator', 'varchar(500)', (column) => column.notNull())
    .addColumn('validity', 'varchar(24)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('invalidated_at', 'timestamptz')
    .addColumn('invalidation_reason', 'varchar(240)')
    .addUniqueConstraint('trace_subjects_identity_unique', [
      'requirement_id',
      'subject_type',
      'native_id',
      'native_version',
      'content_hash',
    ])
    .addCheckConstraint(
      'trace_subjects_type_valid',
      sql`subject_type in (${allowedValues(TRACE_SUBJECT_TYPES)})`,
    )
    .addCheckConstraint(
      'trace_subjects_hash_valid',
      sql`content_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .addCheckConstraint(
      'trace_subjects_authority_valid',
      sql`subject_type not in ('CAPABILITY', 'UNIT', 'ACCEPTANCE_CRITERION') or authority_artifact_version_id is not null`,
    )
    .addCheckConstraint(
      'trace_subjects_validity_valid',
      sql`validity in (${allowedValues(TRACE_VALIDITIES)})`,
    )
    .addCheckConstraint(
      'trace_subjects_invalidation_shape_valid',
      sql`(
        validity = 'VALID'
        and invalidated_at is null
        and invalidation_reason is null
      ) or (
        validity = 'INVALIDATED'
        and invalidated_at is not null
        and length(btrim(invalidation_reason)) > 0
      )`,
    )
    .execute();

  await schema
    .createTable('trace_links')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('source_subject_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('trace_subjects')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('target_subject_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('trace_subjects')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('relation_type', 'varchar(32)', (column) => column.notNull())
    .addColumn('validity', 'varchar(24)', (column) => column.notNull())
    .addColumn('created_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('invalidated_at', 'timestamptz')
    .addColumn('invalidation_reason', 'varchar(240)')
    .addCheckConstraint(
      'trace_links_relation_valid',
      sql`relation_type in (${allowedValues(TRACE_RELATION_TYPES)})`,
    )
    .addCheckConstraint(
      'trace_links_validity_valid',
      sql`validity in (${allowedValues(TRACE_VALIDITIES)})`,
    )
    .addCheckConstraint(
      'trace_links_not_self',
      sql`source_subject_id <> target_subject_id`,
    )
    .addCheckConstraint(
      'trace_links_invalidation_shape_valid',
      sql`(
        validity = 'VALID'
        and invalidated_at is null
        and invalidation_reason is null
      ) or (
        validity = 'INVALIDATED'
        and invalidated_at is not null
        and length(btrim(invalidation_reason)) > 0
      )`,
    )
    .execute();

  await sql`
    create function ${sql.id(schemaName, 'enforce_artifact_content_insert')}()
    returns trigger language plpgsql set search_path = ${sql.id(schemaName)}, pg_temp as $function$
    begin
      if not exists (
        select 1 from artifact_versions
        where id = new.artifact_version_id
          and lower(content_hash) = lower(new.content_hash)
      ) then
        raise exception using errcode = '23514', message = 'ARTIFACT_CONTENT_HASH_MISMATCH';
      end if;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`create trigger ${sql.id('enforce_artifact_content_insert')} before insert on ${sql.id(schemaName, 'artifact_version_contents')} for each row execute function ${sql.id(schemaName, 'enforce_artifact_content_insert')}()`.execute(
    database,
  );

  await sql`
    create function ${sql.id(schemaName, 'prevent_artifact_collaboration_mutation')}()
    returns trigger language plpgsql as $function$
    begin
      if tg_table_name = 'artifact_version_contents' then
        raise exception using errcode = 'P0001', message = 'ARTIFACT_VERSION_CONTENT_IMMUTABLE';
      end if;
      raise exception using errcode = 'P0001', message = 'ARTIFACT_REVIEW_IMMUTABLE';
    end;
    $function$
  `.execute(database);
  for (const tableName of ['artifact_version_contents', 'artifact_reviews']) {
    await sql`create trigger ${sql.id(`prevent_${tableName}_mutation`)} before update or delete on ${sql.id(schemaName, tableName)} for each row execute function ${sql.id(schemaName, 'prevent_artifact_collaboration_mutation')}()`.execute(
      database,
    );
  }

  await sql`
    create function ${sql.id(schemaName, 'enforce_artifact_review_insert')}()
    returns trigger language plpgsql set search_path = ${sql.id(schemaName)}, pg_temp as $function$
    declare previous artifact_reviews%rowtype;
    begin
      if not exists (
        select 1 from artifact_versions
        where id = new.artifact_version_id
          and artifact_id = new.artifact_id
          and lower(content_hash) = lower(new.artifact_content_hash)
      ) then
        raise exception using errcode = '23514', message = 'ARTIFACT_REVIEW_VERSION_STALE';
      end if;
      if new.supersedes_review_id is not null then
        select * into previous from artifact_reviews where id = new.supersedes_review_id;
        if previous.id is null
          or previous.artifact_version_id <> new.artifact_version_id
          or previous.responsibility <> new.responsibility then
          raise exception using errcode = '23514', message = 'ARTIFACT_REVIEW_SUPERSEDES_INVALID';
        end if;
      end if;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`create trigger ${sql.id('enforce_artifact_review_insert')} before insert on ${sql.id(schemaName, 'artifact_reviews')} for each row execute function ${sql.id(schemaName, 'enforce_artifact_review_insert')}()`.execute(
    database,
  );

  await sql`
    create function ${sql.id(schemaName, 'enforce_trace_link_scope')}()
    returns trigger language plpgsql set search_path = ${sql.id(schemaName)}, pg_temp as $function$
    begin
      if not exists (
        select 1 from trace_subjects source
        join trace_subjects target on target.id = new.target_subject_id
        where source.id = new.source_subject_id
          and source.requirement_id = new.requirement_id
          and target.requirement_id = new.requirement_id
          and source.validity = 'VALID'
          and target.validity = 'VALID'
      ) then
        raise exception using errcode = '23514', message = 'TRACE_CROSS_REQUIREMENT_FORBIDDEN';
      end if;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`create trigger ${sql.id('enforce_trace_link_scope')} before insert on ${sql.id(schemaName, 'trace_links')} for each row execute function ${sql.id(schemaName, 'enforce_trace_link_scope')}()`.execute(
    database,
  );

  await sql`
    create function ${sql.id(schemaName, 'enforce_trace_invalidation')}()
    returns trigger language plpgsql as $function$
    begin
      if tg_op = 'DELETE' or old.validity <> 'VALID' or new.validity <> 'INVALIDATED' then
        raise exception using errcode = 'P0001', message = 'TRACE_FACT_IMMUTABLE';
      end if;
      if (to_jsonb(new) - array['validity', 'invalidated_at', 'invalidation_reason'])
        is distinct from
        (to_jsonb(old) - array['validity', 'invalidated_at', 'invalidation_reason']) then
        raise exception using errcode = 'P0001', message = 'TRACE_FACT_IMMUTABLE';
      end if;
      if new.invalidated_at is null or length(btrim(new.invalidation_reason)) = 0 then
        raise exception using errcode = '23514', message = 'TRACE_INVALIDATION_REASON_REQUIRED';
      end if;
      return new;
    end;
    $function$
  `.execute(database);
  for (const tableName of ['trace_subjects', 'trace_links']) {
    await sql`create trigger ${sql.id(`enforce_${tableName}_invalidation`)} before update or delete on ${sql.id(schemaName, tableName)} for each row execute function ${sql.id(schemaName, 'enforce_trace_invalidation')}()`.execute(
      database,
    );
  }

  await sql`create unique index ${sql.id(`${schemaName}_trace_links_valid_unique`)} on ${sql.id(schemaName, 'trace_links')} (requirement_id, source_subject_id, target_subject_id, relation_type) where validity = 'VALID'`.execute(
    database,
  );
  await schema
    .createIndex('trace_links_source_index')
    .on('trace_links')
    .columns(['requirement_id', 'source_subject_id', 'validity'])
    .execute();
  await schema
    .createIndex('trace_links_target_index')
    .on('trace_links')
    .columns(['requirement_id', 'target_subject_id', 'validity'])
    .execute();
}

export async function createM2R3ArtifactCollaborationTables(
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
