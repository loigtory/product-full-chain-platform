import { sql } from 'kysely';

import {
  ACCOUNT_STATUSES,
  ACTOR_ROLES,
  ARTIFACT_SOURCE_TYPES,
  ARTIFACT_STATUSES,
  ASSIGNMENT_STATUSES,
  LIFECYCLE_STAGES,
  MEMBERSHIP_STATUSES,
  SENSITIVITY_LEVELS,
  TEAM_STATUSES,
  WORKSPACE_ACCESS_LEVELS,
  WORKSPACE_STATUSES,
  WORKSPACE_VERIFICATION_STATUSES,
} from '@pfc/contracts';

import type { LifecycleKysely } from '../database.ts';
import { enableArtifactGateEvidence } from '../artifact-evidence-bridge.ts';

const protectedSchema = 'pfc';
const collaborationTables = [
  'account_invitations',
  'sessions',
  'requirement_workspaces',
  'requirement_assignments',
  'artifact_versions',
  'artifacts',
  'workspaces',
  'team_memberships',
  'teams',
  'accounts',
] as const;

function assertSchemaName(schemaName: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName)) {
    throw new Error('INVALID_M1_SCHEMA_NAME');
  }
}

function allowedValues(values: readonly string[]) {
  return sql.join(values.map((value) => sql.lit(value)));
}

export async function createM1CollaborationTables(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  assertSchemaName(schemaName);
  const schema = database.schema.withSchema(schemaName);
  const table = (name: string) => `${schemaName}.${name}`;

  await schema
    .createTable('accounts')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('login_name', 'varchar(64)', (column) =>
      column.notNull().unique(),
    )
    .addColumn('display_name', 'varchar(120)', (column) => column.notNull())
    .addColumn('password_hash', 'text', (column) => column.notNull())
    .addColumn('password_salt', 'text', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'accounts_login_name_valid',
      sql`login_name ~ '^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$'`,
    )
    .addCheckConstraint(
      'accounts_display_name_not_blank',
      sql`btrim(display_name) <> ''`,
    )
    .addCheckConstraint(
      'accounts_password_hash_not_blank',
      sql`btrim(password_hash) <> ''`,
    )
    .addCheckConstraint(
      'accounts_password_salt_not_blank',
      sql`btrim(password_salt) <> ''`,
    )
    .addCheckConstraint(
      'accounts_status_valid',
      sql`status in (${allowedValues(ACCOUNT_STATUSES)})`,
    )
    .addCheckConstraint('accounts_row_version_valid', sql`row_version >= 0`)
    .execute();

  await schema
    .createTable('teams')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('name', 'varchar(160)', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('owner_account_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint('teams_name_not_blank', sql`btrim(name) <> ''`)
    .addCheckConstraint(
      'teams_status_valid',
      sql`status in (${allowedValues(TEAM_STATUSES)})`,
    )
    .addCheckConstraint('teams_row_version_valid', sql`row_version >= 0`)
    .execute();

  await sql`create unique index ${sql.id(`${schemaName}_teams_active_name_unique`)} on ${sql.id(schemaName, 'teams')} (lower(name)) where status = 'ACTIVE'`.execute(
    database,
  );

  await schema
    .createTable('team_memberships')
    .addColumn('team_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('teams')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('account_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('role', 'varchar(80)', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('joined_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addPrimaryKeyConstraint('team_memberships_pk', ['team_id', 'account_id'])
    .addCheckConstraint(
      'team_memberships_role_valid',
      sql`role in (${allowedValues(ACTOR_ROLES)})`,
    )
    .addCheckConstraint(
      'team_memberships_status_valid',
      sql`status in (${allowedValues(MEMBERSHIP_STATUSES)})`,
    )
    .addCheckConstraint(
      'team_memberships_joined_at_valid',
      sql`(status = 'INVITED' and joined_at is null) or (status <> 'INVITED' and joined_at is not null)`,
    )
    .execute();

  await schema
    .createTable('account_invitations')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('team_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('teams')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('login_name', 'varchar(64)', (column) => column.notNull())
    .addColumn('role', 'varchar(80)', (column) => column.notNull())
    .addColumn('token_hash', 'varchar(128)', (column) =>
      column.notNull().unique(),
    )
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('invited_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'account_invitations_login_name_valid',
      sql`login_name ~ '^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$'`,
    )
    .addCheckConstraint(
      'account_invitations_role_valid',
      sql`role in (${allowedValues(ACTOR_ROLES)})`,
    )
    .addCheckConstraint(
      'account_invitations_expiry_valid',
      sql`expires_at > created_at`,
    )
    .execute();

  await schema
    .createTable('sessions')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('account_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('token_hash', 'varchar(128)', (column) =>
      column.notNull().unique(),
    )
    .addColumn('csrf_token_hash', 'varchar(128)', (column) => column.notNull())
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('last_seen_at', 'timestamptz', (column) => column.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint('sessions_expiry_valid', sql`expires_at > created_at`)
    .execute();

  await schema
    .createTable('requirement_assignments')
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('team_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('account_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('responsibility', 'varchar(120)', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addPrimaryKeyConstraint('requirement_assignments_pk', [
      'requirement_id',
      'account_id',
      'responsibility',
    ])
    .addForeignKeyConstraint(
      'requirement_assignments_membership_fk',
      ['team_id', 'account_id'],
      table('team_memberships'),
      ['team_id', 'account_id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addCheckConstraint(
      'requirement_assignments_responsibility_not_blank',
      sql`btrim(responsibility) <> ''`,
    )
    .addCheckConstraint(
      'requirement_assignments_status_valid',
      sql`status in (${allowedValues(ASSIGNMENT_STATUSES)})`,
    )
    .execute();

  await schema
    .createTable('workspaces')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('team_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('teams')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('name', 'varchar(160)', (column) => column.notNull())
    .addColumn('repository_label', 'varchar(200)', (column) => column.notNull())
    .addColumn('repository_fingerprint', 'varchar(200)', (column) =>
      column.notNull(),
    )
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('verification_status', 'varchar(20)', (column) =>
      column.notNull().defaultTo('UNVERIFIED'),
    )
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('workspaces_team_name_unique', ['team_id', 'name'])
    .addUniqueConstraint('workspaces_team_id_id_unique', ['team_id', 'id'])
    .addCheckConstraint('workspaces_name_not_blank', sql`btrim(name) <> ''`)
    .addCheckConstraint(
      'workspaces_repository_label_not_blank',
      sql`btrim(repository_label) <> ''`,
    )
    .addCheckConstraint(
      'workspaces_repository_fingerprint_not_blank',
      sql`btrim(repository_fingerprint) <> ''`,
    )
    .addCheckConstraint(
      'workspaces_status_valid',
      sql`status in (${allowedValues(WORKSPACE_STATUSES)})`,
    )
    .addCheckConstraint(
      'workspaces_verification_status_valid',
      sql`verification_status in (${allowedValues(WORKSPACE_VERIFICATION_STATUSES)})`,
    )
    .addCheckConstraint('workspaces_row_version_valid', sql`row_version >= 0`)
    .execute();

  await schema
    .createTable('requirement_workspaces')
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('team_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('workspace_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('allowed_relative_path', 'text', (column) => column.notNull())
    .addColumn('access_level', 'varchar(20)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addPrimaryKeyConstraint('requirement_workspaces_pk', [
      'requirement_id',
      'workspace_id',
    ])
    .addForeignKeyConstraint(
      'requirement_workspaces_workspace_team_fk',
      ['team_id', 'workspace_id'],
      table('workspaces'),
      ['team_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .addCheckConstraint(
      'requirement_workspaces_path_valid',
      sql`btrim(allowed_relative_path) <> ''
        and allowed_relative_path not like '/%'
        and allowed_relative_path !~ '^[A-Za-z]:'
        and allowed_relative_path <> '..'
        and allowed_relative_path not like '../%'
        and allowed_relative_path not like '%/../%'
        and position(chr(92) in allowed_relative_path) = 0`,
    )
    .addCheckConstraint(
      'requirement_workspaces_access_valid',
      sql`access_level in (${allowedValues(WORKSPACE_ACCESS_LEVELS)})`,
    )
    .execute();

  await schema
    .createTable('artifacts')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('cap_id', 'varchar(160)', (column) => column.notNull())
    .addColumn('stage', 'varchar(3)', (column) => column.notNull())
    .addColumn('artifact_type', 'varchar(120)', (column) => column.notNull())
    .addColumn('title', 'varchar(240)', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('current_version_id', 'varchar(160)')
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('artifacts_business_key_unique', [
      'requirement_id',
      'cap_id',
      'stage',
      'artifact_type',
    ])
    .addUniqueConstraint('artifacts_id_current_version_unique', [
      'id',
      'current_version_id',
    ])
    .addCheckConstraint('artifacts_cap_id_not_blank', sql`btrim(cap_id) <> ''`)
    .addCheckConstraint(
      'artifacts_type_not_blank',
      sql`btrim(artifact_type) <> ''`,
    )
    .addCheckConstraint('artifacts_title_not_blank', sql`btrim(title) <> ''`)
    .addCheckConstraint(
      'artifacts_stage_valid',
      sql`stage in (${allowedValues(LIFECYCLE_STAGES)})`,
    )
    .addCheckConstraint(
      'artifacts_status_valid',
      sql`status in (${allowedValues(ARTIFACT_STATUSES)})`,
    )
    .addCheckConstraint('artifacts_row_version_valid', sql`row_version >= 0`)
    .execute();

  await schema
    .createTable('artifact_versions')
    .addColumn('id', 'varchar(160)', (column) => column.primaryKey())
    .addColumn('artifact_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('artifacts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('version_label', 'varchar(120)', (column) => column.notNull())
    .addColumn('source_type', 'varchar(40)', (column) => column.notNull())
    .addColumn('source_ref', 'text', (column) => column.notNull())
    .addColumn('content_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('sensitivity', 'varchar(20)', (column) => column.notNull())
    .addColumn('created_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('artifact_versions_label_unique', [
      'artifact_id',
      'version_label',
    ])
    .addUniqueConstraint('artifact_versions_artifact_id_id_unique', [
      'artifact_id',
      'id',
    ])
    .addCheckConstraint(
      'artifact_versions_label_not_blank',
      sql`btrim(version_label) <> ''`,
    )
    .addCheckConstraint(
      'artifact_versions_source_type_valid',
      sql`source_type in (${allowedValues(ARTIFACT_SOURCE_TYPES)})`,
    )
    .addCheckConstraint(
      'artifact_versions_source_ref_valid',
      sql`btrim(source_ref) <> '' and (
        source_type <> 'WORKSPACE_RELATIVE' or (
          source_ref not like '/%'
          and source_ref !~ '^[A-Za-z]:'
          and source_ref <> '..'
          and source_ref not like '../%'
          and source_ref not like '%/../%'
          and position(chr(92) in source_ref) = 0
        )
      )`,
    )
    .addCheckConstraint(
      'artifact_versions_content_hash_valid',
      sql`content_hash ~ '^sha256:[A-Fa-f0-9]{32,64}$'`,
    )
    .addCheckConstraint(
      'artifact_versions_sensitivity_valid',
      sql`sensitivity in (${allowedValues(SENSITIVITY_LEVELS)})`,
    )
    .execute();

  await schema
    .alterTable('artifacts')
    .addForeignKeyConstraint(
      'artifacts_current_version_fk',
      ['id', 'current_version_id'],
      table('artifact_versions'),
      ['artifact_id', 'id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .execute();

  await sql`
    create function ${sql.id(schemaName, 'enforce_requirement_workspace_team')}()
    returns trigger language plpgsql set search_path = ${sql.id(schemaName)}, pg_temp as $function$
    begin
      if not exists (
        select 1 from requirement_assignments
        where requirement_id = new.requirement_id and team_id = new.team_id and status = 'ACTIVE'
      ) then
        raise exception using errcode = '23514', message = 'REQUIREMENT_TEAM_ASSIGNMENT_REQUIRED';
      end if;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`create trigger ${sql.id('enforce_requirement_workspace_team')} before insert or update on ${sql.id(schemaName, 'requirement_workspaces')} for each row execute function ${sql.id(schemaName, 'enforce_requirement_workspace_team')}()`.execute(
    database,
  );

  await sql`
    create function ${sql.id(schemaName, 'prevent_artifact_version_mutation')}()
    returns trigger language plpgsql as $function$
    begin
      raise exception using errcode = 'P0001', message = 'ARTIFACT_VERSION_IMMUTABLE';
    end;
    $function$
  `.execute(database);
  await sql`create trigger ${sql.id('prevent_artifact_version_update')} before update on ${sql.id(schemaName, 'artifact_versions')} for each row execute function ${sql.id(schemaName, 'prevent_artifact_version_mutation')}()`.execute(
    database,
  );

  await enableArtifactGateEvidence(database, schemaName);

  for (const tableName of collaborationTables) {
    await sql`create trigger ${sql.id(`prevent_${tableName}_delete`)} before delete on ${sql.id(schemaName, tableName)} for each row execute function ${sql.id(schemaName, 'prevent_lifecycle_delete')}()`.execute(
      database,
    );
  }
}

export async function up(database: LifecycleKysely): Promise<void> {
  await createM1CollaborationTables(database, protectedSchema);
}
