import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActorContext } from '@pfc/contracts';

import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { buildServer } from '../../apps/server/src/app.ts';
import { WorkSessionApplicationService } from '../../apps/server/src/work-sessions/index.ts';
import { createScopedActionAuthorization } from '../../packages/domain/src/index.ts';
import {
  PostgresAuthorizationPort,
  PostgresScopedAuthorizationRepository,
  PostgresWorkSessionRepository,
  createAIUXScopedAuthorizationTables,
  createAIUXWorkSessionTables,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  createM2AgentRunTables,
  createM2ApprovalControlTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createAIWorkSessionTestData } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const fixture = createAIWorkSessionTestData(
  process.env.CODEX_TEST_RUN_ID ?? 'API_01',
);

if (connectionString) {
  describe('AI-UX-R1 work-session HTTP and SSE API', () => {
    const database = createDatabase({ connectionString });
    const repository = new PostgresWorkSessionRepository(
      database,
      fixture.schemaName,
    );
    let idSequence = 0;
    const service = new WorkSessionApplicationService({
      repository,
      scopedAuthorizations: new PostgresScopedAuthorizationRepository(
        database,
        fixture.schemaName,
      ),
      authorization: new RequirementAuthorizationService(
        new PostgresAuthorizationPort(database, fixture.schemaName, {
          includeScopedTransmission: true,
          now: () => fixture.turnAt,
        }),
      ),
      now: () => fixture.turnAt,
      idFactory: (kind) =>
        `${fixture.prefix}${kind.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${++idSequence}`,
    });
    let actor: ActorContext = {
      actorId: fixture.accounts.productManager.id,
      roles: ['PRODUCT_MANAGER'] as const,
      teamIds: [fixture.teamId],
      authenticationStatus: 'AUTHENTICATED' as const,
    };
    const server = buildServer({
      workSessionService: service,
      resolveActor: () => actor,
    });

    beforeAll(async () => {
      await dropLifecycleSchema(database, fixture.schemaName);
      await createLifecycleSchema(database, fixture.schemaName);
      await createM1CollaborationTables(database, fixture.schemaName);
      await createM2AgentRunTables(database, fixture.schemaName);
      await createM2ApprovalControlTables(database, fixture.schemaName);
      await createAIUXScopedAuthorizationTables(database, fixture.schemaName);
      await createAIUXWorkSessionTables(database, fixture.schemaName);
      await fixture.seedPrerequisites(database);
      await new PostgresScopedAuthorizationRepository(
        database,
        fixture.schemaName,
      ).grant(
        createScopedActionAuthorization({
          authorizationId: fixture.authorizationId,
          actorId: fixture.accounts.productManager.id,
          requirementId: fixture.requirementId,
          target: 'APPROVED_AI',
          purpose: 'product-work-session',
          materialRefIds: [fixture.materialRefId],
          grantedBy: fixture.accounts.productOwner.id,
          grantorRoles: ['PRODUCT_OWNER'],
          grantedAt: fixture.now,
          validUntil: fixture.grantExpiresAt,
        }),
      );
    });

    afterAll(async () => {
      await server.close();
      await dropLifecycleSchema(database, fixture.schemaName);
      const remaining = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', fixture.schemaName)
        .execute();
      expect(remaining).toEqual([]);
      await database.destroy();
    });

    it('creates, reuses, restores, and lists a persisted Web work session', async () => {
      const payload = {
        schemaVersion: 'create-product-work-session/1',
        teamId: fixture.teamId,
        controlSurface: 'WEB',
        title: '合成需求 AI 作业空间',
      };
      const created = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirementId}/work-sessions`,
        headers: { 'idempotency-key': `${fixture.prefix}CREATE_SESSION` },
        payload,
      });
      const replay = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirementId}/work-sessions`,
        headers: { 'idempotency-key': `${fixture.prefix}CREATE_SESSION` },
        payload,
      });
      const sessionId = created.json().session.id as string;
      const snapshot = await server.inject({
        method: 'GET',
        url: `/api/v1/work-sessions/${sessionId}`,
      });
      const list = await server.inject({
        method: 'GET',
        url: `/api/v1/requirements/${fixture.requirementId}/work-sessions`,
      });

      expect(created.statusCode).toBe(201);
      expect(created.headers.location).toBe(
        `/api/v1/work-sessions/${sessionId}`,
      );
      expect(created.headers.etag).toBe('"0"');
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(snapshot.json()).toMatchObject({
        schemaVersion: 'product-work-session-snapshot/1',
        session: { id: sessionId, lastSequence: 1 },
        requirement: { id: fixture.requirementId, currentStage: 'G0' },
      });
      expect(list.json()).toMatchObject({ items: [{ id: sessionId }] });
    });

    it('projects first-turn readiness without creating a turn or command', async () => {
      const [session] = await repository.listSessions(
        fixture.requirementId,
        fixture.accounts.productManager.id,
        20,
      );
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/work-sessions/${session.id}/readiness`,
      });
      const scoped = database.withSchema(fixture.schemaName);
      const [turns, commands] = await Promise.all([
        scoped
          .selectFrom('product_work_turns')
          .select(({ fn }) => fn.count<number>('id').as('count'))
          .executeTakeFirstOrThrow(),
        scoped
          .selectFrom('product_work_turn_commands')
          .select(({ fn }) => fn.count<number>('id').as('count'))
          .executeTakeFirstOrThrow(),
      ]);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schemaVersion: 'product-work-session-readiness/1',
        sessionId: session.id,
        baselineId: fixture.baselineId,
        bridgeStatus: 'AVAILABLE',
        transmissionStatus: 'READY',
        recommendedContextIds: [fixture.materialRefId],
        recommendedSkillReleaseId: fixture.skillReleaseId,
        contextOptions: [
          {
            materialRefId: fixture.materialRefId,
            referenceType: 'SYNTHETIC_TEXT',
            version: '1',
            sensitivity: 'INTERNAL',
            selectedByDefault: true,
          },
        ],
        skillOptions: [
          {
            releaseId: fixture.skillReleaseId,
            availability: 'AVAILABLE',
            recommended: true,
          },
        ],
        blockers: [],
      });
      expect(turns.count).toBe('0');
      expect(commands.count).toBe('0');
    });

    it('does not resolve an active skill that the same bridge snapshot did not advertise', async () => {
      const unadvertisedSkillId = `${fixture.prefix}SKILL_RELEASE_UNADVERTISED`;
      await database
        .withSchema(fixture.schemaName)
        .insertInto('skill_releases')
        .values({
          id: unadvertisedSkillId,
          skill_key: 'pfc-ai-unadvertised',
          display_name: '未声明 Skill',
          description: '用于验证同快照匹配。',
          source_type: 'LOCAL_ALLOWLIST',
          logical_source: 'project-skill:pfc-ai-unadvertised',
          version: '2026.09.07-r1',
          content_hash: `sha256:${'9'.repeat(64)}`,
          license: null,
          compatible_harnesses: JSON.stringify(['codex-app-server/0.153']),
          required_capabilities: JSON.stringify(['PRODUCT_WORK_TURN']),
          risk_level: 'LOW',
          owner: '产品平台组',
          evaluation_status: 'PASSED',
          enabled_scopes: JSON.stringify(['PRODUCT_WORK_TURN']),
          context_cost: null,
          status: 'ACTIVE',
          created_at: fixture.now,
        })
        .executeTakeFirstOrThrow();

      await expect(
        repository.resolveProductWorkCapability({
          teamId: fixture.teamId,
          skillReleaseId: unadvertisedSkillId,
          at: fixture.turnAt,
        }),
      ).resolves.toBeNull();
    });

    it('does not fall back to an older capability after the latest snapshot becomes invalid', async () => {
      const snapshotId = `${fixture.prefix}BRIDGE_CAPABILITY_INVALID_LATEST`;
      const scoped = database.withSchema(fixture.schemaName);
      await scoped
        .insertInto('bridge_capability_snapshots')
        .values({
          id: snapshotId,
          bridge_id: fixture.bridgeId,
          capabilities: JSON.stringify({ invalid: true }),
          captured_at: '2026-09-07T03:06:00.000Z',
          expires_at: fixture.grantExpiresAt,
        })
        .executeTakeFirstOrThrow();
      try {
        await expect(
          repository.resolveProductWorkCapability({
            teamId: fixture.teamId,
            skillReleaseId: fixture.skillReleaseId,
            at: '2026-09-07T03:07:00.000Z',
          }),
        ).resolves.toBeNull();
      } finally {
        await scoped
          .deleteFrom('bridge_capability_snapshots')
          .where('id', '=', snapshotId)
          .executeTakeFirstOrThrow();
      }
    });

    it('does not fall back to an older capability after the latest snapshot expires', async () => {
      const snapshotId = `${fixture.prefix}BRIDGE_CAPABILITY_EXPIRED_LATEST`;
      const scoped = database.withSchema(fixture.schemaName);
      const previous = await scoped
        .selectFrom('bridge_capability_snapshots')
        .select('capabilities')
        .where('bridge_id', '=', fixture.bridgeId)
        .orderBy('captured_at', 'desc')
        .executeTakeFirstOrThrow();
      await scoped
        .insertInto('bridge_capability_snapshots')
        .values({
          id: snapshotId,
          bridge_id: fixture.bridgeId,
          capabilities: previous.capabilities,
          captured_at: '2026-09-07T03:06:00.000Z',
          expires_at: '2026-09-07T03:06:30.000Z',
        })
        .executeTakeFirstOrThrow();
      try {
        await expect(
          repository.resolveProductWorkCapability({
            teamId: fixture.teamId,
            skillReleaseId: fixture.skillReleaseId,
            at: '2026-09-07T03:07:00.000Z',
          }),
        ).resolves.toBeNull();
      } finally {
        await scoped
          .deleteFrom('bridge_capability_snapshots')
          .where('id', '=', snapshotId)
          .executeTakeFirstOrThrow();
      }
    });

    it('lets a product owner grant and revoke the exact session transmission scope', async () => {
      const [session] = await repository.listSessions(
        fixture.requirementId,
        fixture.accounts.productManager.id,
        20,
      );
      const productManagerDenied = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${session.id}/transmission-authorizations`,
        headers: { 'idempotency-key': `${fixture.prefix}PM_GRANT_DENIED` },
        payload: {
          schemaVersion: 'create-product-work-transmission-authorization/1',
          beneficiaryActorId: fixture.accounts.productManager.id,
          materialRefIds: [fixture.materialRefId],
          validForMinutes: 20,
        },
      });
      actor = {
        actorId: fixture.accounts.productOwner.id,
        roles: ['PRODUCT_OWNER'] as const,
        teamIds: [fixture.teamId],
        authenticationStatus: 'AUTHENTICATED' as const,
      };
      const granted = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${session.id}/transmission-authorizations`,
        headers: { 'idempotency-key': `${fixture.prefix}GRANT_SCOPE` },
        payload: {
          schemaVersion: 'create-product-work-transmission-authorization/1',
          beneficiaryActorId: fixture.accounts.productManager.id,
          materialRefIds: [fixture.materialRefId],
          validForMinutes: 20,
        },
      });
      const grantReplay = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${session.id}/transmission-authorizations`,
        headers: { 'idempotency-key': `${fixture.prefix}GRANT_SCOPE` },
        payload: {
          schemaVersion: 'create-product-work-transmission-authorization/1',
          beneficiaryActorId: fixture.accounts.productManager.id,
          materialRefIds: [fixture.materialRefId],
          validForMinutes: 20,
        },
      });
      const grantConflict = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${session.id}/transmission-authorizations`,
        headers: { 'idempotency-key': `${fixture.prefix}GRANT_SCOPE` },
        payload: {
          schemaVersion: 'create-product-work-transmission-authorization/1',
          beneficiaryActorId: fixture.accounts.productManager.id,
          materialRefIds: [fixture.materialRefId],
          validForMinutes: 25,
        },
      });
      const authorizationId = granted.json().authorization?.authorizationId as
        string | undefined;
      const revoked = await server.inject({
        method: 'POST',
        url: `/api/v1/transmission-authorizations/${authorizationId}/revocations`,
        headers: {
          'idempotency-key': `${fixture.prefix}REVOKE_SCOPE`,
          'if-match': '"0"',
        },
        payload: {
          schemaVersion: 'revoke-product-work-transmission-authorization/1',
        },
      });
      const revokeReplay = await server.inject({
        method: 'POST',
        url: `/api/v1/transmission-authorizations/${authorizationId}/revocations`,
        headers: {
          'idempotency-key': `${fixture.prefix}REVOKE_SCOPE`,
          'if-match': '"0"',
        },
        payload: {
          schemaVersion: 'revoke-product-work-transmission-authorization/1',
        },
      });
      actor = {
        actorId: fixture.accounts.productManager.id,
        roles: ['PRODUCT_MANAGER'] as const,
        teamIds: [fixture.teamId],
        authenticationStatus: 'AUTHENTICATED' as const,
      };

      expect(productManagerDenied.statusCode).toBe(403);
      expect(productManagerDenied.json()).toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      expect(granted.statusCode).toBe(201);
      expect(granted.json()).toMatchObject({
        replayed: false,
        authorization: {
          actorId: fixture.accounts.productManager.id,
          requirementId: fixture.requirementId,
          target: 'APPROVED_AI',
          purpose: 'product-work-session',
          materialRefIds: [fixture.materialRefId],
          status: 'GRANTED',
        },
      });
      expect(grantReplay.statusCode).toBe(200);
      expect(grantReplay.json()).toMatchObject({ replayed: true });
      expect(grantConflict.statusCode).toBe(409);
      expect(grantConflict.json()).toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toMatchObject({
        replayed: false,
        authorization: { status: 'REVOKED', rowVersion: 1 },
      });
      expect(revokeReplay.statusCode).toBe(200);
      expect(revokeReplay.json()).toMatchObject({ replayed: true });
    });

    it('queues exactly one real command and replays the turn by idempotency key', async () => {
      const [session] = await repository.listSessions(
        fixture.requirementId,
        fixture.accounts.productManager.id,
        20,
      );
      const payload = {
        schemaVersion: 'create-product-work-turn/1',
        intentKind: 'ANALYZE_REQUIREMENT',
        message: '请基于当前材料识别待确认问题。',
        contextBindingIds: [fixture.materialRefId],
        skillReleaseId: fixture.skillReleaseId,
      };
      const idempotencyKey = `${fixture.prefix}SUBMIT_TURN`;
      const created = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${session.id}/turns`,
        headers: { 'idempotency-key': idempotencyKey, 'if-match': '"0"' },
        payload,
      });
      const replay = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${session.id}/turns`,
        headers: { 'idempotency-key': idempotencyKey, 'if-match': '"0"' },
        payload,
      });
      const scoped = database.withSchema(fixture.schemaName);
      const commandCount = await scoped
        .selectFrom('product_work_turn_commands')
        .select(({ fn }) => fn.count<number>('id').as('count'))
        .executeTakeFirstOrThrow();

      expect(created.statusCode).toBe(202);
      expect(created.json()).toMatchObject({
        replayed: false,
        turn: { status: 'QUEUED', schemaVersion: 'product-work-turn/1' },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ replayed: true });
      expect(commandCount.count).toBe('1');

      const snapshot = await server.inject({
        method: 'GET',
        url: `/api/v1/work-sessions/${session.id}`,
      });
      expect(snapshot.json()).toMatchObject({
        workspaceEvidence: {
          schemaVersion: 'product-workspace-evidence/1',
          bridgeId: fixture.bridgeId,
          workspaceId: fixture.workspaceId,
          verificationStatus: 'VERIFIED',
          repositoryFingerprint: `sha256:${'d'.repeat(64)}`,
          capabilityGitBaseline: 'd'.repeat(64),
          evidenceStatus: 'MISMATCHED',
          codexAppServer: 'AVAILABLE',
          zedCli: 'UNAVAILABLE',
        },
      });
    });

    it('replays ordered safe events as SSE and rejects stale ETags', async () => {
      const [session] = await repository.listSessions(
        fixture.requirementId,
        fixture.accounts.productManager.id,
        20,
      );
      const events = await server.inject({
        method: 'GET',
        url: `/api/v1/work-sessions/${session.id}/events?after=0`,
        headers: { accept: 'text/event-stream' },
      });
      const stale = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${session.id}/turns`,
        headers: {
          'idempotency-key': `${fixture.prefix}STALE_TURN`,
          'if-match': '"0"',
        },
        payload: {
          schemaVersion: 'create-product-work-turn/1',
          intentKind: 'ANALYZE_REQUIREMENT',
          message: '该请求使用过期会话版本。',
          contextBindingIds: [fixture.materialRefId],
          skillReleaseId: fixture.skillReleaseId,
        },
      });

      expect(events.statusCode).toBe(200);
      expect(events.headers['content-type']).toContain('text/event-stream');
      expect(events.body).toContain('event: SESSION_CREATED');
      expect(events.body).toContain('event: TURN_QUEUED');
      expect(events.body).not.toContain('inputText');
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        code: 'CONTEXT_STALE',
        recoveryAction: 'RELOAD_CURRENT',
      });
    });

    it('distinguishes verified, expired and missing workspace evidence', async () => {
      const scoped = database.withSchema(fixture.schemaName);
      await scoped
        .updateTable('bridge_workspace_bindings')
        .set({ current_git_baseline: 'd'.repeat(64) })
        .where('bridge_id', '=', fixture.bridgeId)
        .where('workspace_id', '=', fixture.workspaceId)
        .executeTakeFirstOrThrow();
      try {
        await expect(
          repository.resolveWorkspaceEvidence({
            teamId: fixture.teamId,
            requirementId: fixture.requirementId,
            bridgeId: fixture.bridgeId,
            at: fixture.turnAt,
          }),
        ).resolves.toMatchObject({
          evidenceStatus: 'VERIFIED',
          capabilityFreshness: 'CURRENT',
          bindingGitBaseline: 'd'.repeat(64),
          capabilityGitBaseline: 'd'.repeat(64),
        });
        await expect(
          repository.resolveWorkspaceEvidence({
            teamId: fixture.teamId,
            requirementId: fixture.requirementId,
            bridgeId: fixture.bridgeId,
            at: new Date(Date.parse(fixture.grantExpiresAt) + 1).toISOString(),
          }),
        ).resolves.toMatchObject({
          evidenceStatus: 'EXPIRED',
          capabilityFreshness: 'EXPIRED',
        });
        await expect(
          repository.resolveWorkspaceEvidence({
            teamId: fixture.teamId,
            requirementId: fixture.requirementId,
            bridgeId: `${fixture.prefix}BRIDGE_MISSING`,
            at: fixture.turnAt,
          }),
        ).resolves.toMatchObject({
          evidenceStatus: 'MISSING',
          bridgeStatus: null,
          workspaceId: null,
        });
      } finally {
        await scoped
          .updateTable('bridge_workspace_bindings')
          .set({ current_git_baseline: null })
          .where('bridge_id', '=', fixture.bridgeId)
          .where('workspace_id', '=', fixture.workspaceId)
          .executeTakeFirstOrThrow();
      }
    });

    it('fails closed for unknown schema versions and a view-only role', async () => {
      const invalidVersion = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirementId}/work-sessions`,
        headers: { 'idempotency-key': `${fixture.prefix}BAD_SCHEMA` },
        payload: {
          schemaVersion: 'create-product-work-session/999',
          controlSurface: 'WEB',
        },
      });
      actor = {
        actorId: fixture.accounts.testOwner.id,
        roles: ['TEST_OWNER'] as const,
        teamIds: [fixture.teamId],
        authenticationStatus: 'AUTHENTICATED' as const,
      };
      const forbidden = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirementId}/work-sessions`,
        headers: { 'idempotency-key': `${fixture.prefix}TEST_OWNER_CREATE` },
        payload: {
          schemaVersion: 'create-product-work-session/1',
          teamId: fixture.teamId,
          controlSurface: 'WEB',
        },
      });
      actor = {
        actorId: fixture.accounts.productManager.id,
        roles: ['PRODUCT_MANAGER'] as const,
        teamIds: [fixture.teamId],
        authenticationStatus: 'AUTHENTICATED' as const,
      };

      expect(invalidVersion.statusCode).toBe(400);
      expect(invalidVersion.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json()).toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
}
