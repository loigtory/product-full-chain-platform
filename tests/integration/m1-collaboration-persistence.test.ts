import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresArtifactRepository,
  PostgresAuthorizationPort,
  PostgresCollaborationRepository,
  PostgresIdentityRepository,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createM1R1Fixture } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'PERSISTENCE';
const schemaName = `codex_test_m1_r1_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createM1R1Fixture(runId);

if (connectionString) {
  describe('M1 collaboration persistence', () => {
    const database = createDatabase({ connectionString });
    const identity = new PostgresIdentityRepository(database, schemaName);
    const collaboration = new PostgresCollaborationRepository(
      database,
      schemaName,
    );
    const artifacts = new PostgresArtifactRepository(database, schemaName);

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      await createM1CollaborationTables(database, schemaName);
      await identity.createAccount({ ...fixture.account, now: fixture.now });
      await collaboration.createTeamWithOwner({
        ...fixture.team,
        ownerAccountId: fixture.account.id,
        now: fixture.now,
      });
      await database
        .withSchema(schemaName)
        .insertInto('requirements')
        .values({
          id: fixture.requirement.id,
          name: fixture.requirement.name,
          original_idea: fixture.requirement.originalIdea,
          initiator_id: fixture.account.id,
          business_owner_id: fixture.account.id,
          current_stage: 'G0',
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
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('persists a named team, assignment, and bounded workspace', async () => {
      await collaboration.assignRequirement({
        requirementId: fixture.requirement.id,
        teamId: fixture.team.id,
        accountId: fixture.account.id,
        responsibility: 'PRODUCT_OWNER',
        now: fixture.now,
      });
      const workspace = await collaboration.createWorkspace({
        ...fixture.workspace,
        teamId: fixture.team.id,
        now: fixture.now,
      });
      const binding = await collaboration.bindRequirementWorkspace({
        requirementId: fixture.requirement.id,
        teamId: fixture.team.id,
        workspaceId: workspace.id,
        allowedRelativePath: fixture.workspace.allowedRelativePath,
        accessLevel: 'WRITE',
        now: fixture.now,
      });

      await expect(
        identity.findAccountByLoginName(fixture.account.loginName),
      ).resolves.toMatchObject({
        id: fixture.account.id,
        passwordHash: fixture.account.passwordHash,
      });
      await expect(
        collaboration.listTeamsForAccount(fixture.account.id),
      ).resolves.toEqual([expect.objectContaining({ id: fixture.team.id })]);
      expect(binding).toEqual({
        requirementId: fixture.requirement.id,
        workspaceId: fixture.workspace.id,
        allowedRelativePath: fixture.workspace.allowedRelativePath,
        accessLevel: 'WRITE',
      });
    });

    it('replays an audited workspace mutation without duplicating state or evidence', async () => {
      const mutation = {
        actorId: fixture.account.id,
        route: '/api/v1/workspaces',
        idempotencyKey: `${fixture.requestIds.createArtifact}_WORKSPACE_REPLAY`,
        requestHash: 'workspace-request-hash',
        idempotencyId: `${fixture.requestIds.createArtifact}_WORKSPACE_IDEMPOTENCY`,
        eventId: `${fixture.requestIds.createArtifact}_WORKSPACE_EVENT`,
        outboxId: `${fixture.requestIds.createArtifact}_WORKSPACE_OUTBOX`,
        auditId: `${fixture.requestIds.createArtifact}_WORKSPACE_AUDIT`,
        requestId: `${fixture.requestIds.createArtifact}_WORKSPACE_REQUEST`,
        eventType: 'workspace.created',
        aggregateType: 'workspace',
        aggregateId: `${fixture.workspace.id}_REPLAY`,
        aggregateVersion: 0,
        occurredAt: fixture.now,
      } as const;
      const input = {
        id: `${fixture.workspace.id}_REPLAY`,
        teamId: fixture.team.id,
        name: `${fixture.workspace.name} replay`,
        repositoryLabel: fixture.workspace.repositoryLabel,
        repositoryFingerprint: fixture.workspace.repositoryFingerprint,
        now: fixture.now,
        mutation,
      };

      const created = await collaboration.createWorkspaceAudited(input);
      const replayed = await collaboration.createWorkspaceAudited(input);
      const scoped = database.withSchema(schemaName);
      const workspaceCount = await scoped
        .selectFrom('workspaces')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('id', '=', input.id)
        .executeTakeFirstOrThrow();
      const auditCount = await scoped
        .selectFrom('audit_events')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('id', '=', mutation.auditId)
        .executeTakeFirstOrThrow();
      const outboxCount = await scoped
        .selectFrom('outbox_events')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('id', '=', mutation.outboxId)
        .executeTakeFirstOrThrow();

      expect(created).toMatchObject({
        status: 'CREATED',
        value: { id: input.id },
      });
      expect(replayed).toMatchObject({
        status: 'REPLAYED',
        value: { id: input.id },
      });
      expect(Number(workspaceCount.count)).toBe(1);
      expect(Number(auditCount.count)).toBe(1);
      expect(Number(outboxCount.count)).toBe(1);
    });

    it('creates, replays, and appends immutable artifact versions atomically', async () => {
      const baseInput = {
        artifact: {
          id: fixture.artifact.id,
          requirementId: fixture.requirement.id,
          capId: 'CAP-PFC-02',
          stage: 'G1' as const,
          artifactType: 'PRD',
          title: '需求规格',
          status: 'ACTIVE' as const,
          rowVersion: 0,
          createdAt: fixture.now,
          updatedAt: fixture.now,
        },
        version: {
          id: fixture.artifact.versionIds[0],
          artifactId: fixture.artifact.id,
          versionLabel: 'V0.1',
          sourceType: 'WORKSPACE_RELATIVE' as const,
          sourceRef: 'docs/requirements/spec.md',
          contentHash: 'sha256:11111111111111111111111111111111',
          sensitivity: 'INTERNAL' as const,
          createdBy: fixture.account.id,
          createdAt: fixture.now,
        },
        actorId: fixture.account.id,
        route: `/api/v1/requirements/${fixture.requirement.id}/artifacts`,
        idempotencyKey: `${fixture.requestIds.createArtifact}_KEY`,
        requestHash: 'hash-create',
        idempotencyId: `${fixture.requestIds.createArtifact}_IDEMPOTENCY`,
        eventId: `${fixture.requestIds.createArtifact}_EVENT`,
        outboxId: `${fixture.requestIds.createArtifact}_OUTBOX`,
        auditId: `${fixture.requestIds.createArtifact}_AUDIT`,
        requestId: fixture.requestIds.createArtifact,
      };
      const created = await artifacts.createArtifact(baseInput);
      const replayed = await artifacts.createArtifact(baseInput);
      expect(created).toMatchObject({
        status: 'CREATED',
        artifact: { currentVersionId: fixture.artifact.versionIds[0] },
      });
      expect(replayed).toMatchObject({ status: 'REPLAYED' });

      const appended = await artifacts.appendVersion({
        artifactId: fixture.artifact.id,
        requirementId: fixture.requirement.id,
        expectedRowVersion: 0,
        version: {
          id: fixture.artifact.versionIds[1],
          artifactId: fixture.artifact.id,
          versionLabel: 'V0.2',
          sourceType: 'CONTROLLED_REFERENCE',
          sourceRef: 'ref:prd-v02',
          contentHash: 'sha256:22222222222222222222222222222222',
          sensitivity: 'INTERNAL',
          createdBy: fixture.account.id,
          createdAt: '2026-09-06T03:00:00.000Z',
        },
        actorId: fixture.account.id,
        route: `/api/v1/artifacts/${fixture.artifact.id}/versions`,
        idempotencyKey: `${fixture.requestIds.appendVersion}_KEY`,
        requestHash: 'hash-append',
        idempotencyId: `${fixture.requestIds.appendVersion}_IDEMPOTENCY`,
        eventId: `${fixture.requestIds.appendVersion}_EVENT`,
        outboxId: `${fixture.requestIds.appendVersion}_OUTBOX`,
        auditId: `${fixture.requestIds.appendVersion}_AUDIT`,
        requestId: fixture.requestIds.appendVersion,
      });
      expect(appended).toMatchObject({
        status: 'CREATED',
        artifact: {
          rowVersion: 1,
          currentVersionId: fixture.artifact.versionIds[1],
          versions: [{ versionLabel: 'V0.1' }, { versionLabel: 'V0.2' }],
        },
      });
    });

    it('exposes only current-baseline artifact versions as PostgreSQL gate evidence', async () => {
      const baselineId = `${fixture.requirement.id}_BASELINE`;
      const staleVersionId = `${fixture.artifact.id}_PRE_BASELINE_VERSION`;
      const scoped = database.withSchema(schemaName);
      await scoped
        .insertInto('material_baselines')
        .values({
          id: baselineId,
          requirement_id: fixture.requirement.id,
          version_number: 1,
          status: 'CURRENT',
          source_type: 'INTERNAL_IMPROVEMENT',
          source_description: null,
          material_purpose: 'REGRESSION_SAMPLE',
          sensitivity: 'INTERNAL',
          confirmed_by: fixture.account.id,
          confirmed_at: '2026-09-06T01:30:00.000Z',
          created_at: '2026-09-06T01:30:00.000Z',
        })
        .execute();
      await scoped
        .updateTable('requirements')
        .set({ current_baseline_id: baselineId })
        .where('id', '=', fixture.requirement.id)
        .execute();
      await scoped
        .insertInto('artifact_versions')
        .values({
          id: staleVersionId,
          artifact_id: fixture.artifact.id,
          version_label: 'PRE-BASELINE',
          source_type: 'CONTROLLED_REFERENCE',
          source_ref: 'ref:pre-baseline',
          content_hash: 'sha256:33333333333333333333333333333333',
          sensitivity: 'INTERNAL',
          created_by: fixture.account.id,
          created_at: '2026-09-06T01:00:00.000Z',
        })
        .execute();

      const result = await artifacts.listEvidence({
        actorId: fixture.account.id,
        requirementId: fixture.requirement.id,
        baselineId,
        evidenceRefIds: [
          staleVersionId,
          fixture.artifact.versionIds[0],
          fixture.artifact.versionIds[1],
        ],
      });
      const wrongBaseline = await artifacts.listEvidence({
        actorId: fixture.account.id,
        requirementId: fixture.requirement.id,
        baselineId: `${baselineId}_OTHER`,
        evidenceRefIds: [fixture.artifact.versionIds[1]],
      });

      expect(result).toMatchObject({
        status: 'AVAILABLE',
        source: 'POSTGRESQL',
        capabilityVersion: 'pfc-artifact-evidence/v1',
        data: [
          {
            evidenceRefId: fixture.artifact.versionIds[0],
            baselineId,
            referenceType: 'ARTIFACT_VERSION',
            sensitivity: 'INTERNAL',
            validity: 'VALID',
          },
          {
            evidenceRefId: fixture.artifact.versionIds[1],
            baselineId,
            referenceType: 'ARTIFACT_VERSION',
            sensitivity: 'INTERNAL',
            validity: 'VALID',
          },
        ],
      });
      expect(wrongBaseline).toMatchObject({ status: 'AVAILABLE', data: [] });

      const gateRunId = `${fixture.requirement.id}_ARTIFACT_EVIDENCE_GATE`;
      await scoped
        .insertInto('gate_runs')
        .values({
          id: gateRunId,
          requirement_id: fixture.requirement.id,
          baseline_id: baselineId,
          stage: 'G0',
          mode: 'MANUAL',
          status: 'IN_PROGRESS',
          result: null,
          validity: 'CURRENT',
          owner_id: fixture.account.id,
          confirmed_role: 'PRODUCT_OWNER',
          confirmed_by: fixture.account.id,
          confirmed_at: fixture.now,
          started_at: fixture.now,
          completed_at: null,
          failure_reason: null,
          unknown_reason: null,
          registration_note: 'Artifact evidence migration verification.',
          created_at: fixture.now,
        })
        .execute();
      await expect(
        scoped
          .insertInto('gate_run_evidence')
          .values({
            gate_run_id: gateRunId,
            baseline_id: baselineId,
            evidence_ref_id: fixture.artifact.versionIds[1],
            access_decision: 'ALLOWED',
            action_authorization_ref: null,
            created_at: fixture.now,
          })
          .execute(),
      ).resolves.toBeDefined();
      await expect(
        scoped
          .insertInto('gate_run_evidence')
          .values({
            gate_run_id: gateRunId,
            baseline_id: baselineId,
            evidence_ref_id: staleVersionId,
            access_decision: 'ALLOWED',
            action_authorization_ref: null,
            created_at: fixture.now,
          })
          .execute(),
      ).rejects.toBeDefined();
    });

    it('does not grant requirement actions from a role held only in another team', async () => {
      const outsiderId = `${fixture.account.id}_OUTSIDER`;
      const outsiderTeamId = `${fixture.team.id}_OUTSIDER`;
      const scopedRequirementId = `${fixture.requirement.id}_SCOPED`;
      await identity.createAccount({
        id: outsiderId,
        loginName: 'codex.scoped',
        displayName: 'CODEx_TEST_M1_R1 scoped actor',
        passwordHash: fixture.account.passwordHash,
        passwordSalt: fixture.account.passwordSalt,
        now: fixture.now,
      });
      await collaboration.createTeamWithOwner({
        id: outsiderTeamId,
        name: 'CODEx_TEST_M1_R1 unrelated team',
        ownerAccountId: outsiderId,
        now: fixture.now,
      });
      await database
        .withSchema(schemaName)
        .insertInto('requirements')
        .values({
          id: scopedRequirementId,
          name: 'CODEx_TEST_M1_R1 scoped requirement',
          original_idea: 'verify team-scoped authorization',
          initiator_id: outsiderId,
          business_owner_id: outsiderId,
          current_stage: 'G0',
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
      await collaboration.assignRequirement({
        requirementId: scopedRequirementId,
        teamId: fixture.team.id,
        accountId: fixture.account.id,
        responsibility: 'PRODUCT_OWNER',
        now: fixture.now,
      });

      const authorization = await new PostgresAuthorizationPort(
        database,
        schemaName,
      ).lookupRequirementAuthorization({
        actor: {
          actorId: outsiderId,
          roles: ['TEAM_ADMIN'],
          teamIds: [outsiderTeamId],
          authenticationStatus: 'AUTHENTICATED',
        },
        requirementId: scopedRequirementId,
        action: 'REGISTER_ARTIFACT',
      });

      expect(authorization.status).toBe('AVAILABLE');
      expect(authorization.data?.allowedActions).toEqual(['VIEW_REQUIREMENT']);
      expect(authorization.data?.membership).toEqual({
        team: 'NO',
        requirement: 'YES',
        restricted: 'YES',
      });
    });
  });
}
