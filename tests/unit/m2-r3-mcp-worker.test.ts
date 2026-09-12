import { createHash } from 'node:crypto';

import {
  MCP_READ_COMMAND_VERSION,
  MCP_READ_CONTEXT_VERSION,
  type McpReadCommand,
} from '@pfc/protocol';
import { describe, expect, it, vi } from 'vitest';

import { McpReadWorker } from '../../apps/bridge/src/mcp-read-worker.ts';
import type {
  McpReadGatewayPort,
  McpReadRunnerPort,
} from '../../apps/bridge/src/mcp-read-ports.ts';

const hash = (value: string) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const contextInput = { query: 'CODEx_TEST_M2R3_READ_ONLY' } as const;
const inputHash = hash(JSON.stringify(contextInput));

const command: McpReadCommand = {
  schemaVersion: MCP_READ_COMMAND_VERSION,
  commandId: 'CODEx_TEST_M2R3_COMMAND_001',
  commandType: 'EXECUTE_MCP_READ',
  leaseUntil: '2026-09-09T10:01:00.000Z',
  attempt: 1,
  payload: {
    requestId: 'CODEx_TEST_M2R3_REQUEST_001',
    sessionId: 'CODEx_TEST_M2R3_SESSION_001',
    turnId: 'CODEx_TEST_M2R3_TURN_001',
    capabilityId: 'CODEx_TEST_M2R3_CAPABILITY_001',
    serverName: 'local-readonly',
    toolName: 'inspect',
    inputSchemaHash: hash('schema'),
    configFingerprint: hash('config'),
    inputHash,
  },
};

function setup(
  call: McpReadRunnerPort['call'] = vi.fn(async (input) => {
    await input.onStarted?.('CODEx_TEST_M2R3_THREAD_001');
    return {
      threadId: 'CODEx_TEST_M2R3_THREAD_001',
      outputSummary: '{"rows":1}',
      outputHash: hash('{"rows":1}'),
      outputBytes: 10,
      truncated: false,
      isError: false,
    };
  }),
) {
  const submitted: unknown[] = [];
  const gateway: McpReadGatewayPort = {
    claimNext: vi.fn(async () => command),
    fetchContext: vi.fn(async () => ({
      schemaVersion: MCP_READ_CONTEXT_VERSION,
      commandId: command.commandId,
      requestId: command.payload.requestId,
      input: contextInput,
      sensitivity: 'INTERNAL',
      limits: { timeoutMs: 1_000, maxOutputBytes: 256 },
    })),
    submitEvent: vi.fn(async (input) => {
      submitted.push(input.event);
      return { status: 'APPENDED' as const };
    }),
  };
  const runner: McpReadRunnerPort = {
    call,
    close: vi.fn(async () => undefined),
  };
  const worker = new McpReadWorker({
    bridgeId: 'CODEx_TEST_M2R3_BRIDGE_001',
    gateway,
    runnerFactory: () => runner,
    now: () => '2026-09-09T10:00:00.000Z',
    idFactory: (prefix) => `${prefix}_001`,
  });
  return { worker, gateway, runner, submitted };
}

describe('M2-R3 MCP read Bridge worker', () => {
  it('submits STARTED before the read-only result and then archives a bounded completion', async () => {
    const { worker, runner, submitted } = setup();

    await expect(worker.runOnce()).resolves.toBe('COMPLETED');

    expect(submitted).toEqual([
      expect.objectContaining({ eventType: 'MCP_READ_STARTED' }),
      expect.objectContaining({
        eventType: 'MCP_READ_COMPLETED',
        payload: expect.objectContaining({
          outputSummary: '{"rows":1}',
          outputBytes: 10,
        }),
      }),
    ]);
    expect(runner.close).toHaveBeenCalledOnce();
  });

  it('marks a post-start ambiguous failure UNKNOWN and never retries the tool', async () => {
    const call = vi.fn(
      async (input: Parameters<McpReadRunnerPort['call']>[0]) => {
        await input.onStarted?.('CODEx_TEST_M2R3_THREAD_002');
        throw new Error('MCP_RESULT_UNKNOWN');
      },
    );
    const { worker, submitted } = setup(call);

    await expect(worker.runOnce()).resolves.toBe('UNKNOWN');

    expect(call).toHaveBeenCalledOnce();
    expect(submitted).toEqual([
      expect.objectContaining({ eventType: 'MCP_READ_STARTED' }),
      expect.objectContaining({
        eventType: 'MCP_READ_UNKNOWN',
        payload: expect.objectContaining({ reasonCode: 'MCP_RESULT_UNKNOWN' }),
      }),
    ]);
  });

  it('fails before execution when the leased context hash does not match', async () => {
    const { worker, gateway, runner, submitted } = setup();
    vi.mocked(gateway.fetchContext).mockResolvedValueOnce({
      schemaVersion: MCP_READ_CONTEXT_VERSION,
      commandId: command.commandId,
      requestId: command.payload.requestId,
      input: { query: 'TAMPERED' },
      sensitivity: 'INTERNAL',
      limits: { timeoutMs: 1_000, maxOutputBytes: 256 },
    });

    await expect(worker.runOnce()).resolves.toBe('FAILED');

    expect(runner.call).not.toHaveBeenCalled();
    expect(submitted).toEqual([
      expect.objectContaining({
        eventType: 'MCP_READ_FAILED',
        payload: expect.objectContaining({
          reasonCode: 'MCP_READ_CONTEXT_MISMATCH',
          threadId: null,
        }),
      }),
    ]);
  });
});
