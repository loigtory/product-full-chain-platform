import { describe, expect, it } from 'vitest';

import { createM2LocalAcceptanceData } from '../../packages/test-data/src/index.ts';

describe('M2 local acceptance data', () => {
  it('builds identifiable standard-data records for a real read-only run', () => {
    const data = createM2LocalAcceptanceData({
      runId: 'R1_REAL_20260906',
      now: '2026-09-06T09:00:00.000Z',
      repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
      artifactContentHash: `sha256:${'c'.repeat(64)}`,
    });

    expect(data.account.loginName).toBe('codex.m2.r1-real-20260906');
    expect(
      [
        data.account.id,
        data.team.id,
        data.requirement.id,
        data.baseline.id,
        data.workspace.id,
        data.artifact.id,
        data.artifactVersion.id,
      ].every((id) => id.startsWith('CODEx_TEST_M2_R1_REAL_20260906_')),
    ).toBe(true);
    expect(data.workspace.verificationStatus).toBe('UNVERIFIED');
    expect(data.requirementWorkspace).toMatchObject({
      allowedRelativePath:
        'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01',
      accessLevel: 'READ',
    });
    expect(data.artifactVersion).toMatchObject({
      sourceRef:
        'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01/evaluation.md',
      contentHash: `sha256:${'c'.repeat(64)}`,
    });
    expect(data.requirement.currentStage).toBe('G8');
    expect(data.artifact).toMatchObject({
      stage: 'G8',
      artifactType: 'EVALUATION_REPORT',
      title: 'RDC 正式准入接入前向评估结论',
    });
  });

  it('rejects an invalid run id or unhashed source evidence', () => {
    expect(() =>
      createM2LocalAcceptanceData({
        runId: '../escape',
        now: '2026-09-06T09:00:00.000Z',
        repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
        artifactContentHash: `sha256:${'c'.repeat(64)}`,
      }),
    ).toThrow('M2_ACCEPTANCE_RUN_ID_INVALID');
    expect(() =>
      createM2LocalAcceptanceData({
        runId: 'R1_REAL_20260906',
        now: '2026-09-06T09:00:00.000Z',
        repositoryFingerprint: 'plain',
        artifactContentHash: `sha256:${'c'.repeat(64)}`,
      }),
    ).toThrow('M2_ACCEPTANCE_HASH_INVALID');
  });
});
