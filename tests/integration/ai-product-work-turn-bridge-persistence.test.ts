import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProductWorkSession,
  createProductWorkTurn,
  transitionProductWorkTurn,
} from '../../packages/domain/src/index.ts';
import {
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
  process.env.CODEX_TEST_RUN_ID ?? 'BRIDGE_PERSISTENCE_01',
);

if (connectionString) {
  describe('AI-UX-R1 ProductWorkTurn Bridge persistence', () => {
    const database = createDatabase({ connectionString });
    const repository = new PostgresWorkSessionRepository(
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
      await repository.createSession({
        session,
        event: fixture.sessionEvent('SESSION_CREATED', 1),
      });
      const received = createProductWorkTurn({
        id: fixture.turnId,
        sessionId: fixture.sessionId,
        sequence: 1,
        intentKind: 'ANALYZE_REQUIREMENT',
        inputText: '请基于当前合成材料给出澄清建议。',
        skillReleaseId: fixture.skillReleaseId,
        createdBy: fixture.accounts.productManager.id,
        createdAt: fixture.turnAt,
      });
      const queued = transitionProductWorkTurn(received, 'QUEUED', {
        occurredAt: fixture.turnAt,
        bridgeId: fixture.bridgeId,
      });
      await repository.createTurn({
        turn: queued,
        expectedSessionVersion: 0,
        contexts: [fixture.contextBinding()],
        command: fixture.startCommand(),
        event: fixture.sessionEvent('TURN_QUEUED', 2),
      });
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

    it('leases only to the bound compatible Bridge without embedding full context', async () => {
      await expect(
        repository.leaseNextProductWorkTurnCommand({
          bridgeId: `${fixture.prefix}BRIDGE_OTHER`,
          leasedAt: '2026-09-07T03:06:00.000Z',
          leaseUntil: '2026-09-07T03:06:30.000Z',
        }),
      ).resolves.toBeNull();

      const command = await repository.leaseNextProductWorkTurnCommand({
        bridgeId: fixture.bridgeId,
        leasedAt: '2026-09-07T03:06:00.000Z',
        leaseUntil: '2026-09-07T03:06:30.000Z',
      });
      expect(command).toMatchObject({
        schemaVersion: 'product-work-turn-command/1',
        commandId: fixture.commandId,
        commandType: 'START_PRODUCT_WORK_TURN',
        attempt: 1,
        afterSequence: 2,
        payload: {
          sessionId: fixture.sessionId,
          turnId: fixture.turnId,
          requirementId: fixture.requirementId,
          baselineId: fixture.baselineId,
          skillReleaseId: fixture.skillReleaseId,
        },
      });
      expect(JSON.stringify(command)).not.toContain('请基于当前');
      expect(JSON.stringify(command)).not.toContain('完全合成');
    });

    it('returns full context only to the active command lease', async () => {
      await expect(
        repository.readLeasedProductWorkTurnContext({
          bridgeId: `${fixture.prefix}BRIDGE_OTHER`,
          commandId: fixture.commandId,
          readAt: '2026-09-07T03:06:10.000Z',
        }),
      ).resolves.toBeNull();

      await expect(
        repository.readLeasedProductWorkTurnContext({
          bridgeId: fixture.bridgeId,
          commandId: fixture.commandId,
          readAt: '2026-09-07T03:06:10.000Z',
        }),
      ).resolves.toMatchObject({
        schemaVersion: 'product-work-turn-context/1',
        userMessage: '请基于当前合成材料给出澄清建议。',
        contextItems: [
          {
            bindingId: fixture.contextBindingId,
            content: '完全合成的 AI 产品作业材料正文。',
          },
        ],
      });
    });

    it('persists streamed events, terminal state, dedupe, and acknowledgement', async () => {
      const base = {
        bridgeId: fixture.bridgeId,
        commandId: fixture.commandId,
        sessionId: fixture.sessionId,
        turnId: fixture.turnId,
        receivedAt: '2026-09-07T03:06:11.000Z',
      };
      const started = {
        schemaVersion: 'product-work-turn-event/1',
        sourceEventId: `${fixture.prefix}SOURCE_STARTED`,
        eventType: 'TURN_STARTED',
        expectedSequence: 3,
        occurredAt: '2026-09-07T03:06:11.000Z',
        payload: { threadId: 'thread-1', turnId: 'external-turn-1' },
      } as const;
      await expect(
        repository.appendProductWorkTurnBridgeEvent({
          ...base,
          event: started,
        }),
      ).resolves.toEqual({ status: 'APPENDED' });
      await expect(
        repository.appendProductWorkTurnBridgeEvent({
          ...base,
          event: started,
        }),
      ).resolves.toEqual({ status: 'DUPLICATE' });
      await expect(
        repository.appendProductWorkTurnBridgeEvent({
          ...base,
          event: {
            schemaVersion: 'product-work-turn-event/1',
            sourceEventId: `${fixture.prefix}SOURCE_MESSAGE`,
            eventType: 'TURN_MESSAGE_AVAILABLE',
            expectedSequence: 4,
            occurredAt: '2026-09-07T03:06:12.000Z',
            payload: { message: '已形成可审查建议。' },
          },
        }),
      ).resolves.toEqual({ status: 'APPENDED' });
      await expect(
        repository.appendProductWorkTurnBridgeEvent({
          ...base,
          event: {
            schemaVersion: 'product-work-turn-event/1',
            sourceEventId: `${fixture.prefix}SOURCE_COMPLETED`,
            eventType: 'TURN_COMPLETED',
            expectedSequence: 5,
            occurredAt: '2026-09-07T03:06:13.000Z',
            payload: { status: 'COMPLETED' },
          },
        }),
      ).resolves.toEqual({ status: 'APPENDED' });
      await expect(
        repository.acknowledgeProductWorkTurnCommand({
          bridgeId: fixture.bridgeId,
          commandId: fixture.commandId,
          sessionId: fixture.sessionId,
          turnId: fixture.turnId,
          status: 'SUCCEEDED',
          threadId: 'thread-1',
          externalTurnId: 'external-turn-1',
          acknowledgedAt: '2026-09-07T03:06:14.000Z',
        }),
      ).resolves.toBe('ACKNOWLEDGED');
      await expect(repository.findTurn(fixture.turnId)).resolves.toMatchObject({
        status: 'COMPLETED',
        visibleResponse: '已形成可审查建议。',
        externalIds: { threadId: 'thread-1', turnId: 'external-turn-1' },
      });
      await expect(
        repository.findSession(fixture.sessionId),
      ).resolves.toMatchObject({
        activeTurnId: null,
        lastSequence: 5,
      });
    });
  });
}
