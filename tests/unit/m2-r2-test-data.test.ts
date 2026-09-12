import { describe, expect, it } from 'vitest';

import { createM2R2TestData } from '@pfc/test-data';

describe('M2 R2 deterministic test data', () => {
  it('creates two distinct actors and a bounded write scope from one runId', () => {
    const first = createM2R2TestData({ runId: 'APPROVAL_GREEN' });
    const second = createM2R2TestData({ runId: 'APPROVAL_GREEN' });

    expect(first).toEqual(second);
    expect(first.requester.id).not.toBe(first.approver.id);
    expect(first.requester.id).toMatch(/^CODEx_TEST_M2_R2_/);
    expect(first.requester.role).toBe('PRODUCT_MANAGER');
    expect(first.approver.role).toBe('TEAM_ADMIN');
    expect(first.requirement.originalIdea).toContain('四眼审批');
    expect(first.baseline).toMatchObject({
      id: first.baselineId,
      versionNumber: 1,
      sensitivity: 'INTERNAL',
    });
    expect(first.workspace).toMatchObject({
      accessLevel: 'WRITE',
      verificationStatus: 'UNVERIFIED',
    });
    expect(first.artifact).toMatchObject({
      sourceType: 'WORKSPACE_RELATIVE',
      sensitivity: 'INTERNAL',
    });
    expect(first.evidence).toEqual({
      timelineId: expect.stringMatching(/^CODEx_TEST_M2_R2_/),
      outboxId: expect.stringMatching(/^CODEx_TEST_M2_R2_/),
      auditId: expect.stringMatching(/^CODEx_TEST_M2_R2_/),
      requestId: expect.stringMatching(/^CODEx_TEST_M2_R2_/),
    });
    expect(first.runScope).toEqual({
      allowedRelativePaths: [first.artifact.sourceRef],
      allowedActions: ['EDIT_FILES'],
      networkAccess: false,
      maxChangedFiles: 1,
      maxChangedBytes: 65536,
    });
  });

  it('rejects unsafe identifiers and invalid hashes', () => {
    expect(() => createM2R2TestData({ runId: '../unsafe' })).toThrowError(
      'M2_R2_TEST_RUN_ID_INVALID',
    );
    expect(() =>
      createM2R2TestData({
        runId: 'VALID_RUN',
        artifactContentHash: 'sha256:invalid',
      }),
    ).toThrowError('M2_R2_TEST_HASH_INVALID');
  });
});
