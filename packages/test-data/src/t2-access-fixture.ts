import type {
  ActorContext,
  RequirementAccessRequest,
  RequirementAuthorizationSnapshot,
} from '@pfc/contracts';
import { createScopedActionAuthorization } from '@pfc/domain';

function prefixFor(runId: string): string {
  const normalized = runId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 48);
  if (!normalized) throw new Error('TEST_RUN_ID_REQUIRED');
  return `CODEx_TEST_${normalized}`;
}

export function createT2AccessFixture(runId: string) {
  const prefix = prefixFor(runId);
  const requirementId = `${prefix}_REQ_1`;
  const baselineId = `${prefix}_BASELINE_1`;
  const materialRefId = `${prefix}_MATERIAL_1`;
  const requestedAt = '2026-09-05T01:00:00.000Z';
  const productManager: ActorContext = {
    actorId: `${prefix}_ACTOR_PM`,
    roles: ['PRODUCT_MANAGER'],
    teamIds: [`${prefix}_TEAM_1`],
    authenticationStatus: 'AUTHENTICATED',
  };
  const outsider: ActorContext = {
    actorId: `${prefix}_ACTOR_OUTSIDER`,
    roles: [],
    teamIds: [],
    authenticationStatus: 'AUTHENTICATED',
  };
  const unknown: ActorContext = {
    actorId: `${prefix}_ACTOR_UNKNOWN`,
    roles: [],
    teamIds: [],
    authenticationStatus: 'UNKNOWN',
  };
  const allowedActions = [
    'VIEW_REQUIREMENT',
    'COMPLETE_G0_REGISTRATION',
    'ANSWER_QUESTION',
    'CONFIRM_QUESTION',
    'RUN_GATE',
    'REGISTER_MANUAL_GATE',
    'CONFIRM_MATERIAL_IMPACT',
    'VIEW_MATERIAL',
    'TRANSMIT_MATERIAL',
  ] as const;
  const allowed: RequirementAuthorizationSnapshot = {
    actorId: productManager.actorId,
    requirementId,
    membership: { team: 'YES', requirement: 'YES', restricted: 'YES' },
    allowedActions,
    approvedTransmissionTargets: ['APPROVED_AI', 'APPROVED_SKILL'],
    actionAuthorizations: [
      createScopedActionAuthorization({
        authorizationId: `${prefix}_AUTHORIZATION_1`,
        actorId: productManager.actorId,
        requirementId,
        target: 'APPROVED_AI',
        purpose: 'requirements-analysis',
        materialRefIds: [materialRefId],
        grantedBy: `${prefix}_ACTOR_PO`,
        grantorRoles: ['PRODUCT_OWNER'],
        grantedAt: '2026-09-05T00:45:00.000Z',
        validUntil: '2026-09-05T01:15:00.000Z',
      }),
    ],
  };
  const outsiderSnapshot: RequirementAuthorizationSnapshot = {
    actorId: outsider.actorId,
    requirementId,
    membership: { team: 'NO', requirement: 'NO', restricted: 'NO' },
    allowedActions: [],
    approvedTransmissionTargets: [],
    actionAuthorizations: [],
  };
  const unknownMembership: RequirementAuthorizationSnapshot = {
    ...allowed,
    membership: { team: 'UNKNOWN', requirement: 'NO', restricted: 'UNKNOWN' },
  };
  const request = (
    input: Omit<RequirementAccessRequest, 'requirementId' | 'requestedAt'>,
  ): RequirementAccessRequest => ({ requirementId, requestedAt, ...input });
  const requests = {
    internalView: request({
      action: 'VIEW_REQUIREMENT',
      sensitivity: 'INTERNAL',
      materialRefIds: [],
    }),
    publicView: request({
      action: 'VIEW_REQUIREMENT',
      sensitivity: 'PUBLIC',
      materialRefIds: [],
    }),
    restrictedView: request({
      action: 'VIEW_MATERIAL',
      sensitivity: 'RESTRICTED',
      materialRefIds: [materialRefId],
    }),
    internalTransmission: request({
      action: 'TRANSMIT_MATERIAL',
      sensitivity: 'INTERNAL',
      materialRefIds: [materialRefId],
      transmission: {
        target: 'APPROVED_AI',
        purpose: 'requirements-analysis',
      },
    }),
    restrictedTransmission: request({
      action: 'TRANSMIT_MATERIAL',
      sensitivity: 'RESTRICTED',
      materialRefIds: [materialRefId],
      transmission: {
        target: 'APPROVED_AI',
        purpose: 'requirements-analysis',
      },
    }),
    confirmQuestion: request({
      action: 'CONFIRM_QUESTION',
      sensitivity: 'INTERNAL',
      materialRefIds: [],
    }),
  } as const;
  const portRequests = {
    authorization: {
      actor: productManager,
      requirementId,
      action: 'VIEW_REQUIREMENT' as const,
    },
    artifacts: {
      actorId: productManager.actorId,
      requirementId,
      baselineId,
      evidenceRefIds: [materialRefId],
    },
    gateExecution: {
      actorId: productManager.actorId,
      requirementId,
      baselineId,
      stage: 'G0' as const,
      idempotencyKey: `${prefix}_IDEMPOTENCY_GATE_1`,
    },
    deliverySummary: {
      actorId: productManager.actorId,
      requirementId,
      baselineId,
      stage: 'G9' as const,
    },
  } as const;

  return {
    prefix,
    requirementId,
    baselineId,
    materialRefId,
    actors: { productManager, outsider, unknown },
    requests,
    snapshots: { allowed, outsider: outsiderSnapshot, unknownMembership },
    portRequests,
    dependencyFixtures: {
      authorization: [
        {
          actorId: productManager.actorId,
          requirementId,
          action: 'VIEW_REQUIREMENT',
          data: allowed,
        },
      ],
      artifacts: [
        {
          actorId: productManager.actorId,
          requirementId,
          baselineId,
          evidenceRefIds: [materialRefId],
          data: [
            {
              evidenceRefId: materialRefId,
              baselineId,
              referenceType: 'SYNTHETIC_TEST_REFERENCE',
              sensitivity: 'RESTRICTED' as const,
              validity: 'VALID' as const,
            },
          ],
        },
      ],
      gateExecutions: [
        {
          actorId: productManager.actorId,
          requirementId,
          baselineId,
          stage: 'G0',
          idempotencyKey: `${prefix}_IDEMPOTENCY_GATE_1`,
          data: {
            executionId: `${prefix}_EXECUTION_1`,
            status: 'COMPLETED' as const,
            result: 'BLOCK' as const,
          },
        },
      ],
      deliverySummaries: [
        {
          actorId: productManager.actorId,
          requirementId,
          baselineId,
          stage: 'G9',
          data: {
            status: 'MISSING' as const,
            result: 'BLOCK' as const,
            summaryVersion: null,
          },
        },
      ],
    },
  } as const;
}
