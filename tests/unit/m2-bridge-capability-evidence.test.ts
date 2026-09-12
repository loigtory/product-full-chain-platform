import { describe, expect, it } from 'vitest';

import {
  capabilityAllowsRun,
  capabilityCoversBindings,
  parseStoredBridgeCapability,
} from '../../packages/persistence/src/bridge-capability-evidence.ts';

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
};

describe('M2 stored Bridge capability evidence', () => {
  it('requires a capability snapshot to cover every registered binding', () => {
    const parsed = parseStoredBridgeCapability(snapshot);

    expect(
      capabilityCoversBindings(parsed, ['CODEx_TEST_M2_WORKSPACE_001']),
    ).toBe(true);
    expect(
      capabilityCoversBindings(parsed, [
        'CODEx_TEST_M2_WORKSPACE_001',
        'CODEx_TEST_M2_WORKSPACE_OMITTED',
      ]),
    ).toBe(false);
  });

  it('allows a run only when Codex, Git and the fixed Skill hash all match', () => {
    const parsed = parseStoredBridgeCapability(snapshot);
    const input = {
      workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
      gitBaseline: '0123456789abcdef0123456789abcdef01234567',
      skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
      skillContentHash: `sha256:${'a'.repeat(64)}`,
    };

    expect(capabilityAllowsRun(parsed, input)).toBe(true);
    expect(
      capabilityAllowsRun(parsed, {
        ...input,
        skillContentHash: `sha256:${'b'.repeat(64)}`,
      }),
    ).toBe(false);
    expect(
      capabilityAllowsRun(
        parseStoredBridgeCapability({
          ...snapshot,
          runtime: { ...snapshot.runtime, codexAppServer: 'UNVERIFIED' },
        }),
        input,
      ),
    ).toBe(false);
  });
});
