import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'M1_R1_LOCAL';
const schemaName = `codex_test_m1_r1_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

if (connectionString) {
  describe('M1 collaboration migration', () => {
    const database = createDatabase({ connectionString });

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      await createM1CollaborationTables(database, schemaName);
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('adds the ten confirmed collaboration and artifact tables', async () => {
      const tables = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', schemaName)
        .where('table_name', 'in', [
          'accounts',
          'account_invitations',
          'sessions',
          'teams',
          'team_memberships',
          'requirement_assignments',
          'workspaces',
          'requirement_workspaces',
          'artifacts',
          'artifact_versions',
        ])
        .orderBy('table_name')
        .execute();

      expect(tables.map(({ table_name }) => table_name)).toEqual([
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
      ]);
    });

    it('makes artifact versions immutable in PostgreSQL', async () => {
      const now = '2026-09-06T00:00:00.000Z';
      await sql`insert into ${sql.table(`${schemaName}.accounts`)}
        (id, login_name, display_name, password_hash, password_salt, status, row_version, created_at, updated_at)
        values ('account-1', 'owner', 'Owner', 'hash', 'salt', 'ACTIVE', 0, ${now}, ${now})`.execute(
        database,
      );
      await sql`insert into ${sql.table(`${schemaName}.requirements`)}
        (id, name, original_idea, initiator_id, current_stage, row_version, created_at, updated_at)
        values ('requirement-1', 'Requirement', 'Idea', 'account-1', 'G0', 0, ${now}, ${now})`.execute(
        database,
      );
      await sql`insert into ${sql.table(`${schemaName}.artifacts`)}
        (id, requirement_id, cap_id, stage, artifact_type, title, status, row_version, created_at, updated_at)
        values ('artifact-1', 'requirement-1', 'CAP-PFC-02', 'G1', 'PRD', 'Spec', 'ACTIVE', 0, ${now}, ${now})`.execute(
        database,
      );
      await sql`insert into ${sql.table(`${schemaName}.artifact_versions`)}
        (id, artifact_id, version_label, source_type, source_ref, content_hash, sensitivity, created_by, created_at)
        values ('version-1', 'artifact-1', 'V0.1', 'WORKSPACE_RELATIVE', 'docs/spec.md', 'sha256:11111111111111111111111111111111', 'INTERNAL', 'account-1', ${now})`.execute(
        database,
      );

      await expect(
        sql`update ${sql.table(`${schemaName}.artifact_versions`)} set version_label = 'V0.2' where id = 'version-1'`.execute(
          database,
        ),
      ).rejects.toThrow(/ARTIFACT_VERSION_IMMUTABLE/);
    });
  });
}
