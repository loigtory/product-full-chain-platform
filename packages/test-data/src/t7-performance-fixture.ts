import {
  createOutboxEvent,
  createRequirementDraft,
  type MaterialBaseline,
  type EvidenceRef,
  type OutboxEvent,
  type Requirement,
  type TimelineEvent,
} from '@pfc/domain';

type SeedWrite = Readonly<{
  requirement: Requirement;
  materialBaseline: MaterialBaseline | null;
  materialRefs: readonly EvidenceRef[];
  timelineEvent: TimelineEvent;
  outboxEvent: OutboxEvent;
}>;

function prefixFor(runId: string): string {
  const normalized = runId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  if (!normalized) throw new Error('TEST_RUN_ID_REQUIRED');
  return `CODEx_TEST_${normalized}`;
}

function createdWrite(
  prefix: string,
  index: number,
  occurredAt: string,
): SeedWrite {
  const suffix = String(index).padStart(4, '0');
  const requirementId = `${prefix}_REQ_${suffix}`;
  const draft = createRequirementDraft({
    id: requirementId,
    name: `T7 synthetic requirement ${suffix}`,
    originalIdea: `Local performance fixture ${suffix}.`,
    initiatorId: `${prefix}_ACTOR_PM`,
    now: occurredAt,
  });
  const summary = { stage: 'G0', incomplete: true } as const;
  return {
    requirement: draft.requirement,
    materialBaseline: null,
    materialRefs: [],
    timelineEvent: {
      id: `${prefix}_TIMELINE_${suffix}_0`,
      requirementId,
      aggregateType: 'requirement',
      aggregateId: requirementId,
      eventType: 'requirement.created',
      actorId: `${prefix}_ACTOR_PM`,
      beforeSummary: null,
      afterSummary: summary,
      aggregateVersion: 0,
      occurredAt,
    },
    outboxEvent: createOutboxEvent({
      id: `${prefix}_OUTBOX_${suffix}_0`,
      type: 'requirement.created',
      aggregateType: 'requirement',
      aggregateId: requirementId,
      aggregateVersion: 0,
      occurredAt,
      summary,
    }),
  };
}

export function createT7PerformanceFixture(
  runId: string,
  options: { requirementCount: number; timelineEventCount: number },
) {
  if (
    !Number.isInteger(options.requirementCount) ||
    options.requirementCount < 1 ||
    !Number.isInteger(options.timelineEventCount) ||
    options.timelineEventCount < 1
  ) {
    throw new Error('TEST_DATA_SIZE_INVALID');
  }
  const prefix = prefixFor(runId);
  const baseTime = Date.parse('2026-09-05T08:00:00.000Z');
  const requirements = Array.from(
    { length: options.requirementCount },
    (_, index) =>
      createdWrite(prefix, index, new Date(baseTime + index).toISOString()),
  );
  const target = requirements[0]!;
  const targetHistory = Array.from(
    { length: options.timelineEventCount - 1 },
    (_, offset): SeedWrite => {
      const aggregateVersion = offset + 1;
      const occurredAt = new Date(
        baseTime + options.requirementCount + aggregateVersion,
      ).toISOString();
      const summary = { stage: 'G0', incomplete: true } as const;
      return {
        requirement: {
          ...target.requirement,
          rowVersion: aggregateVersion,
          updatedAt: occurredAt,
        },
        materialBaseline: null,
        materialRefs: [],
        timelineEvent: {
          id: `${prefix}_TIMELINE_0000_${aggregateVersion}`,
          requirementId: target.requirement.id,
          aggregateType: 'requirement',
          aggregateId: target.requirement.id,
          eventType: 'requirement.updated',
          actorId: `${prefix}_ACTOR_PM`,
          beforeSummary: summary,
          afterSummary: summary,
          aggregateVersion,
          occurredAt,
        },
        outboxEvent: createOutboxEvent({
          id: `${prefix}_OUTBOX_0000_${aggregateVersion}`,
          type: 'requirement.updated',
          aggregateType: 'requirement',
          aggregateId: target.requirement.id,
          aggregateVersion,
          occurredAt,
          summary,
        }),
      };
    },
  );

  return {
    now: '2026-09-05T08:05:00.000Z',
    actor: {
      actorId: `${prefix}_ACTOR_PM`,
      roles: ['PRODUCT_MANAGER'] as const,
      teamIds: [`${prefix}_TEAM_1`],
      authenticationStatus: 'AUTHENTICATED' as const,
    },
    timelineRequirementId: target.requirement.id,
    seedWrites: [...requirements, ...targetHistory],
  } as const;
}
