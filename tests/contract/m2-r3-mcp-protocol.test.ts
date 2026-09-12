import { describe, expect, it } from 'vitest';

import {
  BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION,
  MCP_READ_COMMAND_VERSION,
  MCP_READ_EVENT_VERSION,
  parseBridgeCapabilitySnapshot,
  parseMcpReadCommand,
  parseMcpReadEvent,
} from '../../packages/protocol/src/index.ts';

const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe('M2-R3 MCP protocol', () => {
  it('keeps v1 readable and validates bounded v2 MCP inventory', () => {
    expect(
      parseBridgeCapabilitySnapshot({
        snapshotVersion: 'pfc-bridge-capabilities/1',
        capturedAt: '2026-09-09T00:00:00.000Z',
        runtime: {
          nodeVersion: 'v24.20.0',
          codexAppServer: 'AVAILABLE',
          zedCli: 'UNVERIFIED',
        },
        workspaces: [
          {
            workspaceId: 'CODEx_TEST_M2R3_WORKSPACE',
            gitBaseline: 'a'.repeat(40),
          },
        ],
        skills: [],
      }).snapshotVersion,
    ).toBe('pfc-bridge-capabilities/1');

    const v2 = parseBridgeCapabilitySnapshot({
      snapshotVersion: BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION,
      capturedAt: '2026-09-09T00:00:00.000Z',
      runtime: {
        nodeVersion: 'v24.20.0',
        codexAppServer: 'AVAILABLE',
        zedCli: 'UNVERIFIED',
      },
      workspaces: [
        {
          workspaceId: 'CODEx_TEST_M2R3_WORKSPACE',
          gitBaseline: 'a'.repeat(40),
        },
      ],
      skills: [],
      mcp: {
        state: 'AVAILABLE',
        configFingerprint: hash('b'),
        servers: [
          {
            name: 'local-tools',
            runtimeStatus: 'CONNECTED',
            authStatus: 'UNSUPPORTED',
            tools: [
              {
                name: 'inspect_schema',
                inputSchemaHash: hash('c'),
                readOnlyHint: true,
              },
            ],
          },
        ],
      },
    });
    if (v2.snapshotVersion !== BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION) {
      throw new Error('Expected a v2 capability snapshot.');
    }
    expect(v2.mcp.servers[0]?.tools[0]?.name).toBe('inspect_schema');
    expect(JSON.stringify(v2)).not.toMatch(/token|cookie|command|environment/i);
  });

  it('parses an exact leased MCP read command and bounded terminal event', () => {
    const command = parseMcpReadCommand({
      schemaVersion: MCP_READ_COMMAND_VERSION,
      commandId: 'CODEx_TEST_M2R3_MCP_COMMAND',
      commandType: 'EXECUTE_MCP_READ',
      leaseUntil: '2026-09-09T00:05:00.000Z',
      attempt: 1,
      payload: {
        requestId: 'CODEx_TEST_M2R3_MCP_REQUEST',
        sessionId: 'CODEx_TEST_M2R3_SESSION',
        turnId: 'CODEx_TEST_M2R3_TURN',
        capabilityId: 'CODEx_TEST_M2R3_CAPABILITY',
        serverName: 'local-tools',
        toolName: 'inspect_schema',
        inputSchemaHash: hash('a'),
        configFingerprint: hash('b'),
        inputHash: hash('c'),
      },
    });
    expect(command.commandType).toBe('EXECUTE_MCP_READ');

    expect(
      parseMcpReadEvent({
        schemaVersion: MCP_READ_EVENT_VERSION,
        sourceEventId: 'CODEx_TEST_M2R3_MCP_EVENT',
        eventType: 'MCP_READ_COMPLETED',
        occurredAt: '2026-09-09T00:00:02.000Z',
        payload: {
          requestId: command.payload.requestId,
          outputSummary: '3 matching rows',
          outputHash: hash('d'),
          outputBytes: 120,
          truncated: false,
          durationMs: 42,
          threadId: 'CODEx_TEST_M2R3_THREAD',
        },
      }).eventType,
    ).toBe('MCP_READ_COMPLETED');
  });
});
