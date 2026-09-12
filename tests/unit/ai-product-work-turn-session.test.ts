import { describe, expect, it, vi } from 'vitest';

import {
  CodexProductWorkTurnSession,
  type AppServerRpc,
} from '../../packages/codex-adapter/src/index.ts';

function rpcHarness() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const listeners: Array<(message: unknown) => void> = [];
  const rpc: AppServerRpc = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'initialize') return {};
      if (method === 'skills/extraRoots/set') return {};
      if (method === 'skills/list') {
        return {
          data: [
            {
              cwd: 'C:\\CODEx_TEST_AIUX',
              skills: [
                {
                  name: 'pfc-ai-product-work-session',
                  path: 'C:\\CODEx_TEST_AIUX\\skills\\pfc-ai-product-work-session\\SKILL.md',
                  enabled: true,
                },
              ],
              errors: [],
            },
          ],
        };
      }
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') return { turn: { id: 'external-turn-1' } };
      if (method === 'turn/interrupt') return {};
      if (method === 'thread/read') {
        return {
          thread: {
            turns: [{ id: 'external-turn-1', status: 'inProgress' }],
          },
        };
      }
      throw new Error(`UNEXPECTED_METHOD:${method}`);
    },
    notify: vi.fn(),
    onNotification(listener) {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    close: vi.fn(async () => undefined),
  };
  return { rpc, calls, listeners };
}

const input = {
  workspacePath: 'C:\\CODEx_TEST_AIUX',
  objective: 'Use only the supplied synthetic context and do not call tools.',
  skill: {
    name: 'pfc-ai-product-work-session',
    path: 'C:\\CODEx_TEST_AIUX\\skills\\pfc-ai-product-work-session\\SKILL.md',
  },
};

describe('AI-UX-R1 Codex product work turn session', () => {
  it('starts an ephemeral read-only no-network turn and streams visible output', async () => {
    const harness = rpcHarness();
    const events: unknown[] = [];
    const session = await CodexProductWorkTurnSession.start(
      harness.rpc,
      input,
      (event) => {
        events.push(event);
      },
    );

    harness.listeners.forEach((listener) =>
      listener({
        method: 'turn/started',
        params: {
          threadId: 'thread-1',
          turn: { id: 'external-turn-1' },
        },
      }),
    );
    harness.listeners.forEach((listener) =>
      listener({
        method: 'item/started',
        params: {
          threadId: 'thread-1',
          turnId: 'external-turn-1',
          item: {
            id: 'user-message-1',
            type: 'userMessage',
            clientId: null,
            content: [],
          },
        },
      }),
    );
    harness.listeners.forEach((listener) =>
      listener({
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'external-turn-1',
          item: {
            id: 'message-1',
            type: 'agentMessage',
            text: JSON.stringify({
              message: '先确认验收口径。',
              proposal: JSON.stringify({
                kind: 'ANSWER_QUESTION',
                target: {
                  aggregateType: 'QUESTION',
                  aggregateId: 'question-1',
                  rowVersion: 1,
                },
                changeSet: {
                  kind: 'ANSWER_QUESTION',
                  questionId: 'question-1',
                  answer: '合成回答',
                },
                displayDiff: [],
                confirmationRequirement: 'PRODUCT_OWNER',
              }),
            }),
          },
        },
      }),
    );
    harness.listeners.forEach((listener) =>
      listener({
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'external-turn-1', status: 'completed' },
        },
      }),
    );

    await expect(session.completion).resolves.toMatchObject({
      status: 'SUCCEEDED',
      threadId: 'thread-1',
      turnId: 'external-turn-1',
    });
    expect(events).toEqual([
      {
        eventType: 'TURN_STARTED',
        payload: { threadId: 'thread-1', turnId: 'external-turn-1' },
      },
      {
        eventType: 'TURN_MESSAGE_AVAILABLE',
        payload: { message: '先确认验收口径。' },
      },
      {
        eventType: 'TURN_PROPOSAL_AVAILABLE',
        payload: {
          proposal: expect.objectContaining({
            kind: 'ANSWER_QUESTION',
          }),
        },
      },
    ]);
    const threadStart = harness.calls.find(
      ({ method }) => method === 'thread/start',
    )?.params as Record<string, unknown>;
    expect(threadStart).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    });
    expect(threadStart).not.toHaveProperty('dynamicTools');
    expect(threadStart).not.toHaveProperty('environments');
    expect(threadStart).not.toHaveProperty('selectedCapabilityRoots');
    const turnStart = harness.calls.find(
      ({ method }) => method === 'turn/start',
    )?.params as Record<string, unknown>;
    expect(turnStart).toMatchObject({
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    });
    expect(turnStart).not.toHaveProperty('environments');
    await session.close();
  });

  it('supports interrupt and read-only verification without restarting work', async () => {
    const harness = rpcHarness();
    const session = await CodexProductWorkTurnSession.start(
      harness.rpc,
      input,
      () => undefined,
    );
    await session.interrupt();
    await expect(session.verify()).resolves.toMatchObject({
      status: 'RUNNING',
      threadId: 'thread-1',
      turnId: 'external-turn-1',
    });
    expect(harness.calls.map(({ method }) => method)).toContain(
      'turn/interrupt',
    );
    await session.close();
  });

  it('fails closed if the model attempts to invoke a tool', async () => {
    const harness = rpcHarness();
    const session = await CodexProductWorkTurnSession.start(
      harness.rpc,
      input,
      () => undefined,
    );
    harness.listeners.forEach((listener) =>
      listener({
        method: 'item/started',
        params: {
          threadId: 'thread-1',
          turnId: 'external-turn-1',
          item: { id: 'tool-1', type: 'commandExecution' },
        },
      }),
    );
    await expect(session.completion).resolves.toMatchObject({
      status: 'FAILED',
      reasonCode: 'PRODUCT_WORK_TURN_TOOL_FORBIDDEN',
    });
    await session.close();
  });

  it('preserves only the structured App Server failure category', async () => {
    const harness = rpcHarness();
    const session = await CodexProductWorkTurnSession.start(
      harness.rpc,
      input,
      () => undefined,
    );
    harness.listeners.forEach((listener) =>
      listener({
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: {
            id: 'external-turn-1',
            status: 'failed',
            error: {
              message: 'Invalid output schema; must not be retained',
              codexErrorInfo: 'other',
              additionalDetails: 'must not be retained',
              misalignment: null,
            },
          },
        },
      }),
    );

    await expect(session.completion).resolves.toMatchObject({
      status: 'FAILED',
      reasonCode: 'APP_SERVER_TURN_FAILED_OUTPUT_SCHEMA_INVALID',
    });
    await session.close();
  });
});
