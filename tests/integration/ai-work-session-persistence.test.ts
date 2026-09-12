import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createActionProposal,
  createProductWorkSession,
  createProductWorkTurn,
  createScopedActionAuthorization,
  transitionProductWorkTurn,
} from '../../packages/domain/src/index.ts';
import {
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
  process.env.CODEX_TEST_RUN_ID ?? 'PERSISTENCE_01',
);

if (connectionString) {
  describe('AI-UX-R1 isolated PostgreSQL persistence', () => {
    const database = createDatabase({ connectionString });
    const authorizations = new PostgresScopedAuthorizationRepository(
      database,
      fixture.schemaName,
    );
    const sessions = new PostgresWorkSessionRepository(
      database,
      fixture.schemaName,
    );

    beforeAll(async () => {
      await dropLifecycleSchema(database, fixture.schemaName);
      await createLifecycleSchema(database, fixture.schemaName);
      await createM1CollaborationTables(database, fixture.schemaName);
      await createM2AgentRunTables(database, fixture.schemaName);
      await createM2ApprovalControlTables(database, fixture.schemaName);
      await createAIUXScopedAuthorizationTables(database, fixture.schemaName);
      await createAIUXWorkSessionTables(database, fixture.schemaName);
      await fixture.seedPrerequisites(database);
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, fixture.schemaName);
      const remaining = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', fixture.schemaName)
        .execute();
      expect(remaining).toEqual([]);
      await database.destroy();
    });

    it('creates the eight isolated AI-UX tables', async () => {
      const tables = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', fixture.schemaName)
        .where('table_name', 'like', 'product_%')
        .orderBy('table_name')
        .execute();
      const authorizationTables = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', fixture.schemaName)
        .where('table_name', 'like', 'scoped_action_authorization%')
        .orderBy('table_name')
        .execute();

      expect(
        [...authorizationTables, ...tables]
          .map((item) => item.table_name)
          .sort(),
      ).toEqual([
        'product_action_proposals',
        'product_work_context_bindings',
        'product_work_session_events',
        'product_work_sessions',
        'product_work_turn_commands',
        'product_work_turns',
        'scoped_action_authorization_material_refs',
        'scoped_action_authorizations',
      ]);
    });

    it('persists, reads, and revokes an exact scoped authorization atomically', async () => {
      const authorization = createScopedActionAuthorization({
        authorizationId: fixture.authorizationId,
        actorId: fixture.accounts.productManager.id,
        requirementId: fixture.requirementId,
        target: 'APPROVED_AI',
        purpose: 'requirements-analysis',
        materialRefIds: [fixture.materialRefId],
        grantedBy: fixture.accounts.productOwner.id,
        grantorRoles: ['PRODUCT_OWNER'],
        grantedAt: fixture.now,
        validUntil: fixture.grantExpiresAt,
      });
      await authorizations.grant(authorization);

      await expect(
        authorizations.listCurrent({
          actorId: fixture.accounts.productManager.id,
          requirementId: fixture.requirementId,
          at: fixture.turnAt,
        }),
      ).resolves.toEqual([authorization]);
      await authorizations.revoke({
        authorizationId: authorization.authorizationId,
        expectedRowVersion: 0,
        revokedBy: fixture.accounts.productOwner.id,
        revokedAt: fixture.turnAt,
      });
      await expect(
        authorizations.listCurrent({
          actorId: fixture.accounts.productManager.id,
          requirementId: fixture.requirementId,
          at: fixture.turnAt,
        }),
      ).resolves.toEqual([]);
    });

    it('persists one active session, one active turn, contexts, proposal, command, and ordered events', async () => {
      const session = createProductWorkSession({
        id: fixture.sessionId,
        teamId: fixture.teamId,
        requirementId: fixture.requirementId,
        openedRequirementVersion: 0,
        currentRequirementVersion: 0,
        openedBaselineId: fixture.baselineId,
        openedStage: 'G0',
        ownerId: fixture.accounts.productManager.id,
        createdBy: fixture.accounts.productManager.id,
        createdAt: fixture.now,
      });
      const created = await sessions.createSession({
        session,
        event: fixture.sessionEvent('SESSION_CREATED', 1),
      });
      await expect(
        sessions.createSession({
          session: { ...session, id: `${fixture.prefix}SESSION_DUPLICATE` },
          event: fixture.sessionEvent('SESSION_CREATED', 1),
        }),
      ).rejects.toThrow();

      const received = createProductWorkTurn({
        id: fixture.turnId,
        sessionId: fixture.sessionId,
        sequence: 1,
        intentKind: 'ANALYZE_REQUIREMENT',
        inputText: '请梳理当前材料并形成登记建议。',
        skillReleaseId: fixture.skillReleaseId,
        createdBy: fixture.accounts.productManager.id,
        createdAt: fixture.turnAt,
      });
      const queued = transitionProductWorkTurn(received, 'QUEUED', {
        occurredAt: fixture.turnAt,
      });
      await sessions.createTurn({
        turn: queued,
        expectedSessionVersion: created.rowVersion,
        contexts: [fixture.contextBinding()],
        command: fixture.startCommand(),
        event: fixture.sessionEvent('TURN_QUEUED', 2),
      });
      const proposal = createActionProposal(fixture.actionProposalInput());
      await sessions.createProposal({
        proposal,
        expectedSessionVersion: created.rowVersion + 1,
        event: fixture.sessionEvent('TURN_PROPOSAL_AVAILABLE', 3),
      });

      await expect(
        sessions.findSession(fixture.sessionId),
      ).resolves.toMatchObject({
        activeTurnId: fixture.turnId,
        lastSequence: 3,
        rowVersion: 2,
      });
      await expect(sessions.listTurns(fixture.sessionId, 50)).resolves.toEqual([
        expect.objectContaining({ id: fixture.turnId, status: 'QUEUED' }),
      ]);
      await expect(
        sessions.findProposal(fixture.proposalId),
      ).resolves.toMatchObject({
        kind: 'ANSWER_QUESTION',
        status: 'PENDING_CONFIRMATION',
      });
      await expect(
        sessions.listEvents(fixture.sessionId, 0, 200),
      ).resolves.toMatchObject({
        reloadRequired: false,
        items: [
          { sequence: 1, type: 'SESSION_CREATED' },
          { sequence: 2, type: 'TURN_QUEUED' },
          { sequence: 3, type: 'TURN_PROPOSAL_AVAILABLE' },
        ],
      });
    });
  });
}
