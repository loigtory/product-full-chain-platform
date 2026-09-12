import { describe, expect, it } from 'vitest';

import {
  BRIDGE_PROTOCOL_VERSION,
  capabilityState,
  eventDedupeKey,
  parseBridgeCommand,
  parseBridgeCapabilitySnapshot,
  parseBridgeEnvelope,
} from '../../packages/protocol/src/index.ts';

describe('M2 Bridge protocol', () => {
  it('accepts the frozen version and rejects unknown versions', () => {
    const message = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      messageId: 'CODEx_TEST_M2_MESSAGE_001',
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      sentAt: '2026-09-06T02:00:00.000Z',
      nonce: 'CODEx_TEST_M2_NONCE_001',
      kind: 'HEARTBEAT',
      payload: { status: 'ONLINE' },
    };

    expect(parseBridgeEnvelope(message)).toEqual(message);
    expect(() =>
      parseBridgeEnvelope({ ...message, protocolVersion: 'pfc-bridge/999' }),
    ).toThrowError('BRIDGE_PROTOCOL_VERSION_UNSUPPORTED');
  });

  it('derives stable event dedupe keys without claiming exactly-once delivery', () => {
    expect(
      eventDedupeKey({
        bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
        runId: 'CODEx_TEST_M2_RUN_001',
        sourceEventId: 'CODEx_TEST_M2_EVENT_001',
      }),
    ).toBe(
      'CODEx_TEST_M2_BRIDGE_001:CODEx_TEST_M2_RUN_001:CODEx_TEST_M2_EVENT_001',
    );
  });

  it('represents detected Zed configuration without claiming connection', () => {
    expect(
      capabilityState({ installed: true, configured: true, verified: false }),
    ).toBe('UNVERIFIED');
    expect(
      capabilityState({ installed: true, configured: true, verified: true }),
    ).toBe('AVAILABLE');
    expect(
      capabilityState({ installed: false, configured: false, verified: false }),
    ).toBe('UNAVAILABLE');
  });

  it('accepts only bounded read-only R1 commands', () => {
    const command = {
      commandId: 'CODEx_TEST_M2_COMMAND_001',
      runId: 'CODEx_TEST_M2_RUN_001',
      commandType: 'START_READ_ONLY_RUN',
      leaseUntil: '2026-09-06T06:05:00.000Z',
      attempt: 1,
      afterSequence: 2,
      payload: {
        requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
        baselineId: 'CODEx_TEST_M2_BASELINE_001',
        workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
        gitBaseline: '0123456789abcdef0123456789abcdef01234567',
        skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
        skillContentHash:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
        artifactSourceRef: 'standards/requirement.md',
        artifactContentHash:
          'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        objectiveKey: 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK',
        accessMode: 'READ_ONLY',
      },
    };

    expect(parseBridgeCommand(command)).toEqual(command);
    expect(() =>
      parseBridgeCommand({
        ...command,
        payload: { ...command.payload, accessMode: 'WORKSPACE_WRITE' },
      }),
    ).toThrowError('BRIDGE_R1_READ_ONLY_REQUIRED');
    expect(() =>
      parseBridgeCommand({ ...command, commandType: 'SHELL' }),
    ).toThrowError('BRIDGE_COMMAND_TYPE_UNSUPPORTED');
    expect(() =>
      parseBridgeCommand({
        ...command,
        payload: { ...command.payload, artifactSourceRef: '../secret.md' },
      }),
    ).toThrowError('BRIDGE_COMMAND_ARTIFACT_SOURCE_REF_INVALID');
  });

  it('parses bounded workspace-write and control commands without arbitrary shell input', () => {
    const common = {
      leaseUntil: '2026-09-06T06:05:00.000Z',
      attempt: 1,
      afterSequence: 2,
    };
    const write = {
      ...common,
      commandId: 'CODEx_TEST_M2_WRITE_COMMAND_001',
      runId: 'CODEx_TEST_M2_RUN_001',
      commandType: 'START_WORKSPACE_WRITE_RUN',
      payload: {
        requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
        baselineId: 'CODEx_TEST_M2_BASELINE_001',
        workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
        gitBaseline: '0123456789abcdef0123456789abcdef01234567',
        skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
        skillContentHash: `sha256:${'a'.repeat(64)}`,
        artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
        artifactSourceRef: 'standards/requirement.md',
        artifactContentHash: `sha256:${'b'.repeat(64)}`,
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        runScope: {
          allowedRelativePaths: ['standards/requirement.md'],
          allowedActions: ['EDIT_FILES'],
          networkAccess: false,
          maxChangedFiles: 1,
          maxChangedBytes: 20_000,
          expiresAt: '2026-09-06T06:10:00.000Z',
        },
        runScopeHash: `sha256:${'c'.repeat(64)}`,
        objectiveKey: 'CONTROLLED_ARTIFACT_EDIT',
        accessMode: 'WORKSPACE_WRITE',
      },
    };
    const interrupt = {
      ...common,
      commandId: 'CODEx_TEST_M2_INTERRUPT_COMMAND_001',
      runId: write.runId,
      commandType: 'INTERRUPT_RUN',
      payload: {
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    };
    const resolution = {
      ...common,
      commandId: 'CODEx_TEST_M2_APPROVAL_COMMAND_001',
      runId: write.runId,
      commandType: 'RESOLVE_APPROVAL',
      payload: {
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        approvalId: 'CODEx_TEST_M2_APPROVAL_001',
        appServerRequestId: '42',
        approvalKind: 'FILE_CHANGE',
        decision: 'accept',
      },
    };
    const verify = {
      ...common,
      commandId: 'CODEx_TEST_M2_VERIFY_COMMAND_001',
      runId: write.runId,
      commandType: 'VERIFY_RUN_STATE',
      payload: { executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001' },
    };

    expect(parseBridgeCommand(write)).toEqual(write);
    expect(parseBridgeCommand(interrupt)).toEqual(interrupt);
    expect(parseBridgeCommand(resolution)).toEqual(resolution);
    expect(parseBridgeCommand(verify)).toEqual(verify);
    expect(() =>
      parseBridgeCommand({
        ...resolution,
        payload: { ...resolution.payload, command: 'rm -rf /' },
      }),
    ).toThrowError('BRIDGE_COMMAND_PAYLOAD_FIELDS_INVALID');
    expect(() =>
      parseBridgeCommand({
        ...write,
        payload: {
          ...write.payload,
          runScope: { ...write.payload.runScope, networkAccess: true },
        },
      }),
    ).toThrowError('BRIDGE_COMMAND_NETWORK_ACCESS_FORBIDDEN');
  });

  it('accepts only credential-free capability snapshots with fixed baselines', () => {
    const snapshot = {
      snapshotVersion: 'pfc-bridge-capabilities/1',
      capturedAt: '2026-09-06T06:00:00.000Z',
      runtime: {
        nodeVersion: 'v24.20.0',
        codexAppServer: 'AVAILABLE',
        zedCli: 'UNVERIFIED',
      },
      workspaces: [
        {
          workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
          gitBaseline: '0123456789abcdef0123456789abcdef01234567',
        },
      ],
      skills: [
        {
          releaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
          contentHash: `sha256:${'a'.repeat(64)}`,
        },
      ],
      productWorkTurn: {
        state: 'AVAILABLE',
        protocolVersion: 'product-work-turn/1',
      },
    };

    expect(parseBridgeCapabilitySnapshot(snapshot)).toEqual(snapshot);
    expect(() =>
      parseBridgeCapabilitySnapshot({ ...snapshot, credential: 'forbidden' }),
    ).toThrowError('BRIDGE_CAPABILITY_FIELDS_INVALID');
    expect(() =>
      parseBridgeCapabilitySnapshot({
        ...snapshot,
        workspaces: [{ ...snapshot.workspaces[0], path: 'C:\\private' }],
      }),
    ).toThrowError('BRIDGE_CAPABILITY_WORKSPACE_FIELDS_INVALID');
    expect(
      parseBridgeCapabilitySnapshot({
        ...snapshot,
        productWorkTurn: undefined,
      }).productWorkTurn,
    ).toBeUndefined();
  });
});
