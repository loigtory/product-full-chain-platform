import { describe, expect, it } from 'vitest';

import {
  createAgentRun,
  transitionAgentRun,
} from '../../packages/domain/src/index.ts';

const baseInput = {
  id: 'CODEx_TEST_M2_RUN_001',
  requirementId: 'CODEx_TEST_M2_REQ_001',
  baselineId: 'CODEx_TEST_M2_BASELINE_001',
  workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
  gitBaseline: '0123456789abcdef0123456789abcdef01234567',
  skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
  operation: 'ARTIFACT_CHECK' as const,
  accessMode: 'READ_ONLY' as const,
  createdBy: 'CODEx_TEST_M2_ACCOUNT_001',
  createdAt: '2026-09-06T02:00:00.000Z',
};

const writeScope = {
  allowedRelativePaths: ['standards/requirement.md'],
  allowedActions: ['EDIT_FILES', 'FORMAT'] as const,
  networkAccess: false as const,
  maxChangedFiles: 2,
  maxChangedBytes: 20_000,
  expiresAt: '2026-09-06T02:10:00.000Z',
};

describe('M2 AgentRun domain', () => {
  it('creates a complete read-only run context', () => {
    const run = createAgentRun(baseInput);

    expect(run.status).toBe('QUEUED');
    expect(run.rowVersion).toBe(0);
    expect(run.gitBaseline).toBe(baseInput.gitBaseline);
    expect(run.externalIds).toEqual({ threadId: null, turnId: null });
    expect(run.resultOutcome).toBeNull();
    expect(run.runScope).toBeNull();
  });

  it('creates a controlled workspace-write run only with an immutable bounded scope', () => {
    const run = createAgentRun({
      ...baseInput,
      operation: 'CONTROLLED_ARTIFACT_EDIT',
      accessMode: 'WORKSPACE_WRITE',
      executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
      runScope: writeScope,
      runScopeHash: `sha256:${'a'.repeat(64)}`,
    });

    expect(run).toMatchObject({
      operation: 'CONTROLLED_ARTIFACT_EDIT',
      accessMode: 'WORKSPACE_WRITE',
      status: 'WAITING_APPROVAL',
      executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
      runScope: writeScope,
      runScopeHash: `sha256:${'a'.repeat(64)}`,
    });
    expect(() =>
      createAgentRun({
        ...baseInput,
        operation: 'CONTROLLED_ARTIFACT_EDIT',
        accessMode: 'WORKSPACE_WRITE',
      }),
    ).toThrowError('AGENT_RUN_SCOPE_REQUIRED');
    expect(() =>
      createAgentRun({
        ...baseInput,
        operation: 'CONTROLLED_ARTIFACT_EDIT',
        accessMode: 'WORKSPACE_WRITE',
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        runScope: { ...writeScope, networkAccess: true as never },
        runScopeHash: `sha256:${'a'.repeat(64)}`,
      }),
    ).toThrowError('AGENT_RUN_NETWORK_ACCESS_FORBIDDEN');

    const queued = transitionAgentRun(run, 'QUEUED', {
      occurredAt: '2026-09-06T02:01:00.000Z',
    });
    expect(queued.status).toBe('QUEUED');
  });

  it.each([
    ['baselineId', ''],
    ['workspaceId', '../outside'],
    ['gitBaseline', 'moving-main'],
    ['skillReleaseId', ''],
  ] as const)('rejects an incomplete or unsafe %s', (field, value) => {
    expect(() => createAgentRun({ ...baseInput, [field]: value })).toThrow();
  });

  it('allows the read-only happy path without mutating prior values', () => {
    const queued = createAgentRun(baseInput);
    const starting = transitionAgentRun(queued, 'STARTING', {
      occurredAt: '2026-09-06T02:01:00.000Z',
    });
    const running = transitionAgentRun(starting, 'RUNNING', {
      occurredAt: '2026-09-06T02:02:00.000Z',
      externalIds: { threadId: 'thread-1', turnId: 'turn-1' },
    });
    const succeeded = transitionAgentRun(running, 'SUCCEEDED', {
      occurredAt: '2026-09-06T02:03:00.000Z',
      resultSummary: 'Read-only artifact check completed.',
      resultOutcome: 'PASS',
    });

    expect(succeeded.status).toBe('SUCCEEDED');
    expect(succeeded.rowVersion).toBe(3);
    expect(succeeded.externalIds).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    expect(succeeded.resultOutcome).toBe('PASS');
    expect(queued.status).toBe('QUEUED');
  });

  it('requires UNKNOWN verification and never rewrites a terminal run', () => {
    const queued = createAgentRun(baseInput);
    const starting = transitionAgentRun(queued, 'STARTING', {
      occurredAt: '2026-09-06T02:01:00.000Z',
    });
    const unknown = transitionAgentRun(starting, 'UNKNOWN', {
      occurredAt: '2026-09-06T02:02:00.000Z',
      failureReason: 'Bridge disconnected after side-effect boundary.',
    });

    expect(unknown.resultOutcome).toBe('UNKNOWN');

    expect(() =>
      transitionAgentRun(unknown, 'SUCCEEDED', {
        occurredAt: '2026-09-06T02:03:00.000Z',
      }),
    ).toThrowError('INVALID_AGENT_RUN_TRANSITION');

    const verifying = transitionAgentRun(unknown, 'VERIFYING', {
      occurredAt: '2026-09-06T02:04:00.000Z',
    });
    const failed = transitionAgentRun(verifying, 'FAILED', {
      occurredAt: '2026-09-06T02:05:00.000Z',
      failureReason: 'No verifiable result was found.',
    });
    expect(() =>
      transitionAgentRun(failed, 'RUNNING', {
        occurredAt: '2026-09-06T02:06:00.000Z',
      }),
    ).toThrowError('AGENT_RUN_TERMINAL');
  });
});
