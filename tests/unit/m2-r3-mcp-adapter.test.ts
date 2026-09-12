import { describe, expect, it, vi } from 'vitest';

import {
  CodexMcpReadSession,
  type AppServerRpc,
} from '../../packages/codex-adapter/src/index.ts';

describe('M2-R3 Codex MCP adapter', () => {
  it('returns a bounded, hash-addressed inventory without config or credentials', async () => {
    const rpc: AppServerRpc = {
      request: vi.fn(async (method) => {
        if (method === 'initialize') return {};
        if (method === 'thread/start') {
          return { thread: { id: 'inventory-thread-1' } };
        }
        if (method === 'mcpServerStatus/list') {
          return {
            data: [
              {
                name: 'local-tools',
                runtimeStatus: 'connected',
                pluginId: null,
                serverInfo: { name: 'Local tools', version: '1.0.0' },
                tools: {
                  inspect_schema: {
                    name: 'inspect_schema',
                    description: 'Read public schema metadata.',
                    inputSchema: {
                      type: 'object',
                      properties: { table: { type: 'string' } },
                    },
                    annotations: { readOnlyHint: true },
                  },
                },
                resources: [],
                resourceTemplates: [],
                authStatus: 'unsupported',
              },
            ],
            nextCursor: null,
          };
        }
        throw new Error(`UNEXPECTED_METHOD:${method}`);
      }),
      notify: vi.fn(),
      onNotification: vi.fn(() => () => undefined),
      close: vi.fn(async () => undefined),
    };

    const inventory = await new CodexMcpReadSession(rpc).listInventory();

    expect(inventory.state).toBe('AVAILABLE');
    expect(rpc.request).toHaveBeenCalledWith(
      'mcpServerStatus/list',
      expect.objectContaining({ threadId: 'inventory-thread-1' }),
    );
    expect(inventory.configFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(inventory.servers).toEqual([
      expect.objectContaining({
        name: 'local-tools',
        runtimeStatus: 'CONNECTED',
        authStatus: 'UNSUPPORTED',
        tools: [
          expect.objectContaining({
            name: 'inspect_schema',
            inputSchemaHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            readOnlyHint: true,
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(inventory)).not.toMatch(
      /description|properties|token|cookie/i,
    );
  });

  it('calls only the exact inventoried tool and redacts the archived result', async () => {
    const requests: string[] = [];
    const started = vi.fn(async (threadId: string) => {
      expect(threadId).toBe('thread-1');
      expect(requests).not.toContain('mcpServer/tool/call');
    });
    const rpc: AppServerRpc = {
      async request(method) {
        requests.push(method);
        if (method === 'initialize') return {};
        if (method === 'mcpServerStatus/list') {
          return {
            data: [
              {
                name: 'local-tools',
                runtimeStatus: 'connected',
                pluginId: null,
                serverInfo: null,
                tools: {
                  inspect_schema: {
                    name: 'inspect_schema',
                    inputSchema: { type: 'object' },
                    annotations: { readOnlyHint: true },
                  },
                },
                resources: [],
                resourceTemplates: [],
                authStatus: 'unsupported',
              },
            ],
            nextCursor: null,
          };
        }
        if (method === 'thread/start') return { thread: { id: 'thread-1' } };
        if (method === 'mcpServer/tool/call') {
          return {
            content: [
              {
                type: 'text',
                text: 'Authorization: Bearer CODEx_TEST_SECRET\nrows=3',
              },
            ],
            isError: false,
          };
        }
        throw new Error(`UNEXPECTED_METHOD:${method}`);
      },
      notify: vi.fn(),
      onNotification: vi.fn(() => () => undefined),
      close: vi.fn(async () => undefined),
    };
    const adapter = new CodexMcpReadSession(rpc);
    const inventory = await adapter.listInventory();
    const tool = inventory.servers[0]!.tools[0]!;

    const result = await adapter.call({
      serverName: 'local-tools',
      toolName: 'inspect_schema',
      input: { table: 'requirements' },
      expectedInputSchemaHash: tool.inputSchemaHash,
      expectedConfigFingerprint: inventory.configFingerprint,
      timeoutMs: 1_000,
      maxOutputBytes: 262_144,
      onStarted: started,
    });

    expect(requests).toEqual([
      'initialize',
      'thread/start',
      'mcpServerStatus/list',
      'thread/start',
      'mcpServerStatus/list',
      'mcpServer/tool/call',
    ]);
    expect(result.outputSummary).toContain('rows=3');
    expect(result.outputSummary).not.toContain('CODEx_TEST_SECRET');
    expect(result.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.threadId).toBe('thread-1');
    expect(started).toHaveBeenCalledOnce();
  });
});
