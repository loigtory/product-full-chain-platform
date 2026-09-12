import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { buildServer } from '../../apps/server/src/app.ts';
import { ArtifactCollaborationApplicationService } from '../../apps/server/src/artifact-collaboration/application-service.ts';
import { ArtifactApplicationService } from '../../apps/server/src/artifacts/application-service.ts';
import { createTraceSubject } from '../../packages/domain/src/index.ts';
import {
  PostgresArtifactCollaborationRepository,
  PostgresArtifactRepository,
  PostgresAuthorizationPort,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  createM2R3ArtifactCollaborationTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createM2R3TestData } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'API_008';
const normalizedRunId = runId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
const schemaName = `codex_test_m2r3_${normalizedRunId}`;
const fixture = createM2R3TestData(runId);

if (connectionString) {
  describe('M2 R3 artifact collaboration HTTP API', () => {
    const database = createDatabase({ connectionString });
    const scoped = database.withSchema(schemaName);
    const artifactRepository = new PostgresArtifactRepository(
      database,
      schemaName,
    );
    const collaborationRepository = new PostgresArtifactCollaborationRepository(
      database,
      schemaName,
    );
    const authorization = new RequirementAuthorizationService(
      new PostgresAuthorizationPort(database, schemaName),
    );
    let sequence = 0;
    const idFactory = (prefix: string) =>
      `${fixture.prefix}_${prefix}_${++sequence}`;
    const artifactService = new ArtifactApplicationService(
      artifactRepository,
      authorization,
      () => fixture.now,
      idFactory,
    );
    const collaborationService = new ArtifactCollaborationApplicationService({
      artifacts: artifactRepository,
      repository: collaborationRepository,
      authorization,
      now: () => fixture.now,
      idFactory,
    });
    const actor = {
      actorId: fixture.accountId,
      roles: ['PRODUCT_OWNER'] as const,
      teamIds: [`${fixture.prefix}_TEAM`],
      authenticationStatus: 'AUTHENTICATED' as const,
    };
    const server = buildServer({
      artifactService,
      artifactCollaborationService: collaborationService,
      resolveActor: () => actor,
    });

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      await createM1CollaborationTables(database, schemaName);
      await createM2R3ArtifactCollaborationTables(database, schemaName);
      const teamId = actor.teamIds[0];
      await scoped
        .insertInto('accounts')
        .values({
          id: fixture.accountId,
          login_name: `codex.m2r3.${normalizedRunId.replace(/_/g, '')}`,
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
        .insertInto('teams')
        .values({
          id: teamId,
          name: `${fixture.prefix} 团队`,
          status: 'ACTIVE',
          owner_account_id: fixture.accountId,
          row_version: 0,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('team_memberships')
        .values({
          team_id: teamId,
          account_id: fixture.accountId,
          role: 'PRODUCT_OWNER',
          status: 'ACTIVE',
          joined_at: fixture.now,
          created_at: fixture.now,
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
        .insertInto('requirement_assignments')
        .values({
          requirement_id: fixture.requirementIds[0],
          team_id: teamId,
          account_id: fixture.accountId,
          responsibility: 'PRODUCT_OWNER',
          status: 'ACTIVE',
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
    });

    afterAll(async () => {
      await server.close();
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('creates immutable text versions and serves detail, content and bounded diff', async () => {
      const created = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirementIds[0]}/artifacts`,
        headers: { 'idempotency-key': `${fixture.prefix}_CREATE` },
        payload: {
          capId: 'CAP-PFC-02',
          stage: 'G1',
          artifactType: 'PRD',
          title: `${fixture.prefix} 需求规格`,
          versionLabel: 'V0.1',
          sourceType: 'CONTROLLED_REFERENCE',
          sourceRef: 'pfc:artifact:version:1',
          mediaType: 'text/markdown',
          content: fixture.contents.first,
          sensitivity: 'INTERNAL',
        },
      });
      expect(created.statusCode).toBe(201);
      const artifactId = created.json().artifact.id as string;
      const firstVersionId = created.json().artifact.currentVersionId as string;

      const appended = await server.inject({
        method: 'POST',
        url: `/api/v1/artifacts/${artifactId}/versions`,
        headers: {
          'idempotency-key': `${fixture.prefix}_APPEND`,
          'if-match': '"0"',
        },
        payload: {
          versionLabel: 'V0.2',
          sourceType: 'CONTROLLED_REFERENCE',
          sourceRef: 'pfc:artifact:version:2',
          mediaType: 'text/markdown',
          content: fixture.contents.second,
          sensitivity: 'INTERNAL',
        },
      });
      expect(appended.statusCode).toBe(200);
      const secondVersionId = appended.json().artifact
        .currentVersionId as string;

      const [detail, content, diff] = await Promise.all([
        server.inject({
          method: 'GET',
          url: `/api/v1/artifacts/${artifactId}`,
        }),
        server.inject({
          method: 'GET',
          url: `/api/v1/artifacts/${artifactId}/versions/${firstVersionId}/content`,
        }),
        server.inject({
          method: 'GET',
          url: `/api/v1/artifacts/${artifactId}/diff?fromVersionId=${firstVersionId}&toVersionId=${secondVersionId}&whitespace=include`,
        }),
      ]);
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ id: artifactId, rowVersion: 1 });
      expect(content.json()).toMatchObject({
        artifactVersionId: firstVersionId,
        content: fixture.contents.first,
        contentHash: fixture.hashes.first,
      });
      expect(diff.json()).toMatchObject({
        artifactId,
        fromVersionId: firstVersionId,
        toVersionId: secondVersionId,
        truncated: false,
      });
      expect(diff.json().totalChangedLineCount).toBeGreaterThan(0);
    });

    it('rejects a multibyte body above the byte budget before any artifact fact is written', async () => {
      const before = await scoped
        .selectFrom('artifacts')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirementIds[0]}/artifacts`,
        headers: { 'idempotency-key': `${fixture.prefix}_TOO_LARGE` },
        payload: {
          capId: 'CAP-PFC-02',
          stage: 'G1',
          artifactType: 'PRD',
          title: `${fixture.prefix} oversized`,
          versionLabel: 'V0.1',
          sourceType: 'CONTROLLED_REFERENCE',
          sourceRef: 'pfc:artifact:oversized',
          mediaType: 'text/markdown',
          content: '测'.repeat(200_000),
          sensitivity: 'INTERNAL',
        },
      });
      const after = await scoped
        .selectFrom('artifacts')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'ARTIFACT_CONTENT_TOO_LARGE',
        recoveryAction: 'SELECT_OTHER_VERSION',
      });
      expect(Number(after.count)).toBe(Number(before.count));
    });

    it('rejects a stale review and persists an exact review plus trace history', async () => {
      const artifact = (
        await artifactRepository.listArtifacts(fixture.requirementIds[0])
      )[0]!;
      const currentVersionId = artifact.currentVersionId;
      const stale = await server.inject({
        method: 'POST',
        url: `/api/v1/artifact-versions/${currentVersionId}/reviews`,
        headers: {
          'idempotency-key': `${fixture.prefix}_STALE_REVIEW`,
          'if-match': '"0"',
        },
        payload: { conclusion: 'APPROVED', responsibility: 'PRODUCT' },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        code: 'ARTIFACT_REVIEW_VERSION_STALE',
      });

      const reviewed = await server.inject({
        method: 'POST',
        url: `/api/v1/artifact-versions/${currentVersionId}/reviews`,
        headers: {
          'idempotency-key': `${fixture.prefix}_REVIEW`,
          'if-match': '"1"',
        },
        payload: { conclusion: 'APPROVED', responsibility: 'PRODUCT' },
      });
      expect(reviewed.statusCode).toBe(201);
      expect(reviewed.json()).toMatchObject({
        replayed: false,
        review: {
          artifactId: artifact.id,
          artifactVersionId: currentVersionId,
          reviewedBy: fixture.accountId,
        },
      });
      const reviews = await server.inject({
        method: 'GET',
        url: `/api/v1/artifact-versions/${currentVersionId}/reviews`,
      });
      expect(reviews.json()).toHaveLength(1);

      const spec = createTraceSubject({
        id: fixture.subjectIds.specVersion,
        requirementId: fixture.requirementIds[0],
        subjectType: 'ARTIFACT_VERSION',
        nativeId: currentVersionId,
        nativeVersion: 'V0.2',
        contentHash: artifact.versions.at(-1)!.contentHash,
        authorityArtifactVersionId: null,
        locator: `artifact-version:${currentVersionId}`,
        createdAt: fixture.now,
      });
      const unit = createTraceSubject({
        id: fixture.subjectIds.unit,
        requirementId: fixture.requirementIds[0],
        subjectType: 'UNIT',
        nativeId: 'UNIT-PFC-02-03',
        nativeVersion: 'V0.1/R3',
        contentHash: artifact.versions.at(-1)!.contentHash,
        authorityArtifactVersionId: currentVersionId,
        locator: 'unit:UNIT-PFC-02-03',
        createdAt: fixture.now,
      });
      const evidence = (kind: string, aggregateId: string) =>
        ({
          actorId: fixture.accountId,
          eventId: `${fixture.prefix}_${kind}_EVENT`,
          outboxId: `${fixture.prefix}_${kind}_OUTBOX`,
          auditId: `${fixture.prefix}_${kind}_AUDIT`,
          requestId: `${fixture.prefix}_${kind}_REQUEST`,
          eventType: `trace.${kind.toLowerCase()}`,
          aggregateType: 'trace-subject',
          aggregateId,
          aggregateVersion: 0,
          requirementId: fixture.requirementIds[0],
          occurredAt: fixture.now,
          route: '/internal/trace-subjects',
          idempotencyKey: `${fixture.prefix}_${kind}_KEY`,
          requestHash: `sha256:${'c'.repeat(64)}`,
          idempotencyId: `${fixture.prefix}_${kind}_IDEMPOTENCY`,
        }) as const;
      await collaborationRepository.createTraceSubject({
        subject: spec,
        evidence: evidence('SPEC', spec.id),
      });
      await collaborationRepository.createTraceSubject({
        subject: unit,
        evidence: evidence('UNIT', unit.id),
      });

      const resolvedGraph = await server.inject({
        method: 'GET',
        url: `/api/v1/requirements/${fixture.requirementIds[0]}/traces?subjectType=ARTIFACT_VERSION&nativeId=${currentVersionId}&direction=BOTH`,
      });
      expect(resolvedGraph.statusCode).toBe(200);
      expect(resolvedGraph.json()).toMatchObject({
        subject: { id: spec.id, nativeId: currentVersionId },
      });

      const linked = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirementIds[0]}/trace-links`,
        headers: {
          'idempotency-key': `${fixture.prefix}_LINK`,
          'if-match': '"0"',
        },
        payload: {
          sourceSubjectId: spec.id,
          targetSubjectId: unit.id,
          relationType: 'SATISFIES',
        },
      });
      expect(linked.statusCode).toBe(201);
      const linkId = linked.json().link.id as string;

      const invalidated = await server.inject({
        method: 'POST',
        url: `/api/v1/trace-links/${linkId}/invalidations`,
        headers: {
          'idempotency-key': `${fixture.prefix}_INVALIDATE`,
          'if-match': '"0"',
        },
        payload: { reason: 'CODEx_TEST obsolete relation' },
      });
      expect(invalidated.statusCode).toBe(200);
      const graph = await server.inject({
        method: 'GET',
        url: `/api/v1/requirements/${fixture.requirementIds[0]}/traces?subjectId=${spec.id}&direction=OUTGOING`,
      });
      expect(graph.json()).toMatchObject({
        links: [{ id: linkId, validity: 'INVALIDATED' }],
      });
    });
  });
}
