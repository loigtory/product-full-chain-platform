import { afterAll, describe, expect, it, vi } from 'vitest';

import type { AgentRunDto, AuthorizationPort } from '@pfc/contracts';

import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { AgentAuditApplicationService } from '../../apps/server/src/agent-audit/index.ts';
import { AgentControlApplicationService } from '../../apps/server/src/agent-controls/index.ts';
import { buildServer } from '../../apps/server/src/app.ts';

const now = '2026-09-07T01:00:00.000Z';
const actor = {
  actorId: 'CODEx_TEST_M2_R2_ENGINEERING_OWNER',
  roles: ['ENGINEERING_OWNER', 'TEAM_ADMIN'] as const,
  teamIds: ['CODEx_TEST_M2_R2_TEAM'],
  authenticationStatus: 'AUTHENTICATED' as const,
};
const run: AgentRunDto = {
  id: 'CODEx_TEST_M2_R2_CONTROL_RUN',
  requirementId: 'CODEx_TEST_M2_R2_REQUIREMENT',
  baselineId: 'CODEx_TEST_M2_R2_BASELINE',
  workspaceId: 'CODEx_TEST_M2_R2_WORKSPACE',
  gitBaseline: '0123456789abcdef0123456789abcdef01234567',
  skillReleaseId: 'CODEx_TEST_M2_R2_SKILL',
  operation: 'CONTROLLED_ARTIFACT_EDIT',
  accessMode: 'WORKSPACE_WRITE',
  status: 'RUNNING',
  parentRunId: null,
  bridgeId: 'CODEx_TEST_M2_R2_BRIDGE',
  executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION',
  externalIds: { threadId: 'thread-1', turnId: 'turn-1' },
  resultOutcome: null,
  runScope: {
    allowedRelativePaths: ['docs/requirements/acceptance.md'],
    allowedActions: ['EDIT_FILES'],
    networkAccess: false,
    maxChangedFiles: 1,
    maxChangedBytes: 20_000,
    expiresAt: '2026-09-07T01:10:00.000Z',
  },
  runScopeHash: `sha256:${'a'.repeat(64)}`,
  executionStartedAt: now,
  cancelRequestedAt: null,
  terminalAt: null,
  resultSummary: null,
  failureReason: null,
  rowVersion: 2,
  createdBy: 'CODEx_TEST_M2_R2_REQUESTER',
  createdAt: now,
  updatedAt: now,
};

const authorization: AuthorizationPort = {
  async lookupRequirementAuthorization(input) {
    return {
      status: 'AVAILABLE',
      source: 'POSTGRESQL',
      capabilityVersion: 'test/v1',
      checkedAt: now,
      data: {
        actorId: input.actor.actorId,
        requirementId: input.requirementId,
        membership: { team: 'YES', requirement: 'YES', restricted: 'YES' },
        allowedActions: [
          'CANCEL_AGENT_RUN',
          'VERIFY_AGENT_RUN',
          'RUN_AGENT_WRITE',
          'VIEW_AGENT_AUDIT',
          'REVOKE_BRIDGE',
        ],
        approvedTransmissionTargets: [],
        actionAuthorizations: [],
      },
    };
  },
};

describe('M2 agent controls and audit HTTP API', () => {
  const controlRepository = {
    findRun: vi.fn(async () => run),
    findRunSensitivity: vi.fn(async () => 'INTERNAL' as const),
    controlRun: vi.fn(async () => ({
      status: 'APPLIED' as const,
      run: { ...run, status: 'CANCELLING' as const, rowVersion: 3 },
      childRun: null,
    })),
    findBridge: vi.fn(async () => ({
      id: run.bridgeId!,
      teamId: actor.teamIds[0]!,
      status: 'ONLINE' as const,
      activeRunCount: 1,
    })),
    revokeBridge: vi.fn(async () => ({
      status: 'REVOKED' as const,
      affectedRunCount: 1,
    })),
  };
  const controls = new AgentControlApplicationService({
    repository: controlRepository,
    authorization: new RequirementAuthorizationService(authorization),
    now: () => now,
    idFactory: (prefix) => `CODEx_TEST_M2_R2_${prefix}`,
  });
  const audit = new AgentAuditApplicationService({
    repository: {
      findRun: vi.fn(async () => run),
      findRunSensitivity: vi.fn(async () => 'INTERNAL' as const),
      listRunAudit: vi.fn(async () => [
        {
          id: 'CODEx_TEST_M2_R2_AUDIT',
          actorId: actor.actorId,
          action: 'agent-run.cancel-requested',
          targetType: 'agent-run',
          targetId: run.id,
          decision: 'ALLOW',
          reason: null,
          scopeSummary: { requirementId: run.requirementId },
          occurredAt: now,
        },
      ]),
    },
    authorization: new RequirementAuthorizationService(authorization),
    now: () => now,
  });
  const server = buildServer({
    agentControlService: controls,
    agentAuditService: audit,
    resolveActor: () => actor,
  });

  afterAll(async () => server.close());

  it('requests an idempotent cancel with optimistic concurrency', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/agent-runs/${run.id}/controls`,
      headers: {
        'if-match': '"2"',
        'idempotency-key': 'CODEx_TEST_M2_R2_CANCEL_KEY',
      },
      payload: { action: 'CANCEL', reasonCode: 'USER_REQUESTED' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"3"');
    expect(response.json()).toMatchObject({
      replayed: false,
      run: { id: run.id, status: 'CANCELLING' },
    });
    expect(controlRepository.controlRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CANCEL', expectedRowVersion: 2 }),
    );
  });

  it('reads redacted run audit after explicit authorization', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${run.id}/audit?limit=50`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runId: run.id,
      items: [{ action: 'agent-run.cancel-requested' }],
    });
  });

  it('revokes a Bridge only for a team administrator with confirmation count', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/bridges/${run.bridgeId}/revocations`,
      headers: {
        'idempotency-key': 'CODEx_TEST_M2_R2_REVOKE_KEY',
      },
      payload: {
        reasonCode: 'LOCAL_OWNER_REVOKED',
        expectedActiveRunCount: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      replayed: false,
      status: 'REVOKED',
      affectedRunCount: 1,
    });
  });
});
