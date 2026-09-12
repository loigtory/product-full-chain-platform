import { describe, expect, it, vi } from 'vitest';

import { ProductWorkTurnWorker } from '../../apps/bridge/src/product-work-turn-worker.ts';
import type {
  ProductWorkTurnGatewayPort,
  ProductWorkTurnManagedSession,
} from '../../apps/bridge/src/product-work-turn-ports.ts';

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const context = {
  schemaVersion: 'product-work-turn-context/1',
  protocolVersion: 'product-work-turn/1',
  commandId: 'CODEx_TEST_AIUX_COMMAND_001',
  sessionId: 'CODEx_TEST_AIUX_SESSION_001',
  turnId: 'CODEx_TEST_AIUX_TURN_001',
  contextHash: hash('a'),
  userMessage: '请分析当前材料。',
  contextItems: [
    {
      bindingId: 'CODEx_TEST_AIUX_BINDING_001',
      contextType: 'MATERIAL_REF',
      targetId: 'CODEx_TEST_AIUX_MATERIAL_001',
      targetVersion: 1,
      contentHash: hash('c'),
      sensitivity: 'INTERNAL',
      content: '完全合成的材料正文。',
    },
  ],
  skill: {
    releaseId: 'CODEx_TEST_AIUX_SKILL_RELEASE_001',
    contentHash: hash('b'),
  },
} as const;
const startCommand = {
  schemaVersion: 'product-work-turn-command/1',
  commandId: context.commandId,
  commandType: 'START_PRODUCT_WORK_TURN',
  leaseUntil: '2026-09-07T04:00:30.000Z',
  attempt: 1,
  afterSequence: 2,
  payload: {
    sessionId: context.sessionId,
    turnId: context.turnId,
    turnVersion: 1,
    requirementId: 'CODEx_TEST_AIUX_REQUIREMENT_001',
    openedRequirementVersion: 0,
    baselineId: 'CODEx_TEST_AIUX_BASELINE_001',
    contextBindingIds: [context.contextItems[0].bindingId],
    contextHash: context.contextHash,
    skillReleaseId: context.skill.releaseId,
    skillContentHash: context.skill.contentHash,
  },
} as const;

function harness(status: 'SUCCEEDED' | 'UNKNOWN' = 'SUCCEEDED') {
  const submitted: unknown[] = [];
  const acknowledgements: unknown[] = [];
  let command: unknown = startCommand;
  const gateway: ProductWorkTurnGatewayPort = {
    async claimNext() {
      const value = command;
      command = null;
      return value;
    },
    async fetchContext() {
      return context;
    },
    async submitEvent(event) {
      submitted.push(event);
      return { status: 'APPENDED' as const };
    },
    async acknowledge(input) {
      acknowledgements.push(input);
    },
  };
  const interrupt = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  let resolveCompletion!: (value: {
    threadId: string;
    turnId: string;
    status: 'SUCCEEDED' | 'UNKNOWN';
    reasonCode?: string;
  }) => void;
  const completion = new Promise<{
    threadId: string;
    turnId: string;
    status: 'SUCCEEDED' | 'UNKNOWN';
    reasonCode?: string;
  }>((resolve) => {
    resolveCompletion = resolve;
  });
  const session: ProductWorkTurnManagedSession = {
    completion,
    interrupt,
    async verify() {
      return {
        status: 'RUNNING' as const,
        threadId: 'thread-1',
        turnId: 'external-turn-1',
      };
    },
    close,
  };
  const runnerFactory = vi.fn(async (_input, onEvent) => {
    await onEvent({
      eventType: 'TURN_STARTED',
      payload: { threadId: 'thread-1', turnId: 'external-turn-1' },
    });
    await onEvent({
      eventType: 'TURN_MESSAGE_AVAILABLE',
      payload: { message: '已形成一条可见建议。' },
    });
    return session;
  });
  const worker = new ProductWorkTurnWorker({
    bridgeId: 'CODEx_TEST_AIUX_BRIDGE_001',
    workspacePath: 'C:\\CODEx_TEST_AIUX',
    gateway,
    registry: {
      async resolveSkill() {
        return {
          name: 'pfc-ai-product-work-session',
          path: 'C:\\CODEx_TEST_AIUX\\skills\\pfc-ai-product-work-session\\SKILL.md',
          contentHash: hash('b'),
          enabled: true,
        };
      },
    },
    runnerFactory,
    now: () => '2026-09-07T04:00:00.000Z',
    idFactory: (prefix) => `CODEx_TEST_AIUX_${prefix}_001`,
  });
  return {
    worker,
    submitted,
    acknowledgements,
    interrupt,
    close,
    resolve: () =>
      resolveCompletion({
        threadId: 'thread-1',
        turnId: 'external-turn-1',
        status,
        ...(status === 'UNKNOWN'
          ? { reasonCode: 'APP_SERVER_CONNECTION_LOST' }
          : {}),
      }),
  };
}

describe('AI-UX-R1 ProductWorkTurn Bridge worker', () => {
  it('fetches full context only after leasing and streams bounded events', async () => {
    const test = harness();
    await expect(test.worker.runOnce()).resolves.toBe('STARTED');
    test.resolve();
    await test.worker.drain();

    expect(test.submitted).toHaveLength(3);
    expect(test.submitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ eventType: 'TURN_STARTED' }),
        }),
        expect.objectContaining({
          event: expect.objectContaining({
            eventType: 'TURN_MESSAGE_AVAILABLE',
          }),
        }),
        expect.objectContaining({
          event: expect.objectContaining({ eventType: 'TURN_COMPLETED' }),
        }),
      ]),
    );
    expect(test.acknowledgements).toEqual([
      expect.objectContaining({ status: 'SUCCEEDED' }),
    ]);
    expect(test.close).toHaveBeenCalledOnce();
  });

  it('reports UNKNOWN and does not retry when terminal truth is unavailable', async () => {
    const test = harness('UNKNOWN');
    await test.worker.runOnce();
    test.resolve();
    await test.worker.drain();
    expect(test.submitted.at(-1)).toMatchObject({
      event: {
        eventType: 'TURN_UNKNOWN',
        payload: { reasonCode: 'APP_SERVER_CONNECTION_LOST' },
      },
    });
    expect(test.acknowledgements).toEqual([
      expect.objectContaining({ status: 'UNKNOWN' }),
    ]);
  });

  it('rejects context hash drift before starting Codex', async () => {
    const test = harness();
    (
      test.worker as unknown as {
        options: { gateway: ProductWorkTurnGatewayPort };
      }
    ).options.gateway.fetchContext = async () => ({
      ...context,
      contextHash: hash('f'),
    });
    await expect(test.worker.runOnce()).resolves.toBe('REJECTED');
    expect(test.acknowledgements).toEqual([
      expect.objectContaining({
        status: 'REJECTED',
        reasonCode: 'PRODUCT_WORK_TURN_CONTEXT_MISMATCH',
      }),
    ]);
  });
});
