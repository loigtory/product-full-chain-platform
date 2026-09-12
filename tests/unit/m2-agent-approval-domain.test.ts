import { describe, expect, it } from 'vitest';

import {
  createAgentApproval,
  decideAgentApproval,
  expireAgentApproval,
} from '../../packages/domain/src/index.ts';

const requestedScope = {
  allowedRelativePaths: ['standards/requirement.md', 'standards/acceptance.md'],
  allowedActions: ['EDIT_FILES', 'FORMAT'] as const,
  networkAccess: false,
  maxChangedFiles: 2,
  maxChangedBytes: 20_000,
};

function pendingApproval(outsideCapsule = false) {
  return createAgentApproval({
    id: 'CODEx_TEST_M2_APPROVAL_001',
    runId: 'CODEx_TEST_M2_RUN_001',
    executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
    appServerRequestId: '42',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    callbackId: null,
    kind: 'PERMISSIONS',
    requestedScope,
    scopeHash: `sha256:${'a'.repeat(64)}`,
    outsideCapsule,
    requestedBy: 'CODEx_TEST_M2_REQUESTER_001',
    requestedAt: '2026-09-06T02:00:00.000Z',
    expiresAt: '2026-09-06T02:10:00.000Z',
  });
}

describe('M2 Agent approval domain', () => {
  it('creates a platform run-start approval without App Server identities', () => {
    expect(
      createAgentApproval({
        id: 'CODEx_TEST_M2_RUN_START_APPROVAL',
        runId: 'CODEx_TEST_M2_RUN_001',
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        appServerRequestId: null,
        threadId: null,
        turnId: null,
        itemId: null,
        callbackId: null,
        kind: 'RUN_START',
        requestedScope,
        scopeHash: `sha256:${'b'.repeat(64)}`,
        requestedBy: 'CODEx_TEST_M2_REQUESTER_001',
        requestedAt: '2026-09-06T02:00:00.000Z',
        expiresAt: '2026-09-06T02:10:00.000Z',
      }),
    ).toMatchObject({
      kind: 'RUN_START',
      decision: 'PENDING',
      appServerRequestId: null,
      threadId: null,
      turnId: null,
      itemId: null,
    });

    expect(() =>
      createAgentApproval({
        id: 'CODEx_TEST_M2_RUN_START_CALLBACK',
        runId: 'CODEx_TEST_M2_RUN_001',
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
        appServerRequestId: null,
        threadId: null,
        turnId: null,
        itemId: null,
        callbackId: 'callback-1',
        kind: 'RUN_START',
        requestedScope,
        scopeHash: `sha256:${'c'.repeat(64)}`,
        requestedBy: 'CODEx_TEST_M2_REQUESTER_001',
        requestedAt: '2026-09-06T02:00:00.000Z',
        expiresAt: '2026-09-06T02:10:00.000Z',
      }),
    ).toThrowError('INVALID_AGENT_APPROVAL_APP_IDENTITY');
  });

  it('requires the run-start approver to accept the fixed displayed scope', () => {
    const approval = createAgentApproval({
      id: 'CODEx_TEST_M2_RUN_START_APPROVAL',
      runId: 'CODEx_TEST_M2_RUN_001',
      executionInstanceId: 'CODEx_TEST_M2_EXECUTION_001',
      appServerRequestId: null,
      threadId: null,
      turnId: null,
      itemId: null,
      callbackId: null,
      kind: 'RUN_START',
      requestedScope,
      scopeHash: `sha256:${'b'.repeat(64)}`,
      requestedBy: 'CODEx_TEST_M2_REQUESTER_001',
      requestedAt: '2026-09-06T02:00:00.000Z',
      expiresAt: '2026-09-06T02:10:00.000Z',
    });

    expect(() =>
      decideAgentApproval(approval, {
        decision: 'APPROVED',
        approvedScope: {
          ...requestedScope,
          maxChangedBytes: 10_000,
        },
        decidedBy: 'CODEx_TEST_M2_APPROVER_001',
        decidedAt: '2026-09-06T02:05:00.000Z',
        reasonCode: 'SCOPE_REVIEWED',
      }),
    ).toThrowError('AGENT_APPROVAL_RUN_START_SCOPE_MISMATCH');
  });

  it('creates a pending approval with immutable request identity', () => {
    expect(pendingApproval()).toMatchObject({
      decision: 'PENDING',
      rowVersion: 0,
      approvedScope: null,
      appServerRequestId: '42',
      scopeHash: `sha256:${'a'.repeat(64)}`,
      outsideCapsule: false,
    });
  });

  it('allows a different approver to shrink permissions but never expand them', () => {
    const approval = pendingApproval();
    const decided = decideAgentApproval(approval, {
      decision: 'APPROVED',
      approvedScope: {
        ...requestedScope,
        allowedRelativePaths: ['standards/requirement.md'],
        allowedActions: ['EDIT_FILES'],
        maxChangedFiles: 1,
        maxChangedBytes: 10_000,
      },
      decidedBy: 'CODEx_TEST_M2_APPROVER_001',
      decidedAt: '2026-09-06T02:05:00.000Z',
      reasonCode: 'SCOPE_REVIEWED',
    });

    expect(decided).toMatchObject({
      decision: 'APPROVED',
      decidedBy: 'CODEx_TEST_M2_APPROVER_001',
      rowVersion: 1,
      approvedScope: {
        allowedRelativePaths: ['standards/requirement.md'],
        maxChangedFiles: 1,
      },
    });
    expect(() =>
      decideAgentApproval(approval, {
        decision: 'APPROVED',
        approvedScope: {
          ...requestedScope,
          allowedRelativePaths: ['standards/requirement.md', '../secret.txt'],
        },
        decidedBy: 'CODEx_TEST_M2_APPROVER_001',
        decidedAt: '2026-09-06T02:05:00.000Z',
        reasonCode: 'INVALID_EXPANSION',
      }),
    ).toThrow();
  });

  it('rejects self approval, network grants, expired and repeated decisions', () => {
    const approval = pendingApproval();
    expect(() =>
      decideAgentApproval(approval, {
        decision: 'APPROVED',
        approvedScope: requestedScope,
        decidedBy: 'CODEx_TEST_M2_REQUESTER_001',
        decidedAt: '2026-09-06T02:05:00.000Z',
        reasonCode: 'SELF_APPROVAL',
      }),
    ).toThrowError('AGENT_APPROVAL_FOUR_EYES_REQUIRED');
    expect(() =>
      decideAgentApproval(approval, {
        decision: 'APPROVED',
        approvedScope: { ...requestedScope, networkAccess: true },
        decidedBy: 'CODEx_TEST_M2_APPROVER_001',
        decidedAt: '2026-09-06T02:05:00.000Z',
        reasonCode: 'NETWORK_REQUESTED',
      }),
    ).toThrowError('AGENT_APPROVAL_NETWORK_FORBIDDEN');
    expect(() =>
      decideAgentApproval(approval, {
        decision: 'REJECTED',
        decidedBy: 'CODEx_TEST_M2_APPROVER_001',
        decidedAt: '2026-09-06T02:11:00.000Z',
        reasonCode: 'TOO_LATE',
      }),
    ).toThrowError('AGENT_APPROVAL_EXPIRED');

    const expired = expireAgentApproval(approval, '2026-09-06T02:11:00.000Z');
    expect(expired.decision).toBe('EXPIRED');
    expect(() =>
      decideAgentApproval(expired, {
        decision: 'REJECTED',
        decidedBy: 'CODEx_TEST_M2_APPROVER_001',
        decidedAt: '2026-09-06T02:12:00.000Z',
        reasonCode: 'REPLAY',
      }),
    ).toThrowError('AGENT_APPROVAL_TERMINAL');
  });

  it('records but never approves a request outside the capsule', () => {
    expect(() =>
      decideAgentApproval(pendingApproval(true), {
        decision: 'APPROVED',
        approvedScope: requestedScope,
        decidedBy: 'CODEx_TEST_M2_APPROVER_001',
        decidedAt: '2026-09-06T02:05:00.000Z',
        reasonCode: 'OUTSIDE_CAPSULE',
      }),
    ).toThrowError('AGENT_APPROVAL_OUTSIDE_CAPSULE');
  });
});
