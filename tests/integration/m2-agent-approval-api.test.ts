import { afterAll, describe, expect, it } from 'vitest';

import type {
  AgentApprovalDto,
  AgentRunDto,
  AuthorizationPort,
} from '@pfc/contracts';
import { decideAgentApproval } from '@pfc/domain';

import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { AgentApprovalApplicationService } from '../../apps/server/src/agent-approvals/index.ts';
import { buildServer } from '../../apps/server/src/app.ts';

const now = '2026-09-06T07:00:00.000Z';
const requesterId = 'CODEx_TEST_M2_R2_REQUESTER';
const approver = {
  actorId: 'CODEx_TEST_M2_R2_APPROVER',
  roles: ['PRODUCT_OWNER'] as const,
  teamIds: ['CODEx_TEST_M2_R2_TEAM'],
  authenticationStatus: 'AUTHENTICATED' as const,
};
const scope = {
  allowedRelativePaths: ['docs/requirements/acceptance.md'],
  allowedActions: ['EDIT_FILES'] as const,
  networkAccess: false as const,
  maxChangedFiles: 1,
  maxChangedBytes: 20_000,
};
const run: AgentRunDto = {
  id: 'CODEx_TEST_M2_R2_RUN',
  requirementId: 'CODEx_TEST_M2_R2_REQUIREMENT',
  baselineId: 'CODEx_TEST_M2_R2_BASELINE',
  workspaceId: 'CODEx_TEST_M2_R2_WORKSPACE',
  gitBaseline: '0123456789abcdef0123456789abcdef01234567',
  skillReleaseId: 'CODEx_TEST_M2_R2_SKILL',
  operation: 'CONTROLLED_ARTIFACT_EDIT',
  accessMode: 'WORKSPACE_WRITE',
  status: 'WAITING_APPROVAL',
  parentRunId: null,
  bridgeId: null,
  executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION',
  externalIds: { threadId: null, turnId: null },
  resultOutcome: null,
  runScope: { ...scope, expiresAt: '2026-09-06T07:10:00.000Z' },
  runScopeHash: `sha256:${'a'.repeat(64)}`,
  executionStartedAt: null,
  cancelRequestedAt: null,
  terminalAt: null,
  resultSummary: null,
  failureReason: null,
  rowVersion: 1,
  createdBy: requesterId,
  createdAt: now,
  updatedAt: now,
};
const pending: AgentApprovalDto = {
  id: 'CODEx_TEST_M2_R2_APPROVAL',
  runId: run.id,
  executionInstanceId: run.executionInstanceId!,
  appServerRequestId: null,
  threadId: null,
  turnId: null,
  itemId: null,
  callbackId: null,
  kind: 'RUN_START',
  requestedScope: scope,
  scopeHash: `sha256:${'b'.repeat(64)}`,
  outsideCapsule: false,
  approvedScope: null,
  decision: 'PENDING',
  requestedBy: requesterId,
  requestedAt: now,
  expiresAt: '2026-09-06T07:10:00.000Z',
  decidedBy: null,
  decidedAt: null,
  reasonCode: null,
  rowVersion: 0,
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
        allowedActions: ['APPROVE_AGENT_ACTION', 'VIEW_AGENT_RUN'],
        approvedTransmissionTargets: [],
        actionAuthorizations: [],
      },
    };
  },
};

describe('M2 approval HTTP API', () => {
  let current: AgentApprovalDto = pending;
  const service = new AgentApprovalApplicationService({
    repository: {
      async findApproval() {
        return current;
      },
      async listPendingForActor() {
        return current.decision === 'PENDING' ? [current] : [];
      },
      async decideApproval(input) {
        if (input.expectedRowVersion !== current.rowVersion) {
          return { status: 'CONFLICT', approval: current };
        }
        current = decideAgentApproval(current, input.decision);
        return { status: 'DECIDED', approval: current };
      },
    },
    runRepository: {
      async findRun() {
        return run;
      },
      async findRunSensitivity() {
        return 'INTERNAL';
      },
    },
    authorization: new RequirementAuthorizationService(authorization),
    now: () => '2026-09-06T07:05:00.000Z',
    idFactory: (prefix) => `CODEx_TEST_M2_R2_${prefix}`,
  });
  const server = buildServer({
    agentApprovalService: service,
    resolveActor: () => approver,
  });

  afterAll(async () => server.close());

  it('lists pending approvals and decides once with an ETag', async () => {
    const list = await server.inject({
      method: 'GET',
      url: '/api/v1/agent-approvals?limit=20',
    });
    const detail = await server.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${run.id}/approvals/${pending.id}`,
    });
    const requesterServer = buildServer({
      agentApprovalService: service,
      resolveActor: () => ({
        actorId: requesterId,
        roles: ['PRODUCT_OWNER'],
        teamIds: ['CODEx_TEST_M2_R2_TEAM'],
        authenticationStatus: 'AUTHENTICATED',
      }),
    });
    const selfDecision = await requesterServer.inject({
      method: 'POST',
      url: `/api/v1/agent-approvals/${pending.id}/decision`,
      headers: {
        'if-match': '"0"',
        'idempotency-key': 'CODEx_TEST_M2_R2_SELF_APPROVAL',
      },
      payload: {
        decision: 'APPROVED',
        approvedScope: scope,
        reasonCode: 'SELF_APPROVAL',
      },
    });
    await requesterServer.close();
    const narrowedStartDecision = await server.inject({
      method: 'POST',
      url: `/api/v1/agent-approvals/${pending.id}/decision`,
      headers: {
        'if-match': '"0"',
        'idempotency-key': 'CODEx_TEST_M2_R2_NARROWED_START_SCOPE',
      },
      payload: {
        decision: 'APPROVED',
        approvedScope: { ...scope, maxChangedBytes: 10_000 },
        reasonCode: 'SCOPE_CHANGED',
      },
    });
    const decision = await server.inject({
      method: 'POST',
      url: `/api/v1/agent-approvals/${pending.id}/decision`,
      headers: {
        'if-match': '"0"',
        'idempotency-key': 'CODEx_TEST_M2_R2_APPROVAL_DECISION',
      },
      payload: {
        decision: 'APPROVED',
        approvedScope: scope,
        reasonCode: 'SCOPE_REVIEWED',
      },
    });
    const replayWithStaleVersion = await server.inject({
      method: 'POST',
      url: `/api/v1/agent-approvals/${pending.id}/decision`,
      headers: {
        'if-match': '"0"',
        'idempotency-key': 'CODEx_TEST_M2_R2_APPROVAL_REPLAY',
      },
      payload: { decision: 'REJECTED', reasonCode: 'REPLAY' },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ items: [{ id: pending.id }] });
    expect(detail.statusCode).toBe(200);
    expect(detail.headers.etag).toBe('"0"');
    expect(detail.json()).toMatchObject({ id: pending.id, runId: run.id });
    expect(selfDecision.statusCode).toBe(403);
    expect(selfDecision.json()).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(narrowedStartDecision.statusCode).toBe(400);
    expect(narrowedStartDecision.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.headers.etag).toBe('"1"');
    expect(decision.json()).toMatchObject({ decision: 'APPROVED' });
    expect(replayWithStaleVersion.statusCode).toBe(409);
    expect(replayWithStaleVersion.json()).toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });
});
