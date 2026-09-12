import { sql } from 'kysely';

import type { LifecycleKysely } from '../database.ts';

const migrationName = '202609070006_create_scoped_action_authorizations';

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
    .createTable('scoped_action_authorizations')
    .addColumn('id', 'varchar(200)', (column) => column.primaryKey())
    .addColumn('actor_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('requirement_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('requirements')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('action', 'varchar(80)', (column) => column.notNull())
    .addColumn('target', 'varchar(40)', (column) => column.notNull())
    .addColumn('purpose', 'varchar(160)', (column) => column.notNull())
    .addColumn('scope_hash', 'varchar(80)', (column) => column.notNull())
    .addColumn('status', 'varchar(20)', (column) => column.notNull())
    .addColumn('valid_from', 'timestamptz', (column) => column.notNull())
    .addColumn('valid_until', 'timestamptz', (column) => column.notNull())
    .addColumn('granted_by', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('accounts')}.id`)
        .onDelete('restrict'),
    )
    .addColumn('granted_at', 'timestamptz', (column) => column.notNull())
    .addColumn('revoked_by', 'varchar(160)', (column) =>
      column.references(`${table('accounts')}.id`).onDelete('restrict'),
    )
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('row_version', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addCheckConstraint(
      'scoped_authorizations_action_valid',
      sql`action = 'TRANSMIT_MATERIAL'`,
    )
    .addCheckConstraint(
      'scoped_authorizations_target_valid',
      sql`target in ('APPROVED_AI', 'APPROVED_SKILL')`,
    )
    .addCheckConstraint(
      'scoped_authorizations_status_valid',
      sql`status in ('GRANTED', 'REVOKED', 'UNKNOWN')`,
    )
    .addCheckConstraint(
      'scoped_authorizations_purpose_not_blank',
      sql`btrim(purpose) <> ''`,
    )
    .addCheckConstraint(
      'scoped_authorizations_scope_hash_valid',
      sql`scope_hash ~ '^sha256:[A-Fa-f0-9]{64}$'`,
    )
    .addCheckConstraint(
      'scoped_authorizations_expiry_valid',
      sql`valid_until > valid_from and valid_until <= valid_from + interval '30 minutes'`,
    )
    .addCheckConstraint(
      'scoped_authorizations_version_valid',
      sql`row_version >= 0`,
    )
    .addCheckConstraint(
      'scoped_authorizations_revocation_shape_valid',
      sql`(status = 'GRANTED' and revoked_by is null and revoked_at is null) or (status = 'REVOKED' and revoked_by is not null and revoked_at is not null) or status = 'UNKNOWN'`,
    )
    .execute();

  await schema
    .createTable('scoped_action_authorization_material_refs')
    .addColumn('authorization_id', 'varchar(200)', (column) =>
      column
        .notNull()
        .references(`${table('scoped_action_authorizations')}.id`)
        .onDelete('cascade'),
    )
    .addColumn('material_ref_id', 'varchar(160)', (column) =>
      column
        .notNull()
        .references(`${table('material_refs')}.id`)
        .onDelete('restrict'),
    )
    .addPrimaryKeyConstraint('scoped_authorization_material_refs_pk', [
      'authorization_id',
      'material_ref_id',
    ])
    .execute();

  await schema
    .createIndex('scoped_authorizations_actor_requirement_index')
    .on('scoped_action_authorizations')
    .columns(['actor_id', 'requirement_id', 'status', 'valid_until'])
    .execute();
}

export async function createAIUXScopedAuthorizationTables(
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
