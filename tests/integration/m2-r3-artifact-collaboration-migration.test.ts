import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  createM2R3ArtifactCollaborationTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createM2R3TestData } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'MIGRATION_008';
const schemaName = `codex_test_m2r3_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createM2R3TestData(runId);

if (connectionString) {
  describe('M2 R3 artifact collaboration migration', () => {
    const database = createDatabase({ connectionString });
    const scoped = database.withSchema(schemaName);

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      await createM1CollaborationTables(database, schemaName);
      await createM2R3ArtifactCollaborationTables(database, schemaName);
      await scoped
        .insertInto('accounts')
        .values({
          id: fixture.accountId,
          login_name: `codex.m2r3.${runId.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          display_name: 'CODEx_TEST_M2R3 陈立',
          password_hash: 'synthetic-password-hash',
          password_salt: 'synthetic-password-salt',
          status: 'ACTIVE',
          row_version: 0,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      for (const requirementId of fixture.requirementIds) {
        await scoped
          .insertInto('requirements')
          .values({
            id: requirementId,
            name: `${requirementId} 需求`,
            original_idea: 'Synthetic local-only M2 R3 requirement.',
            initiator_id: fixture.accountId,
            business_owner_id: fixture.accountId,
            current_stage: 'G1',
            current_baseline_id: null,
            row_version: 0,
            draft_source_type: null,
            draft_source_description: null,
            draft_material_purpose: null,
            draft_sensitivity: null,
            created_at: fixture.now,
            updated_at: fixture.now,
          })
          .execute();
      }
      await scoped
        .insertInto('artifacts')
        .values({
          id: fixture.artifactId,
          requirement_id: fixture.requirementIds[0],
          cap_id: 'CAP-PFC-02',
          stage: 'G1',
          artifact_type: 'PRD',
          title: 'CODEx_TEST_M2R3 需求规格',
          status: 'ACTIVE',
          current_version_id: null,
          row_version: 0,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('artifact_versions')
        .values(
          fixture.versionIds.map((id, index) => ({
            id,
            artifact_id: fixture.artifactId,
            version_label: `V0.${index + 1}`,
            source_type: 'CONTROLLED_REFERENCE' as const,
            source_ref: `pfc:artifact:${index + 1}`,
            content_hash:
              index === 0 ? fixture.hashes.first : fixture.hashes.second,
            sensitivity: 'INTERNAL' as const,
            created_by: fixture.accountId,
            created_at: new Date(
              Date.parse(fixture.now) + index * 60_000,
            ).toISOString(),
          })),
        )
        .execute();
      await scoped
        .updateTable('artifacts')
        .set({ current_version_id: fixture.versionIds[1] })
        .where('id', '=', fixture.artifactId)
        .execute();
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('creates the four artifact collaboration tables', async () => {
      const tables = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', schemaName)
        .where('table_name', 'in', [
          'artifact_version_contents',
          'artifact_reviews',
          'trace_subjects',
          'trace_links',
        ])
        .orderBy('table_name')
        .execute();

      expect(tables.map(({ table_name }) => table_name)).toEqual([
        'artifact_reviews',
        'artifact_version_contents',
        'trace_links',
        'trace_subjects',
      ]);
    });

    it('binds immutable content to the artifact version hash', async () => {
      await scoped
        .insertInto('artifact_version_contents')
        .values({
          artifact_version_id: fixture.versionIds[0],
          media_type: 'text/markdown',
          availability: 'AVAILABLE',
          content_text: fixture.contents.first,
          content_hash: fixture.hashes.first,
          byte_size: Buffer.byteLength(fixture.contents.first),
          line_count: fixture.contents.first.split('\n').length,
          created_at: fixture.now,
        })
        .execute();

      await expect(
        scoped
          .updateTable('artifact_version_contents')
          .set({ media_type: 'text/plain' })
          .where('artifact_version_id', '=', fixture.versionIds[0])
          .execute(),
      ).rejects.toThrow(/ARTIFACT_VERSION_CONTENT_IMMUTABLE/);
      await expect(
        scoped
          .insertInto('artifact_version_contents')
          .values({
            artifact_version_id: fixture.versionIds[1],
            media_type: 'text/markdown',
            availability: 'AVAILABLE',
            content_text: fixture.contents.second,
            content_hash: fixture.hashes.first,
            byte_size: Buffer.byteLength(fixture.contents.second),
            line_count: fixture.contents.second.split('\n').length,
            created_at: fixture.now,
          })
          .execute(),
      ).rejects.toThrow(/ARTIFACT_CONTENT_HASH_MISMATCH/);
    });

    it('binds reviews and trace links to one requirement', async () => {
      await scoped
        .insertInto('artifact_reviews')
        .values({
          id: fixture.reviewId,
          artifact_id: fixture.artifactId,
          artifact_version_id: fixture.versionIds[0],
          artifact_content_hash: fixture.hashes.first,
          conclusion: 'APPROVED',
          responsibility: 'PRODUCT',
          comment: null,
          reviewed_by: fixture.accountId,
          supersedes_review_id: null,
          created_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('trace_subjects')
        .values([
          {
            id: fixture.subjectIds.requirement,
            requirement_id: fixture.requirementIds[0],
            subject_type: 'REQUIREMENT',
            native_id: fixture.requirementIds[0],
            native_version: '1',
            content_hash: fixture.hashes.first,
            authority_artifact_version_id: null,
            locator: `requirement:${fixture.requirementIds[0]}`,
            validity: 'VALID',
            created_at: fixture.now,
            invalidated_at: null,
            invalidation_reason: null,
          },
          {
            id: fixture.subjectIds.specVersion,
            requirement_id: fixture.requirementIds[0],
            subject_type: 'ARTIFACT_VERSION',
            native_id: fixture.versionIds[0],
            native_version: 'V0.1',
            content_hash: fixture.hashes.first,
            authority_artifact_version_id: null,
            locator: `artifact-version:${fixture.versionIds[0]}`,
            validity: 'VALID',
            created_at: fixture.now,
            invalidated_at: null,
            invalidation_reason: null,
          },
          {
            id: fixture.subjectIds.unit,
            requirement_id: fixture.requirementIds[0],
            subject_type: 'UNIT',
            native_id: 'UNIT-PFC-02-03',
            native_version: 'V0.1/R3',
            content_hash: fixture.hashes.first,
            authority_artifact_version_id: fixture.versionIds[0],
            locator: 'unit:UNIT-PFC-02-03',
            validity: 'VALID',
            created_at: fixture.now,
            invalidated_at: null,
            invalidation_reason: null,
          },
          {
            id: fixture.subjectIds.otherRequirement,
            requirement_id: fixture.requirementIds[1],
            subject_type: 'REQUIREMENT',
            native_id: fixture.requirementIds[1],
            native_version: '1',
            content_hash: fixture.hashes.second,
            authority_artifact_version_id: null,
            locator: `requirement:${fixture.requirementIds[1]}`,
            validity: 'VALID',
            created_at: fixture.now,
            invalidated_at: null,
            invalidation_reason: null,
          },
        ])
        .execute();
      await scoped
        .insertInto('trace_links')
        .values({
          id: fixture.traceLinkId,
          requirement_id: fixture.requirementIds[0],
          source_subject_id: fixture.subjectIds.specVersion,
          target_subject_id: fixture.subjectIds.unit,
          relation_type: 'SATISFIES',
          validity: 'VALID',
          created_by: fixture.accountId,
          created_at: fixture.now,
          invalidated_at: null,
          invalidation_reason: null,
        })
        .execute();

      await expect(
        scoped
          .updateTable('trace_links')
          .set({
            relation_type: 'IMPLEMENTS',
            validity: 'INVALIDATED',
            invalidated_at: fixture.now,
            invalidation_reason: 'CODEx_TEST attempted mixed mutation',
          })
          .where('id', '=', fixture.traceLinkId)
          .execute(),
      ).rejects.toThrow(/TRACE_FACT_IMMUTABLE/);

      await expect(
        scoped
          .insertInto('trace_links')
          .values({
            id: `${fixture.traceLinkId}_CROSS`,
            requirement_id: fixture.requirementIds[0],
            source_subject_id: fixture.subjectIds.requirement,
            target_subject_id: fixture.subjectIds.otherRequirement,
            relation_type: 'DECOMPOSES_TO',
            validity: 'VALID',
            created_by: fixture.accountId,
            created_at: fixture.now,
            invalidated_at: null,
            invalidation_reason: null,
          })
          .execute(),
      ).rejects.toThrow(/TRACE_CROSS_REQUIREMENT_FORBIDDEN/);
    });
  });
}
