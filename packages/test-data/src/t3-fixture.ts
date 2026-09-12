import { createHash } from 'node:crypto';

import {
  createInitialMaterialRef,
  createOutboxEvent,
  createRequirementDraft,
  type MaterialBaseline,
  type EvidenceRef,
  type OutboxEvent,
  type Requirement,
  type TimelineEvent,
} from '@pfc/domain';

import { createT2AccessFixture } from './t2-access-fixture.ts';

const now = '2026-09-05T02:00:00.000Z';

type SeedWrite = Readonly<{
  requirement: Requirement;
  materialBaseline: MaterialBaseline | null;
  materialRefs: readonly EvidenceRef[];
  timelineEvent: TimelineEvent;
  outboxEvent: OutboxEvent;
}>;

function prefixFor(runId: string): string {
  const normalized = runId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 48);
  if (!normalized) throw new Error('TEST_RUN_ID_REQUIRED');
  return `CODEx_TEST_${normalized}`;
}

function seedWrite(input: {
  prefix: string;
  suffix: string;
  updatedAt: string;
  registration?: Parameters<typeof createRequirementDraft>[0]['registration'];
}): SeedWrite {
  const requirementId = `${input.prefix}_REQ_${input.suffix}`;
  const draft = createRequirementDraft({
    id: requirementId,
    name: `T3 合成需求 ${input.suffix}`,
    originalIdea: `T3 synthetic local-only idea ${input.suffix}.`,
    initiatorId: `${input.prefix}_ACTOR_PM`,
    now: input.updatedAt,
    registration: input.registration,
    initialBaselineId: `${input.prefix}_BASELINE_${input.suffix}_1`,
    confirmedBy: `${input.prefix}_ACTOR_PM`,
  });
  const incomplete = draft.missingFields.length > 0;
  const summary = { stage: 'G0', incomplete } as const;
  return {
    requirement: draft.requirement,
    materialBaseline: draft.materialBaseline,
    materialRefs: draft.materialBaseline
      ? [
          createInitialMaterialRef({
            id: `${input.prefix}_MATERIAL_REF_${input.suffix}_1`,
            requirement: draft.requirement,
            baseline: draft.materialBaseline,
            contentHash: `sha256:${createHash('sha256')
              .update(draft.requirement.originalIdea)
              .digest('hex')}`,
          }),
        ]
      : [],
    timelineEvent: {
      id: `${input.prefix}_TIMELINE_${input.suffix}_1`,
      requirementId,
      aggregateType: 'requirement',
      aggregateId: requirementId,
      eventType: 'requirement.created',
      actorId: `${input.prefix}_ACTOR_PM`,
      beforeSummary: null,
      afterSummary: summary,
      aggregateVersion: draft.requirement.rowVersion,
      occurredAt: input.updatedAt,
    },
    outboxEvent: createOutboxEvent({
      id: `${input.prefix}_OUTBOX_${input.suffix}_1`,
      type: 'requirement.created',
      aggregateType: 'requirement',
      aggregateId: requirementId,
      aggregateVersion: draft.requirement.rowVersion,
      occurredAt: input.updatedAt,
      summary,
    }),
  };
}

export function createT3Fixture(runId: string) {
  const prefix = prefixFor(runId);
  const t2 = createT2AccessFixture(runId);
  const actor = {
    ...t2.actors.productManager,
    actorId: `${prefix}_ACTOR_PM`,
    teamIds: [`${prefix}_TEAM_1`],
  };
  const incomplete = seedWrite({
    prefix,
    suffix: 'INCOMPLETE',
    updatedAt: '2026-09-05T02:03:00.000Z',
  });
  const complete = seedWrite({
    prefix,
    suffix: 'COMPLETE',
    updatedAt: '2026-09-05T02:02:00.000Z',
    registration: {
      sourceType: 'BUSINESS_FEEDBACK',
      businessOwnerId: actor.actorId,
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
    },
  });
  const denied = seedWrite({
    prefix,
    suffix: 'DENIED',
    updatedAt: '2026-09-05T02:01:00.000Z',
    registration: {
      sourceType: 'INTERNAL_IMPROVEMENT',
      businessOwnerId: `${prefix}_ACTOR_OTHER`,
      materialPurpose: 'CONSTRAINT',
      sensitivity: 'INTERNAL',
    },
  });

  const allowedSnapshot = (requirementId: string) => ({
    actorId: actor.actorId,
    requirementId,
    membership: {
      team: 'YES' as const,
      requirement: 'YES' as const,
      restricted: 'YES' as const,
    },
    allowedActions: [
      'VIEW_REQUIREMENT' as const,
      'COMPLETE_G0_REGISTRATION' as const,
    ],
    approvedTransmissionTargets: [],
    actionAuthorizations: [],
  });

  return {
    now,
    actors: { ...t2.actors, productManager: actor },
    requirementIds: {
      incomplete: incomplete.requirement.id,
      complete: complete.requirement.id,
      denied: denied.requirement.id,
    },
    seedWrites: [incomplete, complete, denied],
    createInputs: {
      incomplete: {
        name: 'T3 新建缺项草稿',
        originalIdea: '仅保留本地合成原始想法。',
      },
      complete: {
        name: 'T3 新建完整草稿',
        originalIdea: '完整登记但不得显示为 G0 PASS。',
        registration: {
          sourceType: 'USER_INTERVIEW' as const,
          businessOwnerId: actor.actorId,
          materialPurpose: 'FACT' as const,
          sensitivity: 'INTERNAL' as const,
        },
      },
      sameName: {
        name: 'T3 同名需求',
        originalIdea: '同名不代表同一业务对象。',
      },
    },
    completeRegistration: {
      sourceType: 'OTHER' as const,
      sourceDescription: '来自跨部门专题讨论，原分类无法准确覆盖',
      businessOwnerId: actor.actorId,
      materialPurpose: 'CONSTRAINT' as const,
      sensitivity: 'RESTRICTED' as const,
    },
    idempotencyKeys: {
      incomplete: `${prefix}_IDEMPOTENCY_CREATE_INCOMPLETE`,
      complete: `${prefix}_IDEMPOTENCY_CREATE_COMPLETE`,
      sameNameFirst: `${prefix}_IDEMPOTENCY_SAME_1`,
      sameNameSecond: `${prefix}_IDEMPOTENCY_SAME_2`,
      conflict: `${prefix}_IDEMPOTENCY_CONFLICT`,
      recovery: `${prefix}_IDEMPOTENCY_RECOVERY`,
      completeRegistration: `${prefix}_IDEMPOTENCY_COMPLETE`,
      staleRegistration: `${prefix}_IDEMPOTENCY_STALE`,
    },
    createIdFactory() {
      let counter = 0;
      return (kind: string) => `${prefix}_${kind.toUpperCase()}_${++counter}`;
    },
    dependencyFixtures: {
      authorization: [
        ...[incomplete.requirement.id, complete.requirement.id].flatMap(
          (requirementId) =>
            (['VIEW_REQUIREMENT', 'COMPLETE_G0_REGISTRATION'] as const).map(
              (action) => ({
                actorId: actor.actorId,
                requirementId,
                action,
                data: allowedSnapshot(requirementId),
              }),
            ),
        ),
      ],
      deliverySummaries: [],
    },
  } as const;
}
