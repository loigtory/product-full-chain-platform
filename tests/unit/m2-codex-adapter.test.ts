import { describe, expect, it, vi } from 'vitest';

import {
  CodexAppServerAdapter,
  normalizeAppServerNotification,
  redactAgentEvidence,
  type AppServerRpc,
} from '../../packages/codex-adapter/src/index.ts';

describe('M2 Codex App Server adapter', () => {
  it('starts a fixed Skill in a read-only thread and emits normalized events', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const listeners: Array<(message: unknown) => void> = [];
    const rpc: AppServerRpc = {
      async request(method, params) {
        calls.push({ method, params });
        if (method === 'initialize') return { platformFamily: 'windows' };
        if (method === 'skills/extraRoots/set') return {};
        if (method === 'skills/list') {
          return {
            data: [
              {
                cwd: 'C:\\CODEx_TEST_M2\\repo',
                skills: [
                  {
                    name: 'pfc-readonly-artifact-check',
                    path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
                    enabled: true,
                  },
                ],
                errors: [],
              },
            ],
          };
        }
        if (method === 'thread/start') return { thread: { id: 'thread-1' } };
        if (method === 'turn/start') {
          queueMicrotask(() => {
            listeners.forEach((listener) =>
              listener({
                method: 'turn/started',
                params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
              }),
            );
            listeners.forEach((listener) =>
              listener({
                method: 'item/agentMessage/delta',
                params: {
                  threadId: 'thread-1',
                  turnId: 'turn-1',
                  itemId: 'message-1',
                  delta: 'status: PASS',
                },
              }),
            );
            listeners.forEach((listener) =>
              listener({
                method: 'item/completed',
                params: {
                  threadId: 'thread-1',
                  turnId: 'turn-1',
                  item: { id: 'message-1', type: 'agentMessage', text: '' },
                },
              }),
            );
            listeners.forEach((listener) =>
              listener({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-1',
                  turn: { id: 'turn-1', status: 'completed' },
                },
              }),
            );
          });
          return { turn: { id: 'turn-1' } };
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
    const events: unknown[] = [];
    const adapter = new CodexAppServerAdapter(rpc, {
      requestTimeoutMs: 2_000,
    });

    const result = await adapter.runReadonly(
      {
        workspacePath: 'C:\\CODEx_TEST_M2\\repo',
        objective: 'Check the registered artifact only.',
        skill: {
          name: 'pfc-readonly-artifact-check',
          path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
        },
      },
      (event) => {
        events.push(event);
      },
    );

    expect(result).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      status: 'SUCCEEDED',
    });
    expect(calls.map(({ method }) => method)).toEqual([
      'initialize',
      'skills/extraRoots/set',
      'skills/list',
      'thread/start',
      'turn/start',
    ]);
    expect(calls[3]?.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
    });
    expect(calls[4]?.params).toMatchObject({
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      input: [
        { type: 'text' },
        {
          type: 'skill',
          name: 'pfc-readonly-artifact-check',
          path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
        },
      ],
    });
    expect(events).toEqual([
      expect.objectContaining({ eventType: 'TURN_STARTED' }),
      {
        eventType: 'AGENT_MESSAGE',
        summary: {
          itemId: 'message-1',
          messageCompleted: true,
          text: 'status: PASS',
        },
      },
      expect.objectContaining({ eventType: 'RESULT_RECORDED' }),
    ]);
  });

  it('fails closed when the fixed Skill is not available to the App Server', async () => {
    const rpc: AppServerRpc = {
      async request(method) {
        if (method === 'initialize') return {};
        if (method === 'skills/extraRoots/set') return {};
        if (method === 'skills/list') {
          return {
            data: [{ cwd: 'C:\\CODEx_TEST_M2\\repo', skills: [], errors: [] }],
          };
        }
        throw new Error(`UNEXPECTED_METHOD:${method}`);
      },
      notify: vi.fn(),
      onNotification: vi.fn(() => () => undefined),
      close: vi.fn(async () => undefined),
    };

    await expect(
      new CodexAppServerAdapter(rpc).runReadonly(
        {
          workspacePath: 'C:\\CODEx_TEST_M2\\repo',
          objective: 'Check the registered artifact only.',
          skill: {
            name: 'pfc-readonly-artifact-check',
            path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
          },
        },
        () => undefined,
      ),
    ).rejects.toThrow('APP_SERVER_SKILL_NOT_AVAILABLE');
  });

  it.each([
    [
      '**BLOCKED:** artifact identity is missing',
      'FAILED',
      'AGENT_RESULT_BLOCKED',
      'RUN_FAILED',
    ],
    [
      'Artifact looked reasonable.',
      'UNKNOWN',
      'AGENT_RESULT_STATUS_MISSING',
      'RUN_UNKNOWN',
    ],
  ] as const)(
    'maps semantic result %s to %s',
    async (messageText, expectedStatus, expectedReason, terminalEvent) => {
      const listeners: Array<(message: unknown) => void> = [];
      const rpc: AppServerRpc = {
        async request(method) {
          if (method === 'initialize') return {};
          if (method === 'skills/extraRoots/set') return {};
          if (method === 'skills/list') {
            return {
              data: [
                {
                  cwd: 'C:\\CODEx_TEST_M2\\repo',
                  skills: [
                    {
                      name: 'pfc-readonly-artifact-check',
                      path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
                      enabled: true,
                    },
                  ],
                  errors: [],
                },
              ],
            };
          }
          if (method === 'thread/start') return { thread: { id: 'thread-1' } };
          if (method === 'turn/start') {
            queueMicrotask(() => {
              for (const listener of listeners) {
                listener({
                  method: 'turn/started',
                  params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
                });
                listener({
                  method: 'item/completed',
                  params: {
                    threadId: 'thread-1',
                    item: {
                      id: 'message-1',
                      type: 'agentMessage',
                      text: messageText,
                    },
                  },
                });
                listener({
                  method: 'turn/completed',
                  params: {
                    threadId: 'thread-1',
                    turn: { id: 'turn-1', status: 'completed' },
                  },
                });
              }
            });
            return { turn: { id: 'turn-1' } };
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
      const events: string[] = [];

      const result = await new CodexAppServerAdapter(rpc).runReadonly(
        {
          workspacePath: 'C:\\CODEx_TEST_M2\\repo',
          objective: 'Check the registered artifact only.',
          skill: {
            name: 'pfc-readonly-artifact-check',
            path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
          },
        },
        (event) => {
          events.push(event.eventType);
        },
      );

      expect(result).toMatchObject({
        status: expectedStatus,
        reasonCode: expectedReason,
      });
      expect(events).toContain(terminalEvent);
      expect(events).not.toContain('RESULT_RECORDED');
    },
  );

  it('redacts credentials and absolute paths before evidence leaves the adapter', () => {
    const raw = [
      'Authorization: Bearer CODEx_TEST_SECRET',
      'cookie=CODEx_TEST_COOKIE',
      'C:\\Users\\product.owner\\private.txt',
    ].join('\n');
    const redacted = redactAgentEvidence(raw, {
      userProfile: 'C:\\Users\\product.owner',
      workspacePath: 'C:\\Users\\product.owner\\repo',
    });

    expect(redacted).not.toContain('CODEx_TEST_SECRET');
    expect(redacted).not.toContain('CODEx_TEST_COOKIE');
    expect(redacted).not.toContain('product.owner');
  });

  it('maps interrupted and failed terminal notifications without raw payloads', () => {
    expect(
      normalizeAppServerNotification({
        method: 'turn/completed',
        params: { turn: { id: 'turn-1', status: 'interrupted' } },
      }),
    ).toMatchObject({ eventType: 'TURN_INTERRUPTED' });
    expect(
      normalizeAppServerNotification({
        method: 'turn/completed',
        params: {
          turn: {
            id: 'turn-2',
            status: 'failed',
            error: { message: 'token=CODEx_TEST_SECRET' },
          },
        },
      }),
    ).toEqual({
      eventType: 'RUN_FAILED',
      summary: { status: 'failed' },
    });
  });

  it('records bounded item lifecycle summaries and ignores streaming deltas', () => {
    expect(
      normalizeAppServerNotification({
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-1', delta: 'streaming token' },
      }),
    ).toBeNull();
    expect(
      normalizeAppServerNotification({
        method: 'item/commandExecution/outputDelta',
        params: { threadId: 'thread-1', delta: 'streaming output' },
      }),
    ).toBeNull();
    expect(
      normalizeAppServerNotification({
        method: 'item/started',
        params: {
          threadId: 'thread-1',
          item: { id: 'item-1', type: 'commandExecution' },
        },
      }),
    ).toEqual({
      eventType: 'COMMAND_STARTED',
      summary: { itemId: 'item-1' },
    });
    const completedMessage = normalizeAppServerNotification(
      {
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          item: {
            id: 'item-2',
            type: 'agentMessage',
            text: `token=CODEx_TEST_SECRET ${'a'.repeat(2_100)}`,
          },
        },
      },
      { workspacePath: 'C:\\CODEx_TEST_M2\\repo' },
    );
    expect(completedMessage).toMatchObject({
      eventType: 'AGENT_MESSAGE',
      summary: {
        itemId: 'item-2',
        messageCompleted: true,
      },
    });
    expect(completedMessage?.summary.text).not.toContain('CODEx_TEST_SECRET');
    expect(String(completedMessage?.summary.text)).toHaveLength(2_000);
  });

  it('waits for asynchronous evidence delivery in notification order', async () => {
    const listeners: Array<(message: unknown) => void> = [];
    const rpc: AppServerRpc = {
      async request(method) {
        if (method === 'initialize') return {};
        if (method === 'skills/extraRoots/set') return {};
        if (method === 'skills/list') {
          return {
            data: [
              {
                cwd: 'C:\\CODEx_TEST_M2\\repo',
                skills: [
                  {
                    name: 'pfc-readonly-artifact-check',
                    path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
                    enabled: true,
                  },
                ],
                errors: [],
              },
            ],
          };
        }
        if (method === 'thread/start') return { thread: { id: 'thread-1' } };
        if (method === 'turn/start') {
          queueMicrotask(() => {
            listeners.forEach((listener) =>
              listener({
                method: 'turn/started',
                params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
              }),
            );
            listeners.forEach((listener) =>
              listener({
                method: 'item/completed',
                params: {
                  threadId: 'thread-1',
                  item: {
                    id: 'message-1',
                    type: 'agentMessage',
                    text: 'status: PASS',
                  },
                },
              }),
            );
            listeners.forEach((listener) =>
              listener({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-1',
                  turn: { id: 'turn-1', status: 'completed' },
                },
              }),
            );
          });
          return { turn: { id: 'turn-1' } };
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
    const observed: string[] = [];

    await new CodexAppServerAdapter(rpc).runReadonly(
      {
        workspacePath: 'C:\\CODEx_TEST_M2\\repo',
        objective: 'Check the registered artifact only.',
        skill: {
          name: 'pfc-readonly-artifact-check',
          path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
        },
      },
      async (event) => {
        if (event.eventType === 'TURN_STARTED') {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        observed.push(event.eventType);
      },
    );

    expect(observed).toEqual([
      'TURN_STARTED',
      'AGENT_MESSAGE',
      'RESULT_RECORDED',
    ]);
  });

  it('fails closed when pending event delivery exceeds the bounded queue', async () => {
    const listeners: Array<(message: unknown) => void> = [];
    const rpc: AppServerRpc = {
      async request(method) {
        if (method === 'initialize') return {};
        if (method === 'skills/extraRoots/set') return {};
        if (method === 'skills/list') {
          return {
            data: [
              {
                cwd: 'C:\\CODEx_TEST_M2\\repo',
                skills: [
                  {
                    name: 'pfc-readonly-artifact-check',
                    path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
                    enabled: true,
                  },
                ],
                errors: [],
              },
            ],
          };
        }
        if (method === 'thread/start') return { thread: { id: 'thread-1' } };
        if (method === 'turn/start') {
          queueMicrotask(() => {
            listeners.forEach((listener) =>
              listener({
                method: 'turn/started',
                params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
              }),
            );
            listeners.forEach((listener) =>
              listener({
                method: 'item/started',
                params: {
                  threadId: 'thread-1',
                  item: { id: 'item-1', type: 'commandExecution' },
                },
              }),
            );
          });
          return { turn: { id: 'turn-1' } };
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
    let releaseDelivery: () => void = () => undefined;
    const deliveryBlocked = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const adapter = new CodexAppServerAdapter(rpc, {
      requestTimeoutMs: 100,
      maxPendingEvents: 1,
    });

    const running = adapter.runReadonly(
      {
        workspacePath: 'C:\\CODEx_TEST_M2\\repo',
        objective: 'Check the registered artifact only.',
        skill: {
          name: 'pfc-readonly-artifact-check',
          path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
        },
      },
      () => deliveryBlocked,
    );

    await expect(running).rejects.toThrow('APP_SERVER_EVENT_BACKPRESSURE');
    releaseDelivery();
  });
});
