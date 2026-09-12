import { describe, expect, it } from 'vitest';

import type {
  ActorContext,
  AgentRunDto,
  AuthorizationPort,
  MutationEvidence,
} from '@pfc/contracts';

import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import {
  AgentRunApplicationService,
  type AgentRunRepositoryPort,
} from '../../apps/server/src/agent-runs/index.ts';

const actor: ActorContext = {
  actorId: 'CODEx_TEST_M2_ACTOR_001',
  roles: ['PRODUCT_OWNER'],
  teamIds: ['CODEx_TEST_M2_TEAM_001'],
  authenticationStatus: 'AUTHENTICATED',
};

const authorizationPort: AuthorizationPort = {
  async lookupRequirementAuthorization(request) {
    return {
      status: 'AVAILABLE',
      source: 'POSTGRESQL',
      capabilityVersion: 'test/v1',
      checkedAt: '2026-09-06T04:00:00.000Z',
      data: {
        actorId: request.actor.actorId,
        requirementId: request.requirementId,
        membership: { team: 'YES', requirement: 'YES', restricted: 'YES' },
        allowedActions: ['RUN_AGENT', 'RUN_AGENT_WRITE', 'VIEW_AGENT_RUN'],
        approvedTransmissionTargets: [],
        actionAuthorizations: [],
      },
    };
  },
};

function repository(overrides: Partial<AgentRunRepositoryPort> = {}) {
  let current: AgentRunDto | null = null;
  const base: AgentRunRepositoryPort = {
    async resolveCreationContext() {
      return {
        requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
        currentBaselineId: 'CODEx_TEST_M2_BASELINE_001',
        sensitivity: 'INTERNAL',
        workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
        workspaceVerificationStatus: 'VERIFIED',
        workspaceAccessLevel: 'READ',
        skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
        skillContentHash: `sha256:${'a'.repeat(64)}`,
        skillEvaluationStatus: 'PASSED',
        skillEnabled: true,
        currentGitBaseline: '0123456789abcdef0123456789abcdef01234567',
        artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
        artifactSourceRef: 'docs/requirements/requirement.md',
        artifactContentHash: `sha256:${'b'.repeat(64)}`,
      };
    },
    async resolveLaunchOptions() {
      return null;
    },
    async createRun(input) {
      current = input.run;
      return { status: 'CREATED', run: input.run };
    },
    async findRun() {
      return current;
    },
    async findRunSensitivity() {
      return current ? 'INTERNAL' : null;
    },
    async listRunsForActor() {
      return current ? [current] : [];
    },
    async listEvents() {
      return [];
    },
  };
  return Object.assign(base, overrides);
}

const request = {
  baselineId: 'CODEx_TEST_M2_BASELINE_001',
  workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
  skillKey: 'pfc-readonly-artifact-check',
  skillVersion: '2026.09.06-r1',
  operation: 'ARTIFACT_CHECK' as const,
  accessMode: 'READ_ONLY' as const,
};

describe('M2 AgentRun application service', () => {
  it('creates an auditable read-only run bound to current facts', async () => {
    const seenEvidence: MutationEvidence[] = [];
    const seenCommands: Array<Readonly<Record<string, unknown>>> = [];
    const store = repository({
      async createRun(input) {
        seenEvidence.push(input.mutation);
        if (input.command) seenCommands.push(input.command.payload);
        return { status: 'CREATED', run: input.run };
      },
    });
    let sequence = 0;
    const service = new AgentRunApplicationService({
      repository: store,
      authorization: new RequirementAuthorizationService(authorizationPort),
      now: () => '2026-09-06T04:00:00.000Z',
      idFactory: (prefix) => `CODEx_TEST_M2_${prefix}_${++sequence}`,
    });

    const result = await service.create({
      actor,
      requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
      request,
      idempotencyKey: 'CODEx_TEST_M2_IDEMPOTENCY_001',
      requestId: 'CODEx_TEST_M2_REQUEST_001',
    });

    expect(result).toMatchObject({
      replayed: false,
      run: {
        status: 'QUEUED',
        baselineId: request.baselineId,
        workspaceId: request.workspaceId,
        skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
      },
    });
    expect(seenEvidence[0]).toMatchObject({
      eventType: 'agent-run.created',
      requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
      idempotencyKey: 'CODEx_TEST_M2_IDEMPOTENCY_001',
    });
    expect(seenCommands[0]).toMatchObject({
      requirementId: request.baselineId.replace('BASELINE', 'REQUIREMENT'),
      baselineId: request.baselineId,
      workspaceId: request.workspaceId,
      gitBaseline: '0123456789abcdef0123456789abcdef01234567',
      skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
      skillContentHash: `sha256:${'a'.repeat(64)}`,
      artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
      artifactSourceRef: 'docs/requirements/requirement.md',
      artifactContentHash: `sha256:${'b'.repeat(64)}`,
      objectiveKey: 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK',
      accessMode: 'READ_ONLY',
    });
  });

  it('fails closed for stale baselines, unverified workspaces, and disabled skills', async () => {
    const cases = [
      { currentBaselineId: 'CODEx_TEST_M2_OTHER_BASELINE' },
      { workspaceVerificationStatus: 'UNVERIFIED' as const },
      { skillEnabled: false },
    ];
    for (const override of cases) {
      const store = repository({
        async resolveCreationContext() {
          return {
            requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
            currentBaselineId: 'CODEx_TEST_M2_BASELINE_001',
            sensitivity: 'INTERNAL',
            workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
            workspaceVerificationStatus: 'VERIFIED',
            workspaceAccessLevel: 'READ',
            skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
            skillContentHash: `sha256:${'a'.repeat(64)}`,
            skillEvaluationStatus: 'PASSED',
            skillEnabled: true,
            currentGitBaseline: '0123456789abcdef0123456789abcdef01234567',
            artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
            artifactSourceRef: 'docs/requirements/requirement.md',
            artifactContentHash: `sha256:${'b'.repeat(64)}`,
            ...override,
          };
        },
      });
      const service = new AgentRunApplicationService({
        repository: store,
        authorization: new RequirementAuthorizationService(authorizationPort),
      });
      await expect(
        service.create({
          actor,
          requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
          request,
          idempotencyKey: 'CODEx_TEST_M2_IDEMPOTENCY_002',
          requestId: 'CODEx_TEST_M2_REQUEST_002',
        }),
      ).rejects.toThrow();
    }
  });

  it('creates a bounded workspace-write approval without a start command', async () => {
    let observedInput:
      Parameters<AgentRunRepositoryPort['createRun']>[0] | null = null;
    const service = new AgentRunApplicationService({
      repository: repository({
        async resolveCreationContext(input) {
          expect(input.operation).toBe('CONTROLLED_ARTIFACT_EDIT');
          return {
            requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
            currentBaselineId: 'CODEx_TEST_M2_BASELINE_001',
            sensitivity: 'INTERNAL',
            workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
            workspaceVerificationStatus: 'VERIFIED',
            workspaceAccessLevel: 'WRITE',
            skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_WRITE_001',
            skillContentHash: `sha256:${'c'.repeat(64)}`,
            skillEvaluationStatus: 'PASSED',
            skillEnabled: true,
            currentGitBaseline: '0123456789abcdef0123456789abcdef01234567',
            artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
            artifactSourceRef: 'docs/requirements/requirement.md',
            artifactContentHash: `sha256:${'b'.repeat(64)}`,
          };
        },
        async createRun(input) {
          observedInput = input;
          return { status: 'CREATED', run: input.run };
        },
      }),
      authorization: new RequirementAuthorizationService(authorizationPort),
      now: () => '2026-09-06T04:00:00.000Z',
      idFactory: (prefix) => `CODEx_TEST_M2_WRITE_${prefix}`,
    });
    const result = await service.create({
      actor,
      requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
      request: {
        ...request,
        skillKey: 'pfc-controlled-artifact-edit',
        skillVersion: '2026.09.06-r2',
        operation: 'CONTROLLED_ARTIFACT_EDIT',
        accessMode: 'WORKSPACE_WRITE',
        writeScope: {
          allowedRelativePaths: ['docs/requirements/requirement.md'],
          allowedActions: ['EDIT_FILES'],
          maxChangedFiles: 1,
          maxChangedBytes: 20_000,
        },
      },
      idempotencyKey: 'CODEx_TEST_M2_IDEMPOTENCY_003',
      requestId: 'CODEx_TEST_M2_REQUEST_003',
    });

    expect(result.run).toMatchObject({
      operation: 'CONTROLLED_ARTIFACT_EDIT',
      accessMode: 'WORKSPACE_WRITE',
      status: 'WAITING_APPROVAL',
      executionInstanceId: 'CODEx_TEST_M2_WRITE_agent-execution',
      runScope: expect.objectContaining({ networkAccess: false }),
      runScopeHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(observedInput).toMatchObject({
      command: null,
      startApproval: {
        kind: 'RUN_START',
        executionInstanceId: 'CODEx_TEST_M2_WRITE_agent-execution',
        scopeHash: result.run.runScopeHash,
        appServerRequestId: null,
      },
    });
  });

  it('rejects mismatched operation and access-mode pairs after authorization context resolution', async () => {
    let contextResolved = false;
    const baseRepository = repository();
    const service = new AgentRunApplicationService({
      repository: repository({
        async resolveCreationContext(input) {
          contextResolved = true;
          return baseRepository.resolveCreationContext(input);
        },
      }),
      authorization: new RequirementAuthorizationService(authorizationPort),
    });

    await expect(
      service.create({
        actor,
        requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
        request: {
          ...request,
          operation: 'CONTROLLED_ARTIFACT_EDIT',
        },
        idempotencyKey: 'CODEx_TEST_M2_IDEMPOTENCY_MISMATCH',
        requestId: 'CODEx_TEST_M2_REQUEST_MISMATCH',
      }),
    ).rejects.toThrowError('AgentRun operation does not match access mode.');
    expect(contextResolved).toBe(true);
  });

  it('authorizes creation with the current baseline sensitivity', async () => {
    const restrictedDeniedPort: AuthorizationPort = {
      async lookupRequirementAuthorization(input) {
        return {
          status: 'AVAILABLE',
          source: 'POSTGRESQL',
          capabilityVersion: 'test/v1',
          checkedAt: '2026-09-06T04:00:00.000Z',
          data: {
            actorId: input.actor.actorId,
            requirementId: input.requirementId,
            membership: {
              team: 'YES',
              requirement: 'YES',
              restricted: 'NO',
            },
            allowedActions: ['RUN_AGENT'],
            approvedTransmissionTargets: [],
            actionAuthorizations: [],
          },
        };
      },
    };
    const service = new AgentRunApplicationService({
      repository: repository({
        async resolveCreationContext() {
          return {
            requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
            currentBaselineId: 'CODEx_TEST_M2_BASELINE_001',
            sensitivity: 'RESTRICTED',
            workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
            workspaceVerificationStatus: 'VERIFIED',
            workspaceAccessLevel: 'READ',
            skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
            skillContentHash: `sha256:${'a'.repeat(64)}`,
            skillEvaluationStatus: 'PASSED',
            skillEnabled: true,
            currentGitBaseline: '0123456789abcdef0123456789abcdef01234567',
            artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
            artifactSourceRef: 'docs/requirements/requirement.md',
            artifactContentHash: `sha256:${'b'.repeat(64)}`,
          };
        },
      }),
      authorization: new RequirementAuthorizationService(restrictedDeniedPort),
    });

    await expect(
      service.create({
        actor,
        requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
        request,
        idempotencyKey: 'CODEx_TEST_M2_IDEMPOTENCY_RESTRICTED',
        requestId: 'CODEx_TEST_M2_REQUEST_RESTRICTED',
      }),
    ).rejects.toThrowError('AgentRun access denied.');
  });

  it('lists only runs scoped by the authenticated actor repository query', async () => {
    const listRunsForActor = async (actorId: string) => {
      expect(actorId).toBe(actor.actorId);
      return [];
    };
    const service = new AgentRunApplicationService({
      repository: repository({ listRunsForActor }),
      authorization: new RequirementAuthorizationService(authorizationPort),
    });

    await expect(service.list(actor, 25)).resolves.toEqual({ items: [] });
  });

  it('authorizes run detail with the persisted baseline sensitivity', async () => {
    const current = {
      id: 'CODEx_TEST_M2_RESTRICTED_RUN',
      requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
      baselineId: 'CODEx_TEST_M2_BASELINE_001',
      workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
      gitBaseline: '0123456789abcdef0123456789abcdef01234567',
      skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
      operation: 'ARTIFACT_CHECK',
      accessMode: 'READ_ONLY',
      status: 'SUCCEEDED',
      parentRunId: null,
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      executionInstanceId: null,
      externalIds: { threadId: null, turnId: null },
      resultOutcome: 'PASS',
      runScope: null,
      runScopeHash: null,
      executionStartedAt: '2026-09-06T04:00:10.000Z',
      cancelRequestedAt: null,
      terminalAt: '2026-09-06T04:01:00.000Z',
      resultSummary: 'sanitized',
      failureReason: null,
      rowVersion: 1,
      createdBy: actor.actorId,
      createdAt: '2026-09-06T04:00:00.000Z',
      updatedAt: '2026-09-06T04:01:00.000Z',
    } satisfies AgentRunDto;
    const restrictedDeniedPort: AuthorizationPort = {
      async lookupRequirementAuthorization(input) {
        return {
          status: 'AVAILABLE',
          source: 'POSTGRESQL',
          capabilityVersion: 'test/v1',
          checkedAt: '2026-09-06T04:00:00.000Z',
          data: {
            actorId: input.actor.actorId,
            requirementId: input.requirementId,
            membership: {
              team: 'YES',
              requirement: 'YES',
              restricted: 'NO',
            },
            allowedActions: ['VIEW_AGENT_RUN'],
            approvedTransmissionTargets: [],
            actionAuthorizations: [],
          },
        };
      },
    };
    const service = new AgentRunApplicationService({
      repository: repository({
        async findRun() {
          return current;
        },
        async findRunSensitivity() {
          return 'RESTRICTED';
        },
      }),
      authorization: new RequirementAuthorizationService(restrictedDeniedPort),
    });

    await expect(service.get(actor, current.id)).rejects.toThrowError(
      'AgentRun access denied.',
    );
  });
});
