import { describe, expect, it, vi } from 'vitest';

import { BridgeWorker } from '../../apps/bridge/src/worker.ts';
import {
  BridgeSessionPool,
  type BridgeManagedSession,
} from '../../apps/bridge/src/session-pool.ts';

const gitBaseline = '0123456789abcdef0123456789abcdef01234567';
const skillContentHash =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const artifactContentHash =
  'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

function command(overrides: Record<string, unknown> = {}) {
  return {
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
      gitBaseline,
      skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
      skillContentHash,
      artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
      artifactSourceRef: 'standards/requirement.md',
      artifactContentHash,
      objectiveKey: 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK',
      accessMode: 'READ_ONLY',
    },
    ...overrides,
  };
}

function dependencies(
  input: {
    currentGitBaseline?: string;
    currentArtifactContentHash?: string;
    artifactInspectionStatus?: 'VERIFIED' | 'OUTSIDE_SCOPE' | 'UNREADABLE';
  } = {},
) {
  const submissions: Array<{ expectedSequence: number; eventType: string }> =
    [];
  const acknowledgements: Array<{ status: string; reasonCode?: string }> = [];
  const gateway = {
    claimNext: vi.fn(async (): Promise<unknown> => command()),
    submitEvent: vi.fn(
      async (
        event,
      ): Promise<{
        status: 'APPENDED' | 'DUPLICATE' | 'SEQUENCE_GAP';
      }> => {
        submissions.push({
          expectedSequence: event.expectedSequence,
          eventType: event.event.eventType,
        });
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { status: 'APPENDED' };
      },
    ),
    acknowledge: vi.fn(async (acknowledgement) => {
      acknowledgements.push(acknowledgement);
    }),
    reportCapabilities: vi.fn(async () => undefined),
    submitApproval: vi.fn(async () => ({ afterSequence: 4 })),
    reportCapsule: vi.fn(async () => undefined),
  };
  const runner = {
    runReadonly: vi.fn(async (_input, onEvent) => {
      await onEvent({
        eventType: 'TURN_STARTED',
        summary: { turnId: 'turn-1' },
      });
      await onEvent({
        eventType: 'RESULT_RECORDED',
        summary: { status: 'completed' },
      });
      return {
        threadId: 'thread-1',
        turnId: 'turn-1',
        status: 'SUCCEEDED' as const,
      };
    }),
  };
  return {
    gateway,
    runner,
    submissions,
    acknowledgements,
    registry: {
      resolveWorkspace: vi.fn(async () => ({
        path: 'C:\\CODEx_TEST_M2\\repo',
        verified: true,
        allowedRelativePath: 'standards',
      })),
      resolveSkill: vi.fn(async () => ({
        name: 'pfc-readonly-artifact-check',
        path: 'C:\\CODEx_TEST_M2\\skill\\SKILL.md',
        contentHash: skillContentHash,
        enabled: true,
      })),
    },
    workspaceInspector: {
      currentGitBaseline: vi.fn(
        async () => input.currentGitBaseline ?? gitBaseline,
      ),
    },
    artifactInspector: {
      inspectWithinScope: vi.fn(async () => {
        const status = input.artifactInspectionStatus ?? 'VERIFIED';
        return status === 'VERIFIED'
          ? {
              status,
              contentHash:
                input.currentArtifactContentHash ?? artifactContentHash,
            }
          : { status };
      }),
    },
  };
}

describe('M2 Bridge worker', () => {
  it('runs an allowed command and submits events serially from the stored cursor', async () => {
    const deps = dependencies();
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      now: () => '2026-09-06T06:00:00.000Z',
      idFactory: (prefix) => `${prefix}-fixed`,
    });

    await worker.runOnce();

    expect(deps.runner.runReadonly).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: 'C:\\CODEx_TEST_M2\\repo\\standards',
        objective: expect.stringMatching(
          /CODEx_TEST_M2_REQUIREMENT_001[\s\S]*CODEx_TEST_M2_BASELINE_001[\s\S]*CODEx_TEST_M2_ARTIFACT_VERSION_001[\s\S]*requirement\.md[\s\S]*abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789[\s\S]*standards[\s\S]*0123456789abcdef0123456789abcdef01234567/,
        ),
      }),
      expect.any(Function),
    );
    expect(deps.runner.runReadonly.mock.calls[0]?.[0].objective).not.toContain(
      'C:\\CODEx_TEST_M2',
    );
    expect(deps.runner.runReadonly.mock.calls[0]?.[0].objective).toContain(
      'Do not traverse to parent directories or use absolute paths.',
    );
    expect(deps.submissions).toEqual([
      { expectedSequence: 3, eventType: 'TURN_STARTED' },
      { expectedSequence: 4, eventType: 'RESULT_RECORDED' },
    ]);
    expect(deps.acknowledgements).toEqual([
      expect.objectContaining({ status: 'SUCCEEDED' }),
    ]);
  });

  it('rejects a drifted Git baseline without starting Codex', async () => {
    const deps = dependencies({
      currentGitBaseline: 'abcdef0123456789abcdef0123456789abcdef01',
    });
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      now: () => '2026-09-06T06:00:00.000Z',
    });

    await worker.runOnce();

    expect(deps.runner.runReadonly).not.toHaveBeenCalled();
    expect(deps.acknowledgements).toEqual([
      expect.objectContaining({
        status: 'REJECTED',
        reasonCode: 'WORKSPACE_BASELINE_DRIFT',
      }),
    ]);
  });

  it('rejects an expired lease before resolving local paths', async () => {
    const deps = dependencies();
    deps.gateway.claimNext.mockResolvedValue(
      command({ leaseUntil: '2026-09-06T05:59:59.000Z' }),
    );
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      now: () => '2026-09-06T06:00:00.000Z',
    });

    await worker.runOnce();

    expect(deps.registry.resolveWorkspace).not.toHaveBeenCalled();
    expect(deps.acknowledgements).toEqual([
      expect.objectContaining({
        status: 'REJECTED',
        reasonCode: 'COMMAND_LEASE_EXPIRED',
      }),
    ]);
  });

  it('marks execution unknown when the server reports an event sequence gap', async () => {
    const deps = dependencies();
    deps.gateway.submitEvent.mockResolvedValue({ status: 'SEQUENCE_GAP' });
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      now: () => '2026-09-06T06:00:00.000Z',
    });

    await worker.runOnce();

    expect(deps.acknowledgements).toEqual([
      expect.objectContaining({
        status: 'UNKNOWN',
        reasonCode: 'BRIDGE_EVENT_SEQUENCE_GAP',
      }),
    ]);
  });

  it('reports a bounded adapter failure code and retains observed execution ids', async () => {
    const deps = dependencies();
    deps.runner.runReadonly.mockImplementation(async (_input, onEvent) => {
      await onEvent({
        eventType: 'TURN_STARTED',
        summary: { threadId: 'thread-observed', turnId: 'turn-observed' },
      });
      throw new Error('APP_SERVER_EVENT_BACKPRESSURE');
    });
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      now: () => '2026-09-06T06:00:00.000Z',
    });

    await worker.runOnce();

    expect(deps.acknowledgements).toEqual([
      expect.objectContaining({
        status: 'UNKNOWN',
        reasonCode: 'APP_SERVER_EVENT_BACKPRESSURE',
        threadId: 'thread-observed',
        turnId: 'turn-observed',
      }),
    ]);
  });

  it.each([
    ['BRIDGE_GATEWAY_HTTP_403', 'BRIDGE_GATEWAY_HTTP_403'],
    ['APP_SERVER_REQUEST_FAILED', 'APP_SERVER_REQUEST_FAILED'],
    ['APP_SERVER_EVENT_DELIVERY_FAILED', 'APP_SERVER_EVENT_DELIVERY_FAILED'],
    ['BRIDGE_EVENT_SEQUENCE_GAP', 'BRIDGE_EVENT_SEQUENCE_GAP'],
  ])(
    'persists the bounded failure category for %s',
    async (message, reasonCode) => {
      const deps = dependencies();
      deps.runner.runReadonly.mockRejectedValue(new Error(message));
      const worker = new BridgeWorker({
        bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
        gateway: deps.gateway,
        registry: deps.registry,
        workspaceInspector: deps.workspaceInspector,
        artifactInspector: deps.artifactInspector,
        runnerFactory: () => deps.runner,
        now: () => '2026-09-06T06:00:00.000Z',
      });

      await worker.runOnce();

      expect(deps.acknowledgements).toEqual([
        expect.objectContaining({ status: 'UNKNOWN', reasonCode }),
      ]);
    },
  );

  it('rejects an artifact outside the authorized workspace scope', async () => {
    const deps = dependencies();
    deps.gateway.claimNext.mockResolvedValue(
      command({
        payload: {
          ...command().payload,
          artifactSourceRef: 'other/secret.md',
        },
      }),
    );
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      now: () => '2026-09-06T06:00:00.000Z',
    });

    await worker.runOnce();

    expect(deps.runner.runReadonly).not.toHaveBeenCalled();
    expect(deps.acknowledgements).toEqual([
      expect.objectContaining({
        status: 'REJECTED',
        reasonCode: 'ARTIFACT_PATH_OUTSIDE_SCOPE',
      }),
    ]);
  });

  it('rejects artifact content drift before starting Codex', async () => {
    const deps = dependencies({
      currentArtifactContentHash: `sha256:${'f'.repeat(64)}`,
    });
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      now: () => '2026-09-06T06:00:00.000Z',
    });

    await worker.runOnce();

    expect(deps.runner.runReadonly).not.toHaveBeenCalled();
    expect(deps.acknowledgements).toEqual([
      expect.objectContaining({
        status: 'REJECTED',
        reasonCode: 'ARTIFACT_CONTENT_DRIFT',
      }),
    ]);
  });

  it.each([
    ['OUTSIDE_SCOPE', 'ARTIFACT_PATH_OUTSIDE_SCOPE'],
    ['UNREADABLE', 'ARTIFACT_NOT_READABLE'],
  ] as const)(
    'rejects a canonical artifact inspection result of %s',
    async (artifactInspectionStatus, reasonCode) => {
      const deps = dependencies({ artifactInspectionStatus });
      const worker = new BridgeWorker({
        bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
        gateway: deps.gateway,
        registry: deps.registry,
        workspaceInspector: deps.workspaceInspector,
        artifactInspector: deps.artifactInspector,
        runnerFactory: () => deps.runner,
        now: () => '2026-09-06T06:00:00.000Z',
      });

      await worker.runOnce();

      expect(deps.runner.runReadonly).not.toHaveBeenCalled();
      expect(deps.acknowledgements).toEqual([
        expect.objectContaining({ status: 'REJECTED', reasonCode }),
      ]);
    },
  );
});

describe('M2 controlled-write Bridge worker', () => {
  it('keeps verification UNKNOWN when the restarted Bridge no longer owns the session', async () => {
    const deps = dependencies();
    deps.gateway.claimNext.mockResolvedValue({
      commandId: 'CODEx_TEST_M2_VERIFY_COMMAND_001',
      runId: 'CODEx_TEST_M2_VERIFY_RUN_001',
      commandType: 'VERIFY_RUN_STATE',
      leaseUntil: '2026-09-06T06:05:00.000Z',
      attempt: 1,
      afterSequence: 5,
      payload: {
        executionInstanceId: 'CODEx_TEST_M2_VERIFY_EXECUTION_001',
      },
    });
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      sessionPool: new BridgeSessionPool(),
      now: () => '2026-09-06T06:00:00.000Z',
    });

    await expect(worker.runOnce()).resolves.toBe('HANDLED');
    expect(deps.gateway.acknowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'UNKNOWN',
        reasonCode: 'RUN_STATE_UNAVAILABLE',
      }),
    );
  });

  it('runs Codex only in a materialized capsule and verifies the diff before success', async () => {
    const deps = dependencies();
    const runScope = {
      allowedRelativePaths: ['standards/requirement.md'],
      allowedActions: ['EDIT_FILES'] as const,
      networkAccess: false as const,
      maxChangedFiles: 1,
      maxChangedBytes: 20_000,
      expiresAt: '2026-09-06T06:10:00.000Z',
    };
    deps.gateway.claimNext.mockResolvedValue({
      commandId: 'CODEx_TEST_M2_WRITE_COMMAND_001',
      runId: 'CODEx_TEST_M2_RUN_WRITE_001',
      commandType: 'START_WORKSPACE_WRITE_RUN',
      leaseUntil: '2026-09-06T06:05:00.000Z',
      attempt: 1,
      afterSequence: 2,
      payload: {
        ...command().payload,
        executionInstanceId: 'CODEx_TEST_M2_EXECUTION_WRITE_001',
        runScope,
        runScopeHash: `sha256:${'c'.repeat(64)}`,
        objectiveKey: 'CONTROLLED_ARTIFACT_EDIT',
        accessMode: 'WORKSPACE_WRITE',
      },
    });
    const capsule = {
      id: 'CODEx_TEST_M2_CAPSULE_001',
      runId: 'CODEx_TEST_M2_RUN_WRITE_001',
      executionInstanceId: 'CODEx_TEST_M2_EXECUTION_WRITE_001',
      path: 'C:\\CODEx_TEST_M2\\capsules\\run-1',
      sourceGitBaseline: gitBaseline,
      scope: runScope,
      scopeHash: `sha256:${'c'.repeat(64)}`,
      allowedEntries: [
        { path: 'standards/requirement.md', kind: 'FILE' as const },
      ],
      beforeManifest: [],
      beforeManifestHash: `sha256:${'d'.repeat(64)}`,
    };
    const capsuleManager = {
      materialize: vi.fn(async () => capsule),
      verify: vi.fn(async () => ({
        status: 'VERIFIED' as const,
        changedFiles: 1,
        changedBytes: 120,
        changedPaths: ['standards/requirement.md'],
        beforeManifestHash: capsule.beforeManifestHash,
        afterManifestHash: `sha256:${'e'.repeat(64)}`,
      })),
      cleanup: vi.fn(async () => undefined),
    };
    const sessionPool = new BridgeSessionPool();
    const closeWriteSession = vi.fn(async () => undefined);
    const writeSessionFactory = vi.fn(async (_input, onEvent, onApproval) => {
      await onEvent({
        eventType: 'TURN_STARTED',
        summary: { threadId: 'thread-write', turnId: 'turn-write' },
      });
      await onApproval({
        appServerRequestId: 'number:42',
        threadId: 'thread-write',
        turnId: 'turn-write',
        itemId: 'item-write',
        callbackId: null,
        kind: 'FILE_CHANGE',
        requestedScope: {
          allowedRelativePaths: ['standards/requirement.md'],
          allowedActions: ['EDIT_FILES'],
          networkAccess: false,
          maxChangedFiles: 1,
          maxChangedBytes: 20_000,
        },
        outsideCapsule: false,
      });
      return Object.assign(
        Object.create({
          advanceEventCursor: vi.fn(),
          resolveApproval: vi.fn(async () => undefined),
          interrupt: vi.fn(async () => undefined),
          verify: vi.fn(async () => ({ status: 'RUNNING' as const })),
          close: closeWriteSession,
        }) as object,
        {
          completion: Promise.resolve({
            threadId: 'thread-write',
            turnId: 'turn-write',
            status: 'SUCCEEDED' as const,
          }),
        },
      ) as BridgeManagedSession;
    });
    const worker = new BridgeWorker({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      gateway: deps.gateway,
      registry: deps.registry,
      workspaceInspector: deps.workspaceInspector,
      artifactInspector: deps.artifactInspector,
      runnerFactory: () => deps.runner,
      capsuleManager,
      sessionPool,
      workspaceWriteSessionFactory: writeSessionFactory,
      now: () => '2026-09-06T06:00:00.000Z',
    });

    await expect(worker.runOnce()).resolves.toBe('HANDLED');
    await worker.drain();

    expect(capsuleManager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWorkspacePath: 'C:\\CODEx_TEST_M2\\repo',
        scope: runScope,
      }),
    );
    expect(writeSessionFactory).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: capsule.path, runScope }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(deps.gateway.submitApproval).toHaveBeenCalledOnce();
    expect(deps.gateway.reportCapsule).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lifecycle: 'VERIFIED',
        afterManifestHash: `sha256:${'e'.repeat(64)}`,
      }),
    );
    expect(deps.gateway.acknowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'SUCCEEDED' }),
    );
    expect(closeWriteSession).toHaveBeenCalledOnce();
  });
});
