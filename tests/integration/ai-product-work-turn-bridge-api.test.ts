import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../apps/server/src/app.ts';
import { ProductWorkTurnBridgeApplicationService } from '../../apps/server/src/work-sessions/bridge-application-service.ts';
import type { ProductWorkTurnBridgeRepositoryPort } from '../../apps/server/src/work-sessions/bridge-repository-port.ts';

const now = '2026-09-07T04:00:00.000Z';
const credential = 'CODEx_TEST_AIUX_BRIDGE_CREDENTIAL_001';
const bridgeId = 'CODEx_TEST_AIUX_BRIDGE_001';
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const command = {
  schemaVersion: 'product-work-turn-command/1',
  commandId: 'CODEx_TEST_AIUX_COMMAND_001',
  commandType: 'START_PRODUCT_WORK_TURN',
  leaseUntil: '2026-09-07T04:00:30.000Z',
  attempt: 1,
  afterSequence: 2,
  payload: {
    sessionId: 'CODEx_TEST_AIUX_SESSION_001',
    turnId: 'CODEx_TEST_AIUX_TURN_001',
    turnVersion: 1,
    requirementId: 'CODEx_TEST_AIUX_REQUIREMENT_001',
    openedRequirementVersion: 0,
    baselineId: 'CODEx_TEST_AIUX_BASELINE_001',
    contextBindingIds: ['CODEx_TEST_AIUX_BINDING_001'],
    contextHash: hash('a'),
    skillReleaseId: 'CODEx_TEST_AIUX_SKILL_001',
    skillContentHash: hash('b'),
  },
} as const;
const context = {
  schemaVersion: 'product-work-turn-context/1',
  protocolVersion: 'product-work-turn/1',
  commandId: command.commandId,
  sessionId: command.payload.sessionId,
  turnId: command.payload.turnId,
  contextHash: command.payload.contextHash,
  userMessage: '请分析完全合成的本地材料。',
  contextItems: [
    {
      bindingId: command.payload.contextBindingIds[0],
      contextType: 'MATERIAL_REF',
      targetId: 'CODEx_TEST_AIUX_MATERIAL_001',
      targetVersion: 1,
      contentHash: hash('c'),
      sensitivity: 'INTERNAL',
      content: '完全合成的本地材料正文。',
    },
  ],
  skill: {
    releaseId: command.payload.skillReleaseId,
    contentHash: command.payload.skillContentHash,
  },
} as const;

function headers(messageId: string) {
  return {
    authorization: `Bridge ${credential}`,
    'x-pfc-protocol-version': 'pfc-bridge/1',
    'x-pfc-message-id': messageId,
    'x-pfc-bridge-id': bridgeId,
    'x-pfc-sent-at': now,
    'x-pfc-nonce': `${messageId}-nonce`,
  };
}

describe('AI-UX-R1 independent ProductWorkTurn Bridge API', () => {
  const repository: ProductWorkTurnBridgeRepositoryPort = {
    leaseNextProductWorkTurnCommand: vi.fn(async () => command),
    readLeasedProductWorkTurnContext: vi.fn(async () => context),
    appendProductWorkTurnBridgeEvent: vi.fn(async () => ({
      status: 'APPENDED' as const,
    })),
    acknowledgeProductWorkTurnCommand: vi.fn(
      async () => 'ACKNOWLEDGED' as const,
    ),
  };
  const service = new ProductWorkTurnBridgeApplicationService({
    auth: { authenticateMessage: vi.fn(async () => true) },
    repository,
    now: () => now,
    idFactory: (prefix) => `CODEx_TEST_AIUX_${prefix}_001`,
  });
  const server = buildServer({ productWorkTurnBridgeService: service });

  beforeEach(() => vi.clearAllMocks());

  it('leases an independent command then returns full context via a separate authenticated read', async () => {
    const lease = await server.inject({
      method: 'GET',
      url: '/bridge/v1/product-work-turns/commands/next',
      headers: headers('CODEx_TEST_AIUX_MESSAGE_LEASE'),
    });
    expect(lease.statusCode).toBe(200);
    expect(lease.json()).toEqual(command);
    expect(JSON.stringify(lease.json())).not.toContain('完全合成');

    const read = await server.inject({
      method: 'GET',
      url: `/bridge/v1/product-work-turns/commands/${command.commandId}/context`,
      headers: headers('CODEx_TEST_AIUX_MESSAGE_CONTEXT'),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(context);
    expect(repository.readLeasedProductWorkTurnContext).toHaveBeenCalledWith({
      bridgeId,
      commandId: command.commandId,
      readAt: now,
    });
  });

  it('accepts validated stream events and terminal acknowledgements', async () => {
    const event = await server.inject({
      method: 'POST',
      url: `/bridge/v1/product-work-turns/${command.payload.turnId}/events`,
      headers: headers('CODEx_TEST_AIUX_MESSAGE_EVENT'),
      payload: {
        commandId: command.commandId,
        sessionId: command.payload.sessionId,
        event: {
          schemaVersion: 'product-work-turn-event/1',
          sourceEventId: 'CODEx_TEST_AIUX_SOURCE_EVENT_001',
          eventType: 'TURN_MESSAGE_AVAILABLE',
          expectedSequence: 3,
          occurredAt: now,
          payload: { message: '可见结果。' },
        },
      },
    });
    expect(event.statusCode).toBe(200);
    expect(repository.appendProductWorkTurnBridgeEvent).toHaveBeenCalledOnce();

    const acknowledgement = await server.inject({
      method: 'POST',
      url: `/bridge/v1/product-work-turns/commands/${command.commandId}/acknowledgements`,
      headers: headers('CODEx_TEST_AIUX_MESSAGE_ACK'),
      payload: {
        sessionId: command.payload.sessionId,
        turnId: command.payload.turnId,
        status: 'SUCCEEDED',
        threadId: 'thread-1',
        externalTurnId: 'external-turn-1',
      },
    });
    expect(acknowledgement.statusCode).toBe(202);
    expect(acknowledgement.json()).toEqual({ status: 'ACKNOWLEDGED' });
  });

  it('rejects arbitrary or hidden event fields before persistence', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/bridge/v1/product-work-turns/${command.payload.turnId}/events`,
      headers: headers('CODEx_TEST_AIUX_MESSAGE_INVALID'),
      payload: {
        commandId: command.commandId,
        sessionId: command.payload.sessionId,
        event: {
          schemaVersion: 'product-work-turn-event/1',
          sourceEventId: 'CODEx_TEST_AIUX_SOURCE_EVENT_INVALID',
          eventType: 'TURN_MESSAGE_AVAILABLE',
          expectedSequence: 3,
          occurredAt: now,
          payload: { message: '结果', reasoning: 'forbidden' },
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.appendProductWorkTurnBridgeEvent).not.toHaveBeenCalled();
  });
});
