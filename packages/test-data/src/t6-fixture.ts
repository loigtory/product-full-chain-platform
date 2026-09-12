import type {
  ActorContext,
  MaterialImpactConfirmationRole,
  RequirementAction,
  RequirementAuthorizationSnapshot,
} from '@pfc/contracts';
import type { GateRunRecord } from '../../../apps/server/src/requirements/repository-port.ts';

import { createT5Fixture } from './t5-fixture.ts';

const now = '2026-09-05T07:00:00.000Z';

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

export function createT6Fixture(runId: string) {
  const t5 = createT5Fixture(`${runId}_BASE`);
  const prefix = `CODEx_TEST_${runId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40)}`;
  const productOwner: ActorContext = {
    actorId: `${prefix}_ACTOR_PRODUCT_OWNER`,
    roles: ['PRODUCT_OWNER'],
    teamIds: [`${prefix}_TEAM_1`],
    authenticationStatus: 'AUTHENTICATED',
  };
  const requirementWrite = {
    ...t5.requirementWrite,
    requirement: {
      ...t5.requirementWrite.requirement,
      currentStage: 'G3' as const,
      rowVersion: 4,
      updatedAt: now,
    },
    timelineEvent: {
      ...t5.requirementWrite.timelineEvent,
      afterSummary: { stage: 'G3', incomplete: false },
      aggregateVersion: 4,
      occurredAt: now,
    },
    outboxEvent: {
      ...t5.requirementWrite.outboxEvent,
      aggregateVersion: 4,
      summary: { stage: 'G3', incomplete: false },
      occurredAt: now,
    },
  };
  const actions = [
    'VIEW_REQUIREMENT',
    'ASSESS_MATERIAL_IMPACT',
    'CONFIRM_MATERIAL_IMPACT',
  ] as const satisfies readonly RequirementAction[];
  const actors = {
    productManager: t5.actors.productManager,
    businessOwner: t5.actors.businessOwner,
    productOwner,
    outsider: t5.actors.outsider,
  };
  const authorization = Object.values(actors).flatMap((actor) =>
    actions.map((action) => ({
      actorId: actor.actorId,
      requirementId: t5.requirementId,
      action,
      data: snapshot({
        actor,
        requirementId: t5.requirementId,
        allowedActions:
          actor === actors.outsider
            ? []
            : actor === actors.productManager
              ? ['VIEW_REQUIREMENT', 'ASSESS_MATERIAL_IMPACT']
              : ['VIEW_REQUIREMENT', 'CONFIRM_MATERIAL_IMPACT'],
      }),
    })),
  );
  const gateRuns: GateRunRecord[] = (['G0', 'G1', 'G3'] as const).map(
    (stage) => ({
      gateRun: {
        id: `${prefix}_GATE_${stage}`,
        requirementId: t5.requirementId,
        baselineId: t5.baselineId,
        stage,
        mode: 'AUTOMATIC',
        status: 'COMPLETED',
        result: stage === 'G3' ? 'WARN' : 'PASS',
        validity: 'CURRENT',
        ownerId: actors.productManager.actorId,
        confirmedRole: null,
        confirmedBy: null,
        confirmedAt: null,
        startedAt: now,
        completedAt: now,
        failureReason: null,
        unknownReason: null,
        registrationNote: null,
      },
      checks: [],
      evidence: [],
      advancement: null,
    }),
  );
  const createRequest = {
    candidateBaseline: {
      sourceType: 'USER_INTERVIEW' as const,
      sourceDescription: null,
      materialPurpose: 'FACT' as const,
      sensitivity: 'INTERNAL' as const,
    },
    recommendedStage: 'G1' as const,
  };

  return {
    now,
    prefix,
    requirementId: t5.requirementId,
    baselineId: t5.baselineId,
    evidenceRefId: t5.evidenceRefId,
    requirementWrite,
    gateRuns,
    actors,
    createRequest,
    impactConfirmation: {
      decision: 'IMPACTS' as const,
      selectedStage: 'G1' as const,
      reason: '新增访谈改变 G1 之后的范围判断。',
      confirmedRole: 'BUSINESS_OWNER' as MaterialImpactConfirmationRole,
    },
    noImpactConfirmation: {
      decision: 'NO_IMPACT' as const,
      selectedStage: null,
      reason: '新增材料只补充已有事实。',
      confirmedRole: 'BUSINESS_OWNER' as MaterialImpactConfirmationRole,
    },
    idempotencyKeys: {
      create: `${prefix}_IDEMPOTENCY_IMPACT_CREATE`,
      confirm: `${prefix}_IDEMPOTENCY_IMPACT_CONFIRM`,
    },
    dependencyFixtures: {
      ...t5.dependencyFixtures,
      authorization,
    },
    createIdFactory() {
      let counter = 0;
      return (kind: string) => `${prefix}_${kind.toUpperCase()}_${++counter}`;
    },
  } as const;
}
