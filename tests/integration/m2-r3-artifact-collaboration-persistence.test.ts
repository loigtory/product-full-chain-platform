import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createArtifactReview,
  createArtifactVersionContent,
  createTraceLink,
  createTraceSubject,
} from '../../packages/domain/src/index.ts';
import {
  PostgresArtifactCollaborationRepository,
  PostgresArtifactRepository,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  createM2R3ArtifactCollaborationTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createM2R3TestData } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'PERSISTENCE_008';
const schemaName = `codex_test_m2r3_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createM2R3TestData(runId);

function evidence(kind: string, aggregateId: string) {
  const key = `${fixture.prefix}_${kind}`;
  return {
    actorId: fixture.accountId,
    eventId: `${key}_EVENT`,
    outboxId: `${key}_OUTBOX`,
    auditId: `${key}_AUDIT`,
    requestId: `${key}_REQUEST`,
    eventType: `artifact.${kind.toLowerCase()}`,
    aggregateType: kind.toLowerCase(),
    aggregateId,
    aggregateVersion: 0,
    requirementId: fixture.requirementIds[0],
    occurredAt: fixture.now,
    route: `/api/v1/${kind.toLowerCase()}`,
    idempotencyKey: `${key}_IDEMPOTENCY_KEY`,
    requestHash: `sha256:${'b'.repeat(64)}`,
    idempotencyId: `${key}_IDEMPOTENCY`,
  } as const;
}

if (connectionString) {
  describe('M2 R3 artifact collaboration persistence', () => {
    const database = createDatabase({ connectionString });
    const scoped = database.withSchema(schemaName);
    const repository = new PostgresArtifactCollaborationRepository(
      database,
      schemaName,
    );
    const artifactRepository = new PostgresArtifactRepository(
      database,
      schemaName,
    );

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
      await scoped
        .insertInto('requirements')
        .values({
          id: fixture.requirementIds[0],
          name: `${fixture.prefix} 需求`,
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
        .set({ current_version_id: fixture.versionIds[1], row_version: 1 })
        .where('id', '=', fixture.artifactId)
        .execute();
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('stores and reads an exact immutable content snapshot', async () => {
      const content = createArtifactVersionContent({
        artifactVersionId: fixture.versionIds[0],
        mediaType: 'text/markdown',
        content: fixture.contents.first,
        contentHash: fixture.hashes.first,
        createdAt: fixture.now,
      });

      await expect(repository.saveVersionContent(content)).resolves.toEqual(
        content,
      );
      await expect(
        repository.findVersionContent({
          artifactId: fixture.artifactId,
          versionId: fixture.versionIds[0],
        }),
      ).resolves.toEqual(content);
    });

    it('rolls back artifact registration when its content snapshot is inconsistent', async () => {
      const artifactId = `${fixture.prefix}_ATOMIC_ARTIFACT`;
      const versionId = `${fixture.prefix}_ATOMIC_VERSION`;
      const content = createArtifactVersionContent({
        artifactVersionId: versionId,
        mediaType: 'text/markdown',
        content: fixture.contents.second,
        contentHash: fixture.hashes.second,
        createdAt: fixture.now,
      });

      await expect(
        artifactRepository.createArtifact({
          artifact: {
            id: artifactId,
            requirementId: fixture.requirementIds[0],
            capId: 'CAP-PFC-02',
            stage: 'G1',
            artifactType: 'PRD',
            title: 'CODEx_TEST_M2R3 原子制品',
            status: 'ACTIVE',
            rowVersion: 0,
            createdAt: fixture.now,
            updatedAt: fixture.now,
          },
          version: {
            id: versionId,
            artifactId,
            versionLabel: 'V0.1',
            sourceType: 'WORKSPACE_RELATIVE',
            sourceRef: 'docs/atomic.md',
            contentHash: fixture.hashes.first,
            sensitivity: 'INTERNAL',
            createdBy: fixture.accountId,
            createdAt: fixture.now,
          },
          content,
          actorId: fixture.accountId,
          route: '/api/v1/artifacts',
          idempotencyKey: `${fixture.prefix}_ATOMIC_KEY`,
          requestHash: `sha256:${'d'.repeat(64)}`,
          idempotencyId: `${fixture.prefix}_ATOMIC_IDEMPOTENCY`,
          eventId: `${fixture.prefix}_ATOMIC_EVENT`,
          outboxId: `${fixture.prefix}_ATOMIC_OUTBOX`,
          auditId: `${fixture.prefix}_ATOMIC_AUDIT`,
          requestId: `${fixture.prefix}_ATOMIC_REQUEST`,
        }),
      ).rejects.toThrow();
      await expect(
        scoped
          .selectFrom('artifacts')
          .select('id')
          .where('id', '=', artifactId)
          .execute(),
      ).resolves.toEqual([]);
      await expect(
        scoped
          .selectFrom('idempotency_records')
          .select('id')
          .where('idempotency_key', '=', `${fixture.prefix}_ATOMIC_KEY`)
          .execute(),
      ).resolves.toEqual([]);
    });

    it('creates and replays one audited review fact', async () => {
      const review = createArtifactReview({
        id: fixture.reviewId,
        artifactId: fixture.artifactId,
        artifactVersionId: fixture.versionIds[0],
        artifactContentHash: fixture.hashes.first,
        conclusion: 'APPROVED',
        responsibility: 'PRODUCT',
        comment: null,
        reviewedBy: fixture.accountId,
        supersedesReviewId: null,
        createdAt: fixture.now,
      });
      const input = {
        review,
        evidence: evidence('REVIEW', review.id),
      };

      await expect(repository.createReview(input)).resolves.toMatchObject({
        status: 'CREATED',
        value: review,
      });
      await expect(repository.createReview(input)).resolves.toMatchObject({
        status: 'REPLAYED',
        value: review,
      });
      await expect(
        repository.listReviews(fixture.versionIds[0]),
      ).resolves.toEqual([review]);
    });

    it('creates one directed link and returns it from both subject directions', async () => {
      const spec = createTraceSubject({
        id: fixture.subjectIds.specVersion,
        requirementId: fixture.requirementIds[0],
        subjectType: 'ARTIFACT_VERSION',
        nativeId: fixture.versionIds[0],
        nativeVersion: 'V0.1',
        contentHash: fixture.hashes.first,
        authorityArtifactVersionId: null,
        locator: `artifact-version:${fixture.versionIds[0]}`,
        createdAt: fixture.now,
      });
      const unit = createTraceSubject({
        id: fixture.subjectIds.unit,
        requirementId: fixture.requirementIds[0],
        subjectType: 'UNIT',
        nativeId: 'UNIT-PFC-02-03',
        nativeVersion: 'V0.1/R3',
        contentHash: fixture.hashes.first,
        authorityArtifactVersionId: fixture.versionIds[0],
        locator: 'unit:UNIT-PFC-02-03',
        createdAt: fixture.now,
      });
      const link = createTraceLink({
        id: fixture.traceLinkId,
        requirementId: fixture.requirementIds[0],
        source: spec,
        target: unit,
        relationType: 'SATISFIES',
        createdBy: fixture.accountId,
        createdAt: fixture.now,
      });

      await repository.createTraceSubject({
        subject: spec,
        evidence: evidence('TRACE_SUBJECT_SPEC', spec.id),
      });
      await repository.createTraceSubject({
        subject: unit,
        evidence: evidence('TRACE_SUBJECT_UNIT', unit.id),
      });
      await expect(
        repository.createTraceLink({
          link,
          evidence: evidence('TRACE_LINK', link.id),
        }),
      ).resolves.toMatchObject({ status: 'CREATED', value: link });

      const outgoing = await repository.listTraceGraph({
        requirementId: fixture.requirementIds[0],
        subjectId: spec.id,
        direction: 'OUTGOING',
      });
      const incoming = await repository.listTraceGraph({
        requirementId: fixture.requirementIds[0],
        subjectId: unit.id,
        direction: 'INCOMING',
      });
      expect(outgoing.links).toEqual([link]);
      expect(incoming.links).toEqual([link]);
      expect(outgoing.subjects).toEqual(expect.arrayContaining([spec, unit]));
    });
  });
}
