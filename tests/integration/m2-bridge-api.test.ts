import { afterAll, describe, expect, it, vi } from 'vitest';

import { BridgeApplicationService } from '../../apps/server/src/bridges/application-service.ts';
import { buildServer } from '../../apps/server/src/app.ts';
import { BRIDGE_PROTOCOL_VERSION } from '../../packages/protocol/src/index.ts';

const bridgeId = 'CODEx_TEST_M2_BRIDGE_001';
const commandId = 'CODEx_TEST_M2_COMMAND_001';
const runId = 'CODEx_TEST_M2_RUN_001';
const now = '2026-09-06T06:00:00.000Z';
const command = {
  commandId,
  runId,
  commandType: 'START_READ_ONLY_RUN' as const,
  leaseUntil: '2026-09-06T06:00:30.000Z',
  attempt: 1,
  afterSequence: 2,
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
    objectiveKey: 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK' as const,
    accessMode: 'READ_ONLY' as const,
  },
};

function headers(messageId: string) {
  return {
    authorization: 'Bridge CODEx_TEST_M2_LOCAL_CREDENTIAL_001',
    'x-pfc-protocol-version': BRIDGE_PROTOCOL_VERSION,
    'x-pfc-message-id': messageId,
    'x-pfc-bridge-id': bridgeId,
    'x-pfc-sent-at': now,
    'x-pfc-nonce': `${messageId}_NONCE`,
  };
}

describe('M2 Bridge HTTP API', () => {
  const repository = {
    authenticateMessage: vi.fn(async () => true),
    recordCapabilitySnapshot: vi.fn(async () => true),
    expireDueApprovals: vi.fn(async () => 0),
    leaseNextCommand: vi.fn(async () => command),
    appendEvent: vi.fn(async () => ({ status: 'APPENDED' as const })),
    acknowledgeCommand: vi.fn(async () => 'ACKNOWLEDGED' as const),
    commandOwnsRun: vi.fn(async () => true),
    findRun: vi.fn(async () => ({
      id: runId,
      requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
      baselineId: 'CODEx_TEST_M2_BASELINE_001',
      workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
      gitBaseline: 'a'.repeat(40),
      skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
      artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
      parentRunId: null,
      operation: 'CONTROLLED_ARTIFACT_EDIT' as const,
      accessMode: 'WORKSPACE_WRITE' as const,
      status: 'RUNNING' as const,
      resultOutcome: null,
      executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
      runScope: null,
      runScopeHash: `sha256:${'a'.repeat(64)}`,
      bridgeId,
      codexThreadId: null,
      codexTurnId: null,
      resultSummary: null,
      failureReason: null,
      externalIds: { threadId: null, turnId: null },
      executionStartedAt: now,
      cancelRequestedAt: null,
      terminalAt: null,
      createdBy: 'CODEx_TEST_M2_ACTOR_001',
      createdAt: now,
      updatedAt: now,
      rowVersion: 1,
    })),
    createApproval: vi.fn(async () => ({
      status: 'CREATED' as const,
      approval: null,
      afterSequence: 4,
    })),
    recordCapsule: vi.fn(async () => true),
  };
  const service = new BridgeApplicationService({
    repository,
    now: () => now,
    eventIdFactory: () => 'CODEx_TEST_M2_EVENT_FIXED',
  });
  const server = buildServer({ bridgeService: service });

  afterAll(async () => server.close());

  it('leases a bounded read-only command with independent Bridge credentials', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/bridge/v1/commands/next',
      headers: headers('CODEx_TEST_M2_MESSAGE_CLAIM'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(command);
    expect(repository.leaseNextCommand).toHaveBeenCalledWith(
      expect.objectContaining({ bridgeId }),
    );
  });

  it('accepts normalized events and terminal acknowledgement', async () => {
    const eventResponse = await server.inject({
      method: 'POST',
      url: `/bridge/v1/runs/${runId}/events`,
      headers: headers('CODEx_TEST_M2_MESSAGE_EVENT'),
      payload: {
        commandId,
        sourceEventId: 'CODEx_TEST_M2_SOURCE_EVENT_001',
        expectedSequence: 3,
        event: {
          eventType: 'TURN_STARTED',
          summary: { turnId: 'CODEx_TEST_M2_TURN_001' },
        },
        occurredAt: now,
      },
    });
    const acknowledgement = await server.inject({
      method: 'POST',
      url: `/bridge/v1/commands/${commandId}/acknowledgements`,
      headers: headers('CODEx_TEST_M2_MESSAGE_ACK'),
      payload: {
        runId,
        status: 'SUCCEEDED',
        threadId: 'CODEx_TEST_M2_THREAD_001',
        turnId: 'CODEx_TEST_M2_TURN_001',
        acknowledgedAt: '2036-09-06T06:00:00.000Z',
      },
    });

    expect(eventResponse.statusCode).toBe(202);
    expect(eventResponse.json()).toEqual({ status: 'APPENDED' });
    expect(repository.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ commandId }),
    );
    expect(acknowledgement.statusCode).toBe(202);
    expect(acknowledgement.json()).toEqual({ status: 'ACKNOWLEDGED' });
    expect(repository.acknowledgeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledgedAt: now }),
    );
  });

  it('accepts a bounded capability snapshot through Bridge authentication', async () => {
    const snapshot = {
      snapshotVersion: 'pfc-bridge-capabilities/1',
      capturedAt: now,
      runtime: {
        nodeVersion: 'v24.20.0',
        codexAppServer: 'UNVERIFIED',
        zedCli: 'UNVERIFIED',
      },
      workspaces: [
        {
          workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
          gitBaseline: command.payload.gitBaseline,
        },
      ],
      skills: [
        {
          releaseId: command.payload.skillReleaseId,
          contentHash: command.payload.skillContentHash,
        },
      ],
    };
    const response = await server.inject({
      method: 'POST',
      url: '/bridge/v1/capability-snapshots',
      headers: headers('CODEx_TEST_M2_MESSAGE_CAPABILITIES'),
      payload: snapshot,
    });

    expect(response.statusCode).toBe(202);
    expect(repository.recordCapabilitySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ bridgeId, snapshot }),
    );
  });

  it('rejects missing credentials and unsupported protocol versions', async () => {
    const headersWithoutAuthorization: Record<string, string> = headers(
      'CODEx_TEST_M2_MESSAGE_NO_AUTH',
    );
    delete headersWithoutAuthorization.authorization;
    const missingCredential = await server.inject({
      method: 'GET',
      url: '/bridge/v1/commands/next',
      headers: headersWithoutAuthorization,
    });
    const unsupported = await server.inject({
      method: 'GET',
      url: '/bridge/v1/commands/next',
      headers: {
        ...headers('CODEx_TEST_M2_MESSAGE_BAD_PROTOCOL'),
        'x-pfc-protocol-version': 'pfc-bridge/999',
      },
    });

    expect(missingCredential.statusCode).toBe(401);
    expect(missingCredential.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects nested or oversized event summaries at the HTTP boundary', async () => {
    const nested = await server.inject({
      method: 'POST',
      url: `/bridge/v1/runs/${runId}/events`,
      headers: headers('CODEx_TEST_M2_MESSAGE_NESTED_SUMMARY'),
      payload: {
        commandId,
        sourceEventId: 'CODEx_TEST_M2_SOURCE_EVENT_NESTED',
        expectedSequence: 3,
        event: {
          eventType: 'AGENT_MESSAGE',
          summary: { nested: { secret: 'not-allowed' } },
        },
        occurredAt: now,
      },
    });

    expect(nested.statusCode).toBe(400);
    expect(nested.json()).toMatchObject({ code: 'VALIDATION_FAILED' });

    const futureEvent = await server.inject({
      method: 'POST',
      url: `/bridge/v1/runs/${runId}/events`,
      headers: headers('CODEx_TEST_M2_MESSAGE_FUTURE_EVENT'),
      payload: {
        commandId,
        sourceEventId: 'CODEx_TEST_M2_SOURCE_EVENT_FUTURE',
        expectedSequence: 3,
        event: {
          eventType: 'AGENT_MESSAGE',
          summary: { text: 'sanitized' },
        },
        occurredAt: '2036-09-06T06:00:00.000Z',
      },
    });
    expect(futureEvent.statusCode).toBe(400);
    expect(futureEvent.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('accepts a 2000-character Agent message without widening other event summaries', async () => {
    const agentMessage = await server.inject({
      method: 'POST',
      url: `/bridge/v1/runs/${runId}/events`,
      headers: headers('CODEx_TEST_M2_MESSAGE_AGENT_2000'),
      payload: {
        commandId,
        sourceEventId: 'CODEx_TEST_M2_SOURCE_AGENT_2000',
        expectedSequence: 3,
        event: {
          eventType: 'AGENT_MESSAGE',
          summary: { text: 'a'.repeat(2_000) },
        },
        occurredAt: now,
      },
    });
    const commandSummary = await server.inject({
      method: 'POST',
      url: `/bridge/v1/runs/${runId}/events`,
      headers: headers('CODEx_TEST_M2_MESSAGE_COMMAND_1001'),
      payload: {
        commandId,
        sourceEventId: 'CODEx_TEST_M2_SOURCE_COMMAND_1001',
        expectedSequence: 3,
        event: {
          eventType: 'COMMAND_COMPLETED',
          summary: { text: 'a'.repeat(1_001) },
        },
        occurredAt: now,
      },
    });

    expect(agentMessage.statusCode).toBe(202);
    expect(commandSummary.statusCode).toBe(400);
    expect(commandSummary.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('binds approval requests to the leased write command', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/bridge/v1/runs/${runId}/approvals`,
      headers: headers('CODEx_TEST_M2_MESSAGE_APPROVAL'),
      payload: {
        commandId,
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        appServerRequestId: 'CODEx_TEST_M2_APP_REQUEST_001',
        threadId: 'CODEx_TEST_M2_THREAD_001',
        turnId: 'CODEx_TEST_M2_TURN_001',
        itemId: 'CODEx_TEST_M2_ITEM_001',
        callbackId: null,
        kind: 'FILE_CHANGE',
        requestedScope: {
          allowedRelativePaths: ['docs/requirement.md'],
          allowedActions: ['EDIT_FILES'],
          networkAccess: false,
          maxChangedFiles: 1,
          maxChangedBytes: 4096,
        },
        outsideCapsule: false,
        requestedAt: now,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.commandOwnsRun).toHaveBeenCalledWith({
      bridgeId,
      commandId,
      runId,
      executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
    });
  });

  it('rejects unsafe approval paths and capsule diffs at the HTTP boundary', async () => {
    const unsafeApproval = await server.inject({
      method: 'POST',
      url: `/bridge/v1/runs/${runId}/approvals`,
      headers: headers('CODEx_TEST_M2_MESSAGE_UNSAFE_APPROVAL'),
      payload: {
        commandId,
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        appServerRequestId: 'CODEx_TEST_M2_APP_REQUEST_002',
        threadId: 'CODEx_TEST_M2_THREAD_001',
        turnId: 'CODEx_TEST_M2_TURN_001',
        itemId: 'CODEx_TEST_M2_ITEM_002',
        callbackId: null,
        kind: 'FILE_CHANGE',
        requestedScope: {
          allowedRelativePaths: ['../outside.txt'],
          allowedActions: ['EDIT_FILES'],
          networkAccess: false,
          maxChangedFiles: 1,
          maxChangedBytes: 4096,
        },
        outsideCapsule: true,
        requestedAt: now,
      },
    });
    const unsafeCapsule = await server.inject({
      method: 'POST',
      url: `/bridge/v1/runs/${runId}/capsules`,
      headers: headers('CODEx_TEST_M2_MESSAGE_UNSAFE_CAPSULE'),
      payload: {
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        sourceGitBaseline: 'a'.repeat(40),
        scopeHash: `sha256:${'b'.repeat(64)}`,
        beforeManifestHash: `sha256:${'c'.repeat(64)}`,
        afterManifestHash: `sha256:${'d'.repeat(64)}`,
        lifecycle: 'VERIFIED',
        diffSummary: {
          changedFiles: -1,
          changedBytes: -1,
          changedPaths: ['../outside.txt'],
        },
        occurredAt: now,
      },
    });

    expect(unsafeApproval.statusCode).toBe(400);
    expect(unsafeCapsule.statusCode).toBe(400);
    expect(repository.createApproval).not.toHaveBeenCalled();
    expect(repository.recordCapsule).not.toHaveBeenCalled();
  });
});
