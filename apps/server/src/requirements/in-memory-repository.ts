import {
  applyGateResult,
  assertGateCheckConsistency,
  DomainRuleViolation,
} from '@pfc/domain';

import type {
  CompleteG0Command,
  CompleteGateRunCommand,
  ConfirmMaterialImpactWrite,
  CreateMaterialImpactWrite,
  GateRunRecord,
  GateRunStartResult,
  IdempotentQuestionCommand,
  IdempotentGateRunStartCommand,
  IdempotentCommandResult,
  IdempotentRequirementCommand,
  IdempotentMaterialImpactCommand,
  RequirementRecord,
  RequirementRepositoryPort,
  RequirementWrite,
  QuestionRecord,
} from './repository-port.ts';

function idempotencyMapKey(input: {
  actorId: string;
  route: string;
  idempotencyKey: string;
}): string {
  return `${input.actorId}\u0000${input.route}\u0000${input.idempotencyKey}`;
}

export class InMemoryRequirementRepository implements RequirementRepositoryPort {
  private readonly requirements = new Map<string, RequirementRecord>();
  private readonly idempotency = new Map<
    string,
    IdempotentRequirementCommand['idempotency']
  >();
  private readonly questions = new Map<string, QuestionRecord>();
  private readonly gateRuns = new Map<string, GateRunRecord>();
  private readonly materialBaselines = new Map<
    string,
    import('@pfc/domain').MaterialBaseline
  >();
  private readonly materialRefs = new Map<
    string,
    import('@pfc/domain').EvidenceRef
  >();
  private readonly materialImpacts = new Map<
    string,
    import('@pfc/domain').MaterialImpactAssessment
  >();
  private readonly timelineEvents: import('./repository-port.ts').SequencedTimelineEvent[] =
    [];
  private nextTimelineSequence = 1;
  private readonly detailReads = new Map<string, number>();
  private readonly questionReads = new Map<string, number>();

  constructor(
    seedWrites: readonly RequirementWrite[] = [],
    seedQuestions: readonly QuestionRecord[] = [],
    seedGateRuns: readonly GateRunRecord[] = [],
  ) {
    for (const write of seedWrites) {
      this.requirements.set(write.requirement.id, {
        requirement: write.requirement,
        currentBaseline: write.materialBaseline,
      });
      if (write.materialBaseline) {
        this.materialBaselines.set(
          write.materialBaseline.id,
          write.materialBaseline,
        );
      }
      for (const materialRef of write.materialRefs) {
        this.materialRefs.set(materialRef.id, materialRef);
      }
      this.appendTimeline(write.timelineEvent);
    }
    for (const record of seedQuestions) {
      this.questions.set(record.question.id, record);
    }
    for (const record of seedGateRuns) {
      this.gateRuns.set(record.gateRun.id, record);
    }
  }

  private appendTimeline(event: import('@pfc/domain').TimelineEvent): void {
    this.timelineEvents.push({
      sequence: this.nextTimelineSequence++,
      event,
    });
  }

  async listRequirementCandidates(input: {
    search: string;
    cursor: string | null;
    limit: number;
  }) {
    const start = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const query = input.search.trim().toLocaleLowerCase('zh-CN');
    const candidates = [...this.requirements.values()]
      .filter(({ requirement }) =>
        query
          ? requirement.name.toLocaleLowerCase('zh-CN').includes(query)
          : true,
      )
      .toSorted((left, right) => {
        const timeOrder = right.requirement.updatedAt.localeCompare(
          left.requirement.updatedAt,
        );
        return (
          timeOrder || left.requirement.id.localeCompare(right.requirement.id)
        );
      });
    const items = candidates
      .slice(start, start + input.limit)
      .map((record) => ({
        id: record.requirement.id,
        name: record.requirement.name,
        initiatorId: record.requirement.initiatorId,
        businessOwnerId: record.requirement.businessOwnerId,
        currentStage: record.requirement.currentStage,
        currentBaselineId: record.requirement.currentBaselineId,
        rowVersion: record.requirement.rowVersion,
        sensitivity:
          record.currentBaseline?.sensitivity ??
          record.requirement.draftRegistration?.sensitivity ??
          'RESTRICTED',
        updatedAt: record.requirement.updatedAt,
      }));
    const nextOffset = start + items.length;
    return {
      items,
      nextCursor: nextOffset < candidates.length ? String(nextOffset) : null,
    };
  }

  async findRequirementAccessMetadata(id: string) {
    const record = this.requirements.get(id);
    if (!record) return null;
    return {
      id,
      sensitivity:
        record.currentBaseline?.sensitivity ??
        record.requirement.draftRegistration?.sensitivity ??
        'RESTRICTED',
    };
  }

  async findRequirementRecordById(id: string) {
    this.detailReads.set(id, (this.detailReads.get(id) ?? 0) + 1);
    return this.requirements.get(id) ?? null;
  }

  async listMaterialBaselinesByRequirement(requirementId: string) {
    return [...this.materialBaselines.values()]
      .filter((baseline) => baseline.requirementId === requirementId)
      .toSorted((left, right) => right.versionNumber - left.versionNumber);
  }

  async listMaterialImpactsByRequirement(requirementId: string) {
    return [...this.materialImpacts.values()]
      .filter((impact) => impact.requirementId === requirementId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async findMaterialImpactById(requirementId: string, impactId: string) {
    const impact = this.materialImpacts.get(impactId);
    return impact?.requirementId === requirementId ? impact : null;
  }

  detailReadCount(id: string): number {
    return this.detailReads.get(id) ?? 0;
  }

  async listQuestionRecordsByRequirement(
    requirementId: string,
    baselineId: string,
  ) {
    return [...this.questions.values()]
      .filter(
        ({ question }) =>
          question.requirementId === requirementId &&
          question.baselineId === baselineId,
      )
      .toSorted((left, right) =>
        left.question.createdAt.localeCompare(right.question.createdAt),
      );
  }

  async findQuestionRecordById(requirementId: string, questionId: string) {
    this.questionReads.set(
      questionId,
      (this.questionReads.get(questionId) ?? 0) + 1,
    );
    const record = this.questions.get(questionId);
    return record?.question.requirementId === requirementId ? record : null;
  }

  questionReadCount(questionId: string): number {
    return this.questionReads.get(questionId) ?? 0;
  }

  materialRefCount(): number {
    return this.materialRefs.size;
  }

  async listMaterialRefsByBaseline(baselineId: string) {
    return [...this.materialRefs.values()].filter(
      (materialRef) => materialRef.baselineId === baselineId,
    );
  }

  async createRequirementIdempotently(
    command: IdempotentRequirementCommand,
  ): Promise<IdempotentCommandResult> {
    const key = idempotencyMapKey(command.idempotency);
    const existing = this.idempotency.get(key);
    if (existing) {
      return {
        status:
          existing.requestHash === command.idempotency.requestHash
            ? 'REPLAYED'
            : 'CONFLICT',
        resourceId: existing.resultReference ?? command.write.requirement.id,
      };
    }
    if (this.requirements.has(command.write.requirement.id)) {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Generated requirement identifier already exists.',
      );
    }
    this.requirements.set(command.write.requirement.id, {
      requirement: command.write.requirement,
      currentBaseline: command.write.materialBaseline,
    });
    if (command.write.materialBaseline) {
      this.materialBaselines.set(
        command.write.materialBaseline.id,
        command.write.materialBaseline,
      );
    }
    for (const materialRef of command.write.materialRefs) {
      this.materialRefs.set(materialRef.id, materialRef);
    }
    this.appendTimeline(command.write.timelineEvent);
    this.idempotency.set(key, command.idempotency);
    return {
      status: 'CREATED',
      resourceId: command.write.requirement.id,
    };
  }

  async completeG0RegistrationIdempotently(
    command: CompleteG0Command,
  ): Promise<IdempotentCommandResult> {
    const key = idempotencyMapKey(command.idempotency);
    const existingIdempotency = this.idempotency.get(key);
    if (existingIdempotency) {
      return {
        status:
          existingIdempotency.requestHash === command.idempotency.requestHash
            ? 'REPLAYED'
            : 'CONFLICT',
        resourceId:
          existingIdempotency.resultReference ?? command.write.requirement.id,
      };
    }
    const existing = this.requirements.get(command.write.requirement.id);
    if (!existing) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    if (existing.requirement.rowVersion !== command.previousRowVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Requirement row version does not match.',
        { currentVersion: existing.requirement.rowVersion },
      );
    }
    this.requirements.set(command.write.requirement.id, {
      requirement: command.write.requirement,
      currentBaseline: command.write.materialBaseline,
    });
    if (command.write.materialBaseline) {
      this.materialBaselines.set(
        command.write.materialBaseline.id,
        command.write.materialBaseline,
      );
    }
    for (const materialRef of command.write.materialRefs) {
      this.materialRefs.set(materialRef.id, materialRef);
    }
    this.appendTimeline(command.write.timelineEvent);
    this.idempotency.set(key, command.idempotency);
    return {
      status: 'CREATED',
      resourceId: command.write.requirement.id,
    };
  }

  async mutateQuestionIdempotently(
    command: IdempotentQuestionCommand,
  ): Promise<IdempotentCommandResult> {
    const key = idempotencyMapKey(command.idempotency);
    const existingIdempotency = this.idempotency.get(key);
    if (existingIdempotency) {
      return {
        status:
          existingIdempotency.requestHash === command.idempotency.requestHash
            ? 'REPLAYED'
            : 'CONFLICT',
        resourceId:
          existingIdempotency.resultReference ?? command.write.resultQuestionId,
      };
    }
    const existing = this.questions.get(command.write.previousQuestionId);
    if (
      !existing ||
      existing.question.requirementId !== command.write.requirementId
    ) {
      throw new DomainRuleViolation('NOT_FOUND', 'Question was not found.');
    }
    if (existing.question.rowVersion !== command.write.previousRowVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Question row version does not match.',
        { currentVersion: existing.question.rowVersion },
      );
    }
    if (
      command.write.decisionToUpdate &&
      !existing.decisions.some(
        (decision) => decision.id === command.write.decisionToUpdate?.id,
      )
    ) {
      throw new DomainRuleViolation('NOT_FOUND', 'Decision was not found.');
    }
    if (
      command.write.decisionToInsert &&
      existing.decisions.some(
        (decision) => decision.id === command.write.decisionToInsert?.id,
      )
    ) {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Decision identifier already exists.',
      );
    }
    if (
      command.write.newQuestion &&
      this.questions.has(command.write.newQuestion.question.id)
    ) {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Question identifier already exists.',
      );
    }

    let decisions = [...existing.decisions];
    if (command.write.decisionToUpdate) {
      decisions = decisions.map((decision) =>
        decision.id === command.write.decisionToUpdate?.id
          ? command.write.decisionToUpdate
          : decision,
      );
    }
    if (command.write.decisionToInsert) {
      decisions.push(command.write.decisionToInsert);
    }
    this.questions.set(command.write.previousQuestionId, {
      question: command.write.question,
      decisions,
    });
    if (command.write.newQuestion) {
      this.questions.set(
        command.write.newQuestion.question.id,
        command.write.newQuestion,
      );
    }
    this.appendTimeline(command.write.timelineEvent);
    this.idempotency.set(key, command.idempotency);
    return {
      status: 'CREATED',
      resourceId: command.write.resultQuestionId,
    };
  }

  async listGateRunRecordsByRequirement(requirementId: string) {
    return [...this.gateRuns.values()]
      .filter(({ gateRun }) => gateRun.requirementId === requirementId)
      .toSorted((left, right) =>
        right.gateRun.startedAt.localeCompare(left.gateRun.startedAt),
      );
  }

  async findGateRunRecordById(requirementId: string, gateRunId: string) {
    const record = this.gateRuns.get(gateRunId);
    return record?.gateRun.requirementId === requirementId ? record : null;
  }

  async startGateRunIdempotently(
    command: IdempotentGateRunStartCommand,
  ): Promise<GateRunStartResult> {
    const key = idempotencyMapKey(command.idempotency);
    const existingIdempotency = this.idempotency.get(key);
    if (existingIdempotency) {
      return {
        status:
          existingIdempotency.requestHash === command.idempotency.requestHash
            ? 'REPLAYED'
            : 'CONFLICT',
        resourceId:
          existingIdempotency.resultReference ?? command.write.gateRun.id,
      };
    }
    const requirement = this.requirements.get(command.write.requirementId);
    if (!requirement) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    if (
      requirement.requirement.rowVersion !==
      command.write.expectedRequirementRowVersion
    ) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Requirement row version does not match.',
        { currentVersion: requirement.requirement.rowVersion },
      );
    }
    if (
      requirement.requirement.currentBaselineId !==
        command.write.gateRun.baselineId ||
      requirement.requirement.currentStage !== command.write.gateRun.stage
    ) {
      throw new DomainRuleViolation(
        'INVALID_STATE_TRANSITION',
        'GateRun is not bound to the current stage and baseline.',
      );
    }
    const inProgress = [...this.gateRuns.values()].find(
      ({ gateRun }) =>
        gateRun.requirementId === command.write.gateRun.requirementId &&
        gateRun.baselineId === command.write.gateRun.baselineId &&
        gateRun.stage === command.write.gateRun.stage &&
        gateRun.status === 'IN_PROGRESS',
    );
    if (inProgress) {
      this.idempotency.set(key, {
        ...command.idempotency,
        resultReference: inProgress.gateRun.id,
      });
      return {
        status: 'REUSED_IN_PROGRESS',
        resourceId: inProgress.gateRun.id,
      };
    }
    if (this.gateRuns.has(command.write.gateRun.id)) {
      return {
        status: 'CONFLICT',
        resourceId: command.write.gateRun.id,
      };
    }
    this.gateRuns.set(command.write.gateRun.id, {
      gateRun: command.write.gateRun,
      checks: [],
      evidence: [],
      advancement: null,
    });
    this.appendTimeline(command.write.timelineEvent);
    this.idempotency.set(key, command.idempotency);
    return { status: 'CREATED', resourceId: command.write.gateRun.id };
  }

  async completeGateRun(command: CompleteGateRunCommand) {
    const existing = this.gateRuns.get(command.gateRunId);
    if (!existing || existing.gateRun.requirementId !== command.requirementId) {
      throw new DomainRuleViolation('NOT_FOUND', 'GateRun was not found.');
    }
    const requirement = this.requirements.get(command.requirementId);
    if (!requirement) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    const wasCompleted = existing.gateRun.status === 'COMPLETED';
    if (!wasCompleted) {
      assertGateCheckConsistency(command.result, command.checks);
      if (
        command.checks.some((check) => check.gateRunId !== command.gateRunId) ||
        command.evidence.some((item) => item.gateRunId !== command.gateRunId)
      ) {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'GateRun child records are bound to another run.',
        );
      }
    }
    const completed = applyGateResult({
      requirement: requirement.requirement,
      gateRun: existing.gateRun,
      result: command.result,
      completedAt: command.completedAt,
      existingAdvancement: existing.advancement,
      failureReason: command.failureReason,
      unknownReason: command.unknownReason,
    });
    const record: GateRunRecord = {
      gateRun: completed.gateRun,
      checks: wasCompleted ? existing.checks : command.checks,
      evidence: wasCompleted ? existing.evidence : command.evidence,
      advancement: completed.advancement,
    };
    this.gateRuns.set(command.gateRunId, record);
    this.requirements.set(command.requirementId, {
      ...requirement,
      requirement: completed.requirement,
    });
    if (!wasCompleted) {
      this.appendTimeline({
        id: command.gateTimelineEventId,
        requirementId: command.requirementId,
        aggregateType: 'gateRun',
        aggregateId: command.gateRunId,
        eventType: 'gate.completed',
        actorId: command.actorId,
        beforeSummary: { status: 'IN_PROGRESS' },
        afterSummary: { status: 'COMPLETED', result: command.result },
        aggregateVersion: completed.requirement.rowVersion,
        occurredAt: command.completedAt,
      });
      if (completed.advancement) {
        this.appendTimeline({
          id: command.advancementTimelineEventId,
          requirementId: command.requirementId,
          aggregateType: 'requirement',
          aggregateId: command.requirementId,
          eventType: 'requirement.advanced',
          actorId: command.actorId,
          beforeSummary: { stage: completed.advancement.fromStage },
          afterSummary: { stage: completed.advancement.toStage },
          aggregateVersion: completed.requirement.rowVersion,
          occurredAt: command.completedAt,
        });
      }
    }
    return {
      replayed: wasCompleted,
      gateRun: record,
      requirement: this.requirements.get(command.requirementId)!,
    };
  }

  async createMaterialImpactIdempotently(
    command: IdempotentMaterialImpactCommand<CreateMaterialImpactWrite>,
  ): Promise<IdempotentCommandResult> {
    const key = idempotencyMapKey(command.idempotency);
    const prior = this.idempotency.get(key);
    if (prior) {
      return {
        status:
          prior.requestHash === command.idempotency.requestHash
            ? 'REPLAYED'
            : 'CONFLICT',
        resourceId: prior.resultReference ?? command.write.assessment.id,
      };
    }
    const requirement = this.requirements.get(command.write.requirementId);
    if (!requirement) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    if (
      requirement.requirement.currentBaselineId !==
      command.write.expectedCurrentBaselineId
    ) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'The current baseline changed before impact registration.',
        { currentVersion: requirement.requirement.rowVersion },
      );
    }
    if (
      [...this.materialImpacts.values()].some(
        (impact) =>
          impact.requirementId === command.write.requirementId &&
          impact.status === 'PENDING',
      )
    ) {
      throw new DomainRuleViolation(
        'INVALID_STATE_TRANSITION',
        'A material impact is already pending.',
      );
    }
    this.materialBaselines.set(
      command.write.candidateBaseline.id,
      command.write.candidateBaseline,
    );
    this.materialImpacts.set(
      command.write.assessment.id,
      command.write.assessment,
    );
    this.appendTimeline(command.write.timelineEvent);
    this.idempotency.set(key, command.idempotency);
    return { status: 'CREATED', resourceId: command.write.assessment.id };
  }

  async confirmMaterialImpactIdempotently(
    command: IdempotentMaterialImpactCommand<ConfirmMaterialImpactWrite>,
  ): Promise<IdempotentCommandResult> {
    const key = idempotencyMapKey(command.idempotency);
    const prior = this.idempotency.get(key);
    if (prior) {
      return {
        status:
          prior.requestHash === command.idempotency.requestHash
            ? 'REPLAYED'
            : 'CONFLICT',
        resourceId: prior.resultReference ?? command.write.assessment.id,
      };
    }
    const current = this.requirements.get(command.write.requirement.id);
    const impact = this.materialImpacts.get(command.write.assessment.id);
    if (!current || !impact) {
      throw new DomainRuleViolation(
        'NOT_FOUND',
        'Material impact was not found.',
      );
    }
    if (current.requirement.rowVersion !== command.write.previousRowVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Requirement row version does not match.',
        { currentVersion: current.requirement.rowVersion },
      );
    }
    if (
      current.requirement.currentBaselineId !==
        command.write.previousBaseline.id ||
      impact.status !== 'PENDING'
    ) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Material impact is no longer pending on the current baseline.',
        { currentVersion: current.requirement.rowVersion },
      );
    }
    this.materialBaselines.set(
      command.write.previousBaseline.id,
      command.write.previousBaseline,
    );
    this.materialBaselines.set(
      command.write.currentBaseline.id,
      command.write.currentBaseline,
    );
    this.materialImpacts.set(
      command.write.assessment.id,
      command.write.assessment,
    );
    for (const gateRunId of command.write.invalidatedGateRunIds) {
      const run = this.gateRuns.get(gateRunId);
      if (run) {
        this.gateRuns.set(gateRunId, {
          ...run,
          gateRun: { ...run.gateRun, validity: 'INVALIDATED' },
        });
      }
    }
    this.requirements.set(command.write.requirement.id, {
      requirement: command.write.requirement,
      currentBaseline: command.write.currentBaseline,
    });
    this.appendTimeline(command.write.timelineEvent);
    this.idempotency.set(key, command.idempotency);
    return { status: 'CREATED', resourceId: command.write.assessment.id };
  }

  async listTimelineEvents(input: {
    requirementId: string;
    cursor: number | null;
    afterSequence: number | null;
    limit: number;
  }) {
    const matching = this.timelineEvents
      .filter(({ event, sequence }) => {
        if (event.requirementId !== input.requirementId) return false;
        if (input.afterSequence !== null) return sequence > input.afterSequence;
        if (input.cursor !== null) return sequence < input.cursor;
        return true;
      })
      .toSorted((left, right) =>
        input.afterSequence !== null
          ? left.sequence - right.sequence
          : right.sequence - left.sequence,
      );
    const items = matching.slice(0, input.limit);
    return {
      items,
      nextCursor:
        input.afterSequence === null && matching.length > items.length
          ? (items.at(-1)?.sequence ?? null)
          : null,
    };
  }

  async hasTimelineEvent(input: { requirementId: string; sequence: number }) {
    return this.timelineEvents.some(
      ({ sequence, event }) =>
        sequence === input.sequence &&
        event.requirementId === input.requirementId,
    );
  }

  async findIdempotencyRecord(input: {
    actorId: string;
    route: string;
    idempotencyKey: string;
  }) {
    return this.idempotency.get(idempotencyMapKey(input)) ?? null;
  }
}
