import type {
  ActorContext,
  RequirementAction,
  RequirementAuthorizationSnapshot,
} from '@pfc/contracts';
import {
  confirmQuestionDecision,
  createQuestionDecision,
  transitionQuestion,
  type Decision,
  type Question,
} from '@pfc/domain';

import { createT3Fixture } from './t3-fixture.ts';

const now = '2026-09-05T05:00:00.000Z';

function prefixFor(runId: string): string {
  const normalized = runId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  if (!normalized) throw new Error('TEST_RUN_ID_REQUIRED');
  return `CODEx_TEST_${normalized}`;
}

function question(input: {
  prefix: string;
  suffix: string;
  requirementId: string;
  baselineId: string;
  ownerId: string;
}): Question {
  return {
    id: `${input.prefix}_QUESTION_${input.suffix}`,
    requirementId: input.requirementId,
    baselineId: input.baselineId,
    prompt: `${input.suffix}：本版本采用哪种结算口径？`,
    reason: '当前阶段必须有唯一、可追踪的口径。',
    candidates: ['按实结算', '按预算结算'],
    ownerId: input.ownerId,
    closeByStage: 'G1',
    status: 'OPEN',
    currentDecisionId: null,
    rowVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
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

export function createT4Fixture(runId: string) {
  const prefix = prefixFor(runId);
  const t3 = createT3Fixture(`${runId}_BASE`);
  const businessOwner: ActorContext = {
    actorId: `${prefix}_ACTOR_BUSINESS_OWNER`,
    roles: ['BUSINESS_OWNER'],
    teamIds: [`${prefix}_TEAM_1`],
    authenticationStatus: 'AUTHENTICATED',
  };
  const productOwner: ActorContext = {
    actorId: `${prefix}_ACTOR_PRODUCT_OWNER`,
    roles: ['PRODUCT_OWNER'],
    teamIds: [`${prefix}_TEAM_1`],
    authenticationStatus: 'AUTHENTICATED',
  };
  const member: ActorContext = {
    actorId: `${prefix}_ACTOR_MEMBER`,
    roles: ['PRODUCT_MANAGER'],
    teamIds: [`${prefix}_TEAM_1`],
    authenticationStatus: 'AUTHENTICATED',
  };
  const completeWrite = t3.seedWrites.find(
    (write) => write.requirement.id === t3.requirementIds.complete,
  );
  if (!completeWrite?.materialBaseline) {
    throw new Error('T4_COMPLETE_REQUIREMENT_REQUIRED');
  }
  const requirementId = completeWrite.requirement.id;
  const baselineId = completeWrite.materialBaseline.id;
  const requirementWrite = {
    ...completeWrite,
    requirement: {
      ...completeWrite.requirement,
      businessOwnerId: businessOwner.actorId,
    },
  };

  const open = question({
    prefix,
    suffix: 'OPEN',
    requirementId,
    baselineId,
    ownerId: businessOwner.actorId,
  });
  const returnableBase = question({
    prefix,
    suffix: 'RETURNABLE',
    requirementId,
    baselineId,
    ownerId: businessOwner.actorId,
  });
  const returnableDecision = createQuestionDecision({
    id: `${prefix}_DECISION_RETURNABLE_1`,
    kind: 'ANSWER',
    question: returnableBase,
    rawAnswer: '按预算结算',
    explanation: '等待责任角色确认。',
    versionNumber: 1,
    now,
  });
  const returnable = transitionQuestion(returnableBase, {
    type: 'ANSWER',
    decisionId: returnableDecision.id,
    expectedRowVersion: 0,
    now,
  });
  const confirmedBase = question({
    prefix,
    suffix: 'CONFIRMED',
    requirementId,
    baselineId,
    ownerId: businessOwner.actorId,
  });
  const answer = createQuestionDecision({
    id: `${prefix}_DECISION_CONFIRMED_1`,
    kind: 'ANSWER',
    question: confirmedBase,
    rawAnswer: '按预算结算',
    explanation: '初始决定。',
    versionNumber: 1,
    now,
  });
  const answered = transitionQuestion(confirmedBase, {
    type: 'ANSWER',
    decisionId: answer.id,
    expectedRowVersion: 0,
    now,
  });
  const confirmedDecision = confirmQuestionDecision(answer, {
    question: answered,
    decisionId: answer.id,
    confirmedRole: 'BUSINESS_OWNER',
    confirmedBy: businessOwner.actorId,
    now,
  });
  const confirmed = transitionQuestion(answered, {
    type: 'CONFIRM',
    expectedRowVersion: 1,
    now,
  });

  const actions = [
    'VIEW_REQUIREMENT',
    'ANSWER_QUESTION',
    'CONFIRM_QUESTION',
  ] as const;
  const dependencyFixtures = {
    authorization: [
      ...[businessOwner, productOwner].flatMap((actor) =>
        actions.map((action) => ({
          actorId: actor.actorId,
          requirementId,
          action,
          data: snapshot({ actor, requirementId, allowedActions: actions }),
        })),
      ),
      {
        actorId: member.actorId,
        requirementId,
        action: 'VIEW_REQUIREMENT' as const,
        data: snapshot({
          actor: member,
          requirementId,
          allowedActions: ['VIEW_REQUIREMENT'],
        }),
      },
      ...(['ANSWER_QUESTION', 'CONFIRM_QUESTION'] as const).map((action) => ({
        actorId: member.actorId,
        requirementId,
        action,
        data: snapshot({
          actor: member,
          requirementId,
          allowedActions: ['VIEW_REQUIREMENT'],
        }),
      })),
    ],
    deliverySummaries: [],
  };
  const questionRecords: ReadonlyArray<{
    question: Question;
    decisions: readonly Decision[];
  }> = [
    { question: open, decisions: [] },
    { question: returnable, decisions: [returnableDecision] },
    { question: confirmed, decisions: [confirmedDecision] },
  ];

  return {
    now,
    prefix,
    requirementId,
    baselineId,
    actors: { businessOwner, productOwner, member },
    requirementWrite,
    questionRecords,
    questionIds: {
      open: open.id,
      returnable: returnable.id,
      confirmed: confirmed.id,
    },
    decisionIds: {
      returnable: returnableDecision.id,
      confirmed: confirmedDecision.id,
    },
    inputs: {
      answer: {
        rawAnswer: '按实结算',
        explanation: '以实际核定金额作为唯一口径。',
      },
      confirm: {
        decisionId: returnableDecision.id,
        confirmedRole: 'BUSINESS_OWNER' as const,
      },
      returned: { reason: '缺少财务核对依据，请补充后重新回答。' },
      supersede: {
        rawAnswer: '按实结算',
        explanation: '新证据纠正了原决定。',
        confirmedRole: 'BUSINESS_OWNER' as const,
      },
      defer: {
        reason: '当前版本不依赖该统计口径。',
        reopenCondition: '进入 G3 前或需求范围变化时重开。',
        confirmedRole: 'BUSINESS_OWNER' as const,
      },
    },
    idempotencyKeys: {
      answer: `${prefix}_IDEMPOTENCY_ANSWER`,
      confirm: `${prefix}_IDEMPOTENCY_CONFIRM`,
      returned: `${prefix}_IDEMPOTENCY_RETURN`,
      supersede: `${prefix}_IDEMPOTENCY_SUPERSEDE`,
      defer: `${prefix}_IDEMPOTENCY_DEFER`,
      conflict: `${prefix}_IDEMPOTENCY_CONFLICT`,
    },
    dependencyFixtures,
    createIdFactory() {
      let counter = 0;
      return (kind: string) => `${prefix}_${kind.toUpperCase()}_${++counter}`;
    },
  } as const;
}
