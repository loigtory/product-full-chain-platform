import { describe, expect, it } from 'vitest';

import {
  assertMcpReadAllowed,
  transitionMcpRead,
} from '../../packages/domain/src/mcp-read.ts';

const registration = {
  status: 'ACTIVE' as const,
  effect: 'READ_ONLY' as const,
  serverName: 'local-tools',
  toolName: 'inspect_schema',
  inputSchemaHash: `sha256:${'a'.repeat(64)}`,
  configFingerprint: `sha256:${'b'.repeat(64)}`,
  allowedTeamIds: ['CODEx_TEST_M2R3_TEAM'],
  allowedRequirementIds: ['CODEx_TEST_M2R3_REQUIREMENT'],
  maxInputBytes: 32_768,
  maxOutputBytes: 262_144,
  timeoutMs: 10_000,
};

const runtime = {
  state: 'AVAILABLE' as const,
  serverName: 'local-tools',
  toolName: 'inspect_schema',
  inputSchemaHash: registration.inputSchemaHash,
  configFingerprint: registration.configFingerprint,
  runtimeStatus: 'CONNECTED' as const,
  authStatus: 'UNSUPPORTED' as const,
  readOnlyHint: true,
};

describe('M2-R3 MCP read policy', () => {
  it('allows only an exact reviewed read-only capability in its registered scope', () => {
    expect(
      assertMcpReadAllowed({
        registration,
        runtime,
        teamId: 'CODEx_TEST_M2R3_TEAM',
        requirementId: 'CODEx_TEST_M2R3_REQUIREMENT',
        input: { query: 'public metadata only' },
        sensitivity: 'INTERNAL',
        transmissionAuthorized: false,
        activeRequestCount: 0,
      }),
    ).toEqual({ inputBytes: 32, timeoutMs: 10_000, maxOutputBytes: 262_144 });
  });

  it.each([
    ['schema', { inputSchemaHash: `sha256:${'c'.repeat(64)}` }],
    ['config', { configFingerprint: `sha256:${'d'.repeat(64)}` }],
    ['tool', { toolName: 'write_schema' }],
  ])('rejects %s drift before execution', (_label, drift) => {
    expect(() =>
      assertMcpReadAllowed({
        registration,
        runtime: { ...runtime, ...drift },
        teamId: 'CODEx_TEST_M2R3_TEAM',
        requirementId: 'CODEx_TEST_M2R3_REQUIREMENT',
        input: {},
        sensitivity: 'PUBLIC',
        transmissionAuthorized: false,
        activeRequestCount: 0,
      }),
    ).toThrowError('MCP_CAPABILITY_DRIFTED');
  });

  it('requires an explicit MCP transmission authorization for restricted material', () => {
    expect(() =>
      assertMcpReadAllowed({
        registration,
        runtime,
        teamId: 'CODEx_TEST_M2R3_TEAM',
        requirementId: 'CODEx_TEST_M2R3_REQUIREMENT',
        input: { materialRef: 'CODEx_TEST_M2R3_RESTRICTED' },
        sensitivity: 'RESTRICTED',
        transmissionAuthorized: false,
        activeRequestCount: 0,
      }),
    ).toThrowError('MCP_TRANSMISSION_AUTHORIZATION_REQUIRED');
  });

  it('does not allow an UNKNOWN request to be queued or run again', () => {
    expect(() => transitionMcpRead('UNKNOWN', 'QUEUED')).toThrowError(
      'MCP_RESULT_UNKNOWN',
    );
    expect(transitionMcpRead('UNKNOWN', 'COMPLETED')).toBe('COMPLETED');
  });
});
