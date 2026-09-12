import type {
  ActorContext,
  GateConfirmationRole,
  RequirementAction,
  RequirementAuthorizationSnapshot,
} from '@pfc/contracts';

import { createT4Fixture } from './t4-fixture.ts';

const now = '2026-09-05T06:00:00.000Z';

function prefixFor(runId: string): string {
  const normalized = runId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  if (!normalized) throw new Error('TEST_RUN_ID_REQUIRED');
  return `CODEx_TEST_${normalized}`;
}

function snapshot(input: {
  actor: ActorContext;
  requirementId: string;
  allowedActions: readonly RequirementAction[];
}): RequirementAuthorizationSnapshot {
  return {
    actorId: input.actor.actorId,
    requirementId: input.requirementId,
    membership: { team: 'YES', requirement: 'YES', restricted: 'YES' },
    allowedActions: input.allowedActions,
    approvedTransmissionTargets: [],
    actionAuthorizations: [],
  };
}

export function createT5Fixture(runId: string) {
  const prefix = prefixFor(runId);
  const t4 = createT4Fixture(`${runId}_BASE`);
  const productManager: ActorContext = {
    actorId: `${prefix}_ACTOR_PM`,
    roles: ['PRODUCT_MANAGER'],
    teamIds: [`${prefix}_TEAM_1`],
    authenticationStatus: 'AUTHENTICATED',
  };
  const businessOwner: ActorContext = {
    actorId: `${prefix}_ACTOR_BUSINESS_OWNER`,
    roles: ['BUSINESS_OWNER'],
    teamIds: [`${prefix}_TEAM_1`],
    authenticationStatus: 'AUTHENTICATED',
  };
  const outsider: ActorContext = {
    actorId: `${prefix}_ACTOR_OUTSIDER`,
    roles: ['PRODUCT_MANAGER'],
    teamIds: [`${prefix}_OTHER_TEAM`],
    authenticationStatus: 'AUTHENTICATED',
  };
  const requirementId = t4.requirementId;
  const baselineId = t4.baselineId;
  const evidenceRefId = `${prefix}_EVIDENCE_1`;
  const automaticKey = `${prefix}_IDEMPOTENCY_AUTOMATIC`;
  const manualKey = `${prefix}_IDEMPOTENCY_MANUAL`;
  const viewAndRun = [
    'VIEW_REQUIREMENT',
    'RUN_GATE',
  ] as const satisfies readonly RequirementAction[];
  const viewAndManual = [
    'VIEW_REQUIREMENT',
    'REGISTER_MANUAL_GATE',
  ] as const satisfies readonly RequirementAction[];
  const authorization = [
    ...viewAndRun.map((action) => ({
      actorId: productManager.actorId,
      requirementId,
      action,
      data: snapshot({
        actor: productManager,
        requirementId,
        allowedActions: viewAndRun,
      }),
    })),
    ...viewAndManual.map((action) => ({
      actorId: businessOwner.actorId,
      requirementId,
      action,
      data: snapshot({
        actor: businessOwner,
        requirementId,
        allowedActions: viewAndManual,
      }),
    })),
    ...(['VIEW_REQUIREMENT', 'RUN_GATE', 'REGISTER_MANUAL_GATE'] as const).map(
      (action) => ({
        actorId: outsider.actorId,
        requirementId,
        action,
        data: snapshot({ actor: outsider, requirementId, allowedActions: [] }),
      }),
    ),
  ];
  const dependencyFixtures = {
    authorization,
    artifacts: [
      {
        actorId: businessOwner.actorId,
        requirementId,
        baselineId,
        evidenceRefIds: [evidenceRefId],
        data: [
          {
            evidenceRefId,
            baselineId,
            referenceType: 'PRODUCT_SPEC',
            sensitivity: 'INTERNAL' as const,
            validity: 'VALID' as const,
          },
        ],
      },
    ],
    gateExecutionCapabilities: [
      {
        actorId: productManager.actorId,
        requirementId,
        baselineId,
        stage: 'G0' as const,
        data: { executable: true as const },
      },
    ],
    gateExecutions: [
      {
        actorId: productManager.actorId,
        requirementId,
        baselineId,
        stage: 'G0' as const,
        idempotencyKey: automaticKey,
        data: {
          executionId: `${prefix}_EXTERNAL_EXECUTION_1`,
          status: 'COMPLETED' as const,
          result: 'PASS' as const,
        },
      },
    ],
    deliverySummaries: [],
  };
  const dueQuestionRecord = {
    question: {
      ...t4.questionRecords[0]!.question,
      id: `${prefix}_QUESTION_DUE_G0`,
      closeByStage: 'G0' as const,
    },
    decisions: [],
  };
  const manualRequest = {
    baselineId,
    stage: 'G0' as const,
    result: 'PASS' as const,
    registrationNote: '自动检查不可用，责任角色依据当前证据完成人工登记。',
    confirmedRole: 'BUSINESS_OWNER' as GateConfirmationRole,
    evidenceRefIds: [evidenceRefId],
    checks: [
      {
        checkKey: 'g0.registration.complete',
        result: 'PASS' as const,
        ownerId: businessOwner.actorId,
        closePoint: 'G0',
      },
      {
        checkKey: 'g0.external.release',
        result: 'NOT_APPLICABLE' as const,
        reason: 'G0 不涉及外部发布。',
        ownerId: businessOwner.actorId,
        closePoint: 'G0',
      },
    ],
  };

  return {
    now,
    prefix,
    requirementId,
    baselineId,
    evidenceRefId,
    requirementWrite: {
      ...t4.requirementWrite,
      requirement: {
        ...t4.requirementWrite.requirement,
        businessOwnerId: businessOwner.actorId,
      },
    },
    questionRecords: t4.questionRecords,
    dueQuestionRecord,
    actors: { productManager, businessOwner, outsider },
    automaticRequest: { baselineId, stage: 'G0' as const },
    manualRequest,
    idempotencyKeys: {
      automatic: automaticKey,
      automaticSecond: `${prefix}_IDEMPOTENCY_AUTOMATIC_SECOND`,
      manual: manualKey,
    },
    dependencyFixtures,
    createIdFactory() {
      let counter = 0;
      return (kind: string) => `${prefix}_${kind.toUpperCase()}_${++counter}`;
    },
  } as const;
}
