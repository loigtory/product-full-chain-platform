import { sql } from 'kysely';

import {
  EXPERIENCE_ID_PREFIX,
  EXPERIENCE_SCHEMA,
} from '../apps/server/src/local-experience.ts';
import type { LifecycleKysely } from '../packages/persistence/src/index.ts';

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

const idTables = lifecycleTables.filter(
  (tableName) => tableName !== 'gate_run_evidence',
);

export async function assertLocalExperienceDatabaseTarget(
  database: LifecycleKysely,
): Promise<void> {
  const result = await sql<{
    database: string;
    role: string;
    loopbackServer: boolean;
    listenAddress: string;
    port: string;
  }>`
    select
      current_database()::text as database,
      current_user::text as role,
      (inet_server_addr() = inet '127.0.0.1') as "loopbackServer",
      current_setting('listen_addresses') as "listenAddress",
      current_setting('port') as port
  `.execute(database);
  const row = result.rows[0];
  const mismatches = [
    row?.database === 'pfc_local' ? null : 'database',
    row?.role === 'pfc_app_local' ? null : 'role',
    row?.loopbackServer === true ? null : 'serverAddress',
    row?.listenAddress === '127.0.0.1' ? null : 'listenAddress',
    row?.port === '5432' ? null : 'port',
  ].filter(Boolean);
  if (mismatches.length > 0) {
    throw new Error(
      `EXPERIENCE_DATABASE_TARGET_MISMATCH:${mismatches.join(',')}`,
    );
  }
}

async function existingExperienceTables(database: LifecycleKysely) {
  const result = await sql<{ tableName: string }>`
    select table_name as "tableName"
    from information_schema.tables
    where table_schema = ${EXPERIENCE_SCHEMA}
    order by table_name
  `.execute(database);
  return result.rows.map(({ tableName }) => tableName);
}

export async function assertExperienceResetScope(
  database: LifecycleKysely,
): Promise<void> {
  const tableNames = await existingExperienceTables(database);
  if (
    tableNames.some(
      (tableName) =>
        !lifecycleTables.includes(
          tableName as (typeof lifecycleTables)[number],
        ),
    )
  ) {
    throw new Error('EXPERIENCE_SCHEMA_CONTAINS_UNKNOWN_TABLE');
  }
  for (const tableName of idTables) {
    if (!tableNames.includes(tableName)) continue;
    const result = await sql<{ id: string }>`
      select ${sql.id('id')} as id
      from ${sql.id(EXPERIENCE_SCHEMA, tableName)}
      where ${sql.id('id')} not like ${`${EXPERIENCE_ID_PREFIX}%`}
      limit 1
    `.execute(database);
    if (result.rows.length > 0) {
      throw new Error('EXPERIENCE_SCHEMA_CONTAINS_OUT_OF_SCOPE_ID');
    }
  }
  if (tableNames.includes('gate_run_evidence')) {
    const result = await sql<{ gateRunId: string }>`
      select gate_run_id as "gateRunId"
      from ${sql.id(EXPERIENCE_SCHEMA, 'gate_run_evidence')}
      where gate_run_id not like ${`${EXPERIENCE_ID_PREFIX}%`}
        or evidence_ref_id not like ${`${EXPERIENCE_ID_PREFIX}%`}
      limit 1
    `.execute(database);
    if (result.rows.length > 0) {
      throw new Error('EXPERIENCE_SCHEMA_CONTAINS_OUT_OF_SCOPE_ID');
    }
  }
}

export async function dropExperienceSchema(
  database: LifecycleKysely,
): Promise<void> {
  await database.schema
    .dropSchema(EXPERIENCE_SCHEMA)
    .ifExists()
    .cascade()
    .execute();
}

export async function readExperienceCounts(database: LifecycleKysely) {
  const scoped = database.withSchema(EXPERIENCE_SCHEMA);
  const [
    requirements,
    questions,
    gateRuns,
    materialBaselines,
    materialRefs,
    materialImpacts,
  ] = await Promise.all([
    scoped
      .selectFrom('requirements')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow(),
    scoped
      .selectFrom('questions')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow(),
    scoped
      .selectFrom('gate_runs')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow(),
    scoped
      .selectFrom('material_baselines')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow(),
    scoped
      .selectFrom('material_refs')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow(),
    scoped
      .selectFrom('material_impact_assessments')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow(),
  ]);
  return {
    requirements: Number(requirements.count),
    questions: Number(questions.count),
    gateRuns: Number(gateRuns.count),
    materialBaselines: Number(materialBaselines.count),
    materialRefs: Number(materialRefs.count),
    materialImpacts: Number(materialImpacts.count),
  };
}

export async function assertExperienceSchemaReady(
  database: LifecycleKysely,
): Promise<void> {
  const tableNames = await existingExperienceTables(database);
  if (
    tableNames.length !== lifecycleTables.length ||
    lifecycleTables.some((tableName) => !tableNames.includes(tableName))
  ) {
    throw new Error('EXPERIENCE_SCHEMA_NOT_READY');
  }
  await assertExperienceResetScope(database);
}
