import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  ArtifactEvidencePort,
  AuthorizationPort,
  GateExecutionPort,
  GateResult,
  GateRunMutationResponse,
  GateRunResult,
  LifecycleStage,
  RegisterManualGateRunRequest,
  RequirementAction,
  StartAutomaticGateRunRequest,
} from '@pfc/contracts';
import {
  assertGateCheckConsistency,
  createGateRun,
  createOutboxEvent,
  DomainRuleViolation,
  type GateCheck,
  type GateRun,
  type GateRunEvidence,
  type IdempotencyRecord,
  type TimelineEvent,
} from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type {
  CompleteGateRunResult,
  GateRunRecord,
  RequirementRecord,
  RequirementRepositoryPort,
} from '../requirements/repository-port.ts';

type IdKind = 'gateRun' | 'gateCheck' | 'timeline' | 'outbox' | 'idempotency';
type IdFactory = (kind: IdKind) => string;

const lifecycleStages: readonly LifecycleStage[] = [
  'G0',
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G6',
  'G7',
  'G8',
  'G9',
  'G10',
  'G11',
  'G12',
];

function defaultIdFactory(kind: IdKind): string {
  return `${kind.toUpperCase()}_${randomUUID()}`;
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nonBlank(value: string, field: string, maximum = 2_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      `${field} is required and must not exceed ${maximum} characters.`,
      { field, maximum },
    );
  }
  return normalized;
}

function toGateRunDto(record: GateRunRecord) {
  return {
    ...record.gateRun,
    checks: record.checks.map((check) => ({
      id: check.id,
      checkKey: check.checkKey,
      result: check.result,
      reason: check.reason,
      ownerId: check.ownerId,
      closePoint: check.closePoint,
    })),
    evidence: record.evidence.map((item) => ({
      evidenceRefId: item.evidenceRefId,
      accessDecision: item.accessDecision,
      actionAuthorizationRef: item.actionAuthorizationRef,
    })),
    advancement: record.advancement
      ? {
          id: record.advancement.id,
          fromStage: record.advancement.fromStage,
          toStage: record.advancement.toStage,
          advancedAt: record.advancement.advancedAt,
        }
      : null,
  };
}

function response(
  gateRun: GateRunRecord,
  requirement: RequirementRecord,
  input: { replayed: boolean; reusedInProgress: boolean },
): GateRunMutationResponse {
  return {
    ...input,
    gateRun: toGateRunDto(gateRun),
    requirement: {
      id: requirement.requirement.id,
      currentStage: requirement.requirement.currentStage,
      currentBaselineId: requirement.requirement.currentBaselineId,
      rowVersion: requirement.requirement.rowVersion,
    },
  };
}

function stageHasReached(current: LifecycleStage, closeBy: LifecycleStage) {
  return lifecycleStages.indexOf(current) >= lifecycleStages.indexOf(closeBy);
}

export class GateRunApplicationService {
  private readonly authorization: RequirementAuthorizationService;
  private readonly repository: RequirementRepositoryPort;
  private readonly artifactEvidencePort: ArtifactEvidencePort;
  private readonly gateExecutionPort: GateExecutionPort;
  private readonly now: () => string;
  private readonly idFactory: IdFactory;

  constructor(input: {
    repository: RequirementRepositoryPort;
    authorizationPort: AuthorizationPort;
    artifactEvidencePort: ArtifactEvidencePort;
    gateExecutionPort: GateExecutionPort;
    now?: () => string;
    idFactory?: IdFactory;
  }) {
    this.repository = input.repository;
    this.authorization = new RequirementAuthorizationService(
      input.authorizationPort,
    );
    this.artifactEvidencePort = input.artifactEvidencePort;
    this.gateExecutionPort = input.gateExecutionPort;
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory = input.idFactory ?? defaultIdFactory;
  }

  private route(requirementId: string, mode: 'automatic' | 'manual') {
    return `/api/v1/requirements/${requirementId}/gate-runs/${mode}`;
  }

  private async authorize(
    actor: ActorContext,
    requirementId: string,
    action: RequirementAction,
    materialRefIds: readonly string[] = [],
    sensitivity?: 'INTERNAL' | 'RESTRICTED' | 'PUBLIC',
  ) {
    const metadata =
      await this.repository.findRequirementAccessMetadata(requirementId);
    if (!metadata) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    const decision = await this.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity: sensitivity ?? metadata.sensitivity,
      materialRefIds,
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'GateRun action access was denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  private async boundRequirement(
    requirementId: string,
    body: StartAutomaticGateRunRequest,
    expectedRowVersion: number,
  ) {
    const record =
      await this.repository.findRequirementRecordById(requirementId);
    if (!record) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    if (record.requirement.rowVersion !== expectedRowVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Requirement row version does not match.',
        { currentVersion: record.requirement.rowVersion },
      );
    }
    if (
      record.requirement.currentBaselineId !== body.baselineId ||
      record.requirement.currentStage !== body.stage
    ) {
      throw new DomainRuleViolation(
        'INVALID_STATE_TRANSITION',
        'GateRun is not bound to the current stage and baseline.',
      );
    }
    return record;
  }

  private idempotency(input: {
    actorId: string;
    route: string;
    key: string;
    hash: string;
    gateRunId: string;
    now: string;
  }): IdempotencyRecord {
    return {
      id: this.idFactory('idempotency'),
      actorId: input.actorId,
      route: input.route,
      idempotencyKey: nonBlank(input.key, 'idempotencyKey', 200),
      requestHash: input.hash,
      resultReference: input.gateRunId,
      responseSummary: { gateRunId: input.gateRunId },
      createdAt: input.now,
    };
  }

  private startEvents(
    requirementId: string,
    gateRun: GateRun,
    actorId: string,
  ): {
    timelineEvent: TimelineEvent;
    outboxEvent: ReturnType<typeof createOutboxEvent>;
  } {
    const summary = {
      gateRunId: gateRun.id,
      stage: gateRun.stage,
      mode: gateRun.mode,
      status: gateRun.status,
    };
    return {
      timelineEvent: {
        id: this.idFactory('timeline'),
        requirementId,
        aggregateType: 'gateRun',
        aggregateId: gateRun.id,
        eventType: 'gateRun.started',
        actorId,
        beforeSummary: null,
        afterSummary: summary,
        aggregateVersion: 0,
        occurredAt: gateRun.startedAt,
      },
      outboxEvent: createOutboxEvent({
        id: this.idFactory('outbox'),
        type: 'gateRun.started',
        aggregateType: 'gateRun',
        aggregateId: gateRun.id,
        aggregateVersion: 0,
        occurredAt: gateRun.startedAt,
        summary,
      }),
    };
  }

  private async replay(
    actor: ActorContext,
    requirementId: string,
    route: string,
    idempotencyKey: string,
    hash: string,
  ): Promise<GateRunMutationResponse | null> {
    const existing = await this.repository.findIdempotencyRecord({
      actorId: actor.actorId,
      route,
      idempotencyKey,
    });
    if (!existing) return null;
    if (existing.requestHash !== hash) {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for another GateRun request.',
        { existingResourceId: existing.resultReference },
      );
    }
    if (!existing.resultReference) {
      throw new DomainRuleViolation('RESULT_UNKNOWN', 'GateRun is unknown.');
    }
    const [gateRun, requirement] = await Promise.all([
      this.repository.findGateRunRecordById(
        requirementId,
        existing.resultReference,
      ),
      this.repository.findRequirementRecordById(requirementId),
    ]);
    if (!gateRun || !requirement) {
      throw new DomainRuleViolation('RESULT_UNKNOWN', 'GateRun is unknown.');
    }
    return response(gateRun, requirement, {
      replayed: true,
      reusedInProgress: false,
    });
  }

  private check(
    gateRunId: string,
    input: {
      checkKey: string;
      result: GateResult;
      reason?: string | null;
      ownerId?: string | null;
      closePoint?: string | null;
    },
    now: string,
  ): GateCheck {
    return {
      id: this.idFactory('gateCheck'),
      gateRunId,
      checkKey: nonBlank(input.checkKey, 'checkKey', 160),
      result: input.result,
      reason: input.reason?.trim() || null,
      ownerId: input.ownerId?.trim() || null,
      closePoint: input.closePoint?.trim() || null,
      createdAt: now,
    };
  }

  private async complete(
    actorId: string,
    requirementId: string,
    gateRunId: string,
    result: GateRunResult,
    checks: readonly GateCheck[],
    evidence: readonly GateRunEvidence[] = [],
    unknownReason?: string,
  ): Promise<CompleteGateRunResult> {
    return this.repository.completeGateRun({
      requirementId,
      gateRunId,
      result,
      checks,
      evidence,
      completedAt: this.now(),
      unknownReason,
      actorId,
      gateTimelineEventId: this.idFactory('timeline'),
      gateOutboxEventId: this.idFactory('outbox'),
      advancementTimelineEventId: this.idFactory('timeline'),
      advancementOutboxEventId: this.idFactory('outbox'),
    });
  }

  private async start(input: {
    actor: ActorContext;
    requirement: RequirementRecord;
    body: StartAutomaticGateRunRequest;
    expectedRowVersion: number;
    idempotencyKey: string;
    hash: string;
    route: string;
    mode: 'AUTOMATIC' | 'MANUAL';
    confirmedRole?: RegisterManualGateRunRequest['confirmedRole'];
    registrationNote?: string;
  }) {
    const now = this.now();
    const gateRun = createGateRun({
      id: this.idFactory('gateRun'),
      requirementId: input.requirement.requirement.id,
      baselineId: input.body.baselineId,
      stage: input.body.stage,
      mode: input.mode,
      ownerId: input.actor.actorId,
      confirmedRole: input.confirmedRole,
      confirmedBy: input.mode === 'MANUAL' ? input.actor.actorId : undefined,
      registrationNote: input.registrationNote,
      now,
    });
    const result = await this.repository.startGateRunIdempotently({
      write: {
        requirementId: input.requirement.requirement.id,
        expectedRequirementRowVersion: input.expectedRowVersion,
        gateRun,
        ...this.startEvents(
          input.requirement.requirement.id,
          gateRun,
          input.actor.actorId,
        ),
      },
      idempotency: this.idempotency({
        actorId: input.actor.actorId,
        route: input.route,
        key: input.idempotencyKey,
        hash: input.hash,
        gateRunId: gateRun.id,
        now,
      }),
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for another GateRun request.',
        { existingResourceId: result.resourceId },
      );
    }
    const saved = await this.repository.findGateRunRecordById(
      input.requirement.requirement.id,
      result.resourceId,
    );
    if (!saved) {
      throw new DomainRuleViolation('RESULT_UNKNOWN', 'GateRun is unknown.');
    }
    return { result, saved };
  }

  async startAutomaticGateRun(
    actor: ActorContext,
    requirementId: string,
    body: StartAutomaticGateRunRequest,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<GateRunMutationResponse> {
    await this.authorize(actor, requirementId, 'RUN_GATE');
    const route = this.route(requirementId, 'automatic');
    const hash = requestHash({ body, expectedRowVersion });
    const replay = await this.replay(
      actor,
      requirementId,
      route,
      idempotencyKey,
      hash,
    );
    if (replay) return replay;
    const requirement = await this.boundRequirement(
      requirementId,
      body,
      expectedRowVersion,
    );
    let capability;
    try {
      capability = await this.gateExecutionPort.getGateExecutionCapability({
        actorId: actor.actorId,
        requirementId,
        baselineId: body.baselineId,
        stage: body.stage,
      });
    } catch {
      throw new DomainRuleViolation(
        'DEPENDENCY_UNAVAILABLE',
        'Automatic gate execution capability is unavailable.',
      );
    }
    if (capability.status !== 'AVAILABLE') {
      throw new DomainRuleViolation(
        'DEPENDENCY_UNAVAILABLE',
        'Automatic gate execution capability is unavailable.',
        { reasonCode: capability.reasonCode },
      );
    }

    const { result: startResult, saved } = await this.start({
      actor,
      requirement,
      body,
      expectedRowVersion,
      idempotencyKey,
      hash,
      route,
      mode: 'AUTOMATIC',
    });
    if (startResult.status !== 'CREATED') {
      const currentRequirement =
        await this.repository.findRequirementRecordById(requirementId);
      if (!currentRequirement) {
        throw new DomainRuleViolation(
          'RESULT_UNKNOWN',
          'Requirement is unknown.',
        );
      }
      return response(saved, currentRequirement, {
        replayed: startResult.status === 'REPLAYED',
        reusedInProgress: startResult.status === 'REUSED_IN_PROGRESS',
      });
    }

    const questions = await this.repository.listQuestionRecordsByRequirement(
      requirementId,
      body.baselineId,
    );
    const blockers = questions.filter(
      ({ question }) =>
        (question.status === 'OPEN' || question.status === 'ANSWERED') &&
        stageHasReached(body.stage, question.closeByStage),
    );
    if (blockers.length > 0) {
      const completed = await this.complete(
        actor.actorId,
        requirementId,
        saved.gateRun.id,
        'BLOCK',
        blockers.map(({ question }) =>
          this.check(
            saved.gateRun.id,
            {
              checkKey: `question.${question.id}`,
              result: 'BLOCK',
              reason: 'Question requires a confirmed decision.',
              ownerId: question.ownerId,
              closePoint: question.closeByStage,
            },
            this.now(),
          ),
        ),
      );
      return response(completed.gateRun, completed.requirement, {
        replayed: completed.replayed,
        reusedInProgress: false,
      });
    }

    let execution;
    try {
      execution = await this.gateExecutionPort.executeGate({
        actorId: actor.actorId,
        requirementId,
        baselineId: body.baselineId,
        stage: body.stage,
        idempotencyKey,
      });
    } catch {
      execution = {
        status: 'UNKNOWN' as const,
        reasonCode: 'GATE_EXECUTION_ERROR',
      };
    }
    if (
      execution.status === 'AVAILABLE' &&
      (execution.data.status === 'ACCEPTED' ||
        execution.data.status === 'RUNNING')
    ) {
      return response(saved, requirement, {
        replayed: false,
        reusedInProgress: false,
      });
    }
    const result =
      execution.status === 'AVAILABLE' &&
      execution.data.status === 'COMPLETED' &&
      execution.data.result
        ? execution.data.result
        : 'UNKNOWN';
    const unknownReason =
      result === 'UNKNOWN'
        ? execution.status === 'AVAILABLE'
          ? 'EXECUTION_RESULT_UNKNOWN'
          : execution.reasonCode
        : undefined;
    const completed = await this.complete(
      actor.actorId,
      requirementId,
      saved.gateRun.id,
      result,
      [
        this.check(
          saved.gateRun.id,
          {
            checkKey: 'automatic.aggregate',
            result,
            reason: unknownReason,
            ownerId: actor.actorId,
            closePoint: body.stage,
          },
          this.now(),
        ),
      ],
      [],
      unknownReason,
    );
    return response(completed.gateRun, completed.requirement, {
      replayed: completed.replayed,
      reusedInProgress: false,
    });
  }

  async registerManualGateRun(
    actor: ActorContext,
    requirementId: string,
    body: RegisterManualGateRunRequest,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<GateRunMutationResponse> {
    await this.authorize(actor, requirementId, 'REGISTER_MANUAL_GATE');
    const route = this.route(requirementId, 'manual');
    const hash = requestHash({ body, expectedRowVersion });
    const replay = await this.replay(
      actor,
      requirementId,
      route,
      idempotencyKey,
      hash,
    );
    const resumesFailedCompletion = replay?.gateRun.status === 'IN_PROGRESS';
    if (replay && !resumesFailedCompletion) return replay;
    const requirement = await this.boundRequirement(
      requirementId,
      body,
      expectedRowVersion,
    );
    if (!actor.roles.includes(body.confirmedRole)) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Actor does not hold the selected GateRun confirmation role.',
      );
    }
    const evidenceIds = [
      ...new Set(body.evidenceRefIds.map((id) => id.trim())),
    ];
    if (
      evidenceIds.length === 0 ||
      evidenceIds.some((id) => !id) ||
      evidenceIds.length !== body.evidenceRefIds.length
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Manual GateRun evidence references must be non-empty and unique.',
      );
    }
    let evidenceResult;
    try {
      evidenceResult = await this.artifactEvidencePort.listEvidence({
        actorId: actor.actorId,
        requirementId,
        baselineId: body.baselineId,
        evidenceRefIds: evidenceIds,
      });
    } catch {
      throw new DomainRuleViolation(
        'DEPENDENCY_UNAVAILABLE',
        'Evidence capability is unavailable.',
      );
    }
    if (evidenceResult.status !== 'AVAILABLE') {
      throw new DomainRuleViolation(
        'DEPENDENCY_UNAVAILABLE',
        'Evidence capability is unavailable.',
        { reasonCode: evidenceResult.reasonCode },
      );
    }
    const returnedEvidenceIds = evidenceResult.data.map(
      (item) => item.evidenceRefId,
    );
    const returnedEvidenceSet = new Set(returnedEvidenceIds);
    if (
      evidenceResult.data.length !== evidenceIds.length ||
      returnedEvidenceSet.size !== returnedEvidenceIds.length ||
      evidenceIds.some((id) => !returnedEvidenceSet.has(id)) ||
      evidenceResult.data.some(
        (item) =>
          !evidenceIds.includes(item.evidenceRefId) ||
          item.baselineId !== body.baselineId ||
          item.validity !== 'VALID',
      )
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Evidence must be valid and belong to the current baseline.',
      );
    }
    for (const item of evidenceResult.data) {
      await this.authorize(
        actor,
        requirementId,
        'REGISTER_MANUAL_GATE',
        [item.evidenceRefId],
        item.sensitivity,
      );
    }

    const { result: startResult, saved } = await this.start({
      actor,
      requirement,
      body,
      expectedRowVersion,
      idempotencyKey,
      hash,
      route,
      mode: 'MANUAL',
      confirmedRole: body.confirmedRole,
      registrationNote: body.registrationNote,
    });
    if (startResult.status !== 'CREATED' && !resumesFailedCompletion) {
      const currentRequirement =
        await this.repository.findRequirementRecordById(requirementId);
      if (!currentRequirement) {
        throw new DomainRuleViolation(
          'RESULT_UNKNOWN',
          'Requirement is unknown.',
        );
      }
      return response(saved, currentRequirement, {
        replayed: startResult.status === 'REPLAYED',
        reusedInProgress: startResult.status === 'REUSED_IN_PROGRESS',
      });
    }
    const now = this.now();
    const checks = body.checks.map((item) =>
      this.check(saved.gateRun.id, item, now),
    );
    assertGateCheckConsistency(body.result, checks);
    const evidence: GateRunEvidence[] = evidenceResult.data.map((item) => ({
      gateRunId: saved.gateRun.id,
      evidenceRefId: item.evidenceRefId,
      accessDecision: 'ALLOWED',
      actionAuthorizationRef: null,
      createdAt: now,
    }));
    const completed = await this.complete(
      actor.actorId,
      requirementId,
      saved.gateRun.id,
      body.result,
      checks,
      evidence,
    );
    return response(completed.gateRun, completed.requirement, {
      replayed: resumesFailedCompletion || completed.replayed,
      reusedInProgress: false,
    });
  }

  async getGateRun(
    actor: ActorContext,
    requirementId: string,
    gateRunId: string,
  ): Promise<GateRunMutationResponse> {
    await this.authorize(actor, requirementId, 'VIEW_REQUIREMENT');
    const [gateRun, requirement] = await Promise.all([
      this.repository.findGateRunRecordById(requirementId, gateRunId),
      this.repository.findRequirementRecordById(requirementId),
    ]);
    if (!gateRun || !requirement) {
      throw new DomainRuleViolation('NOT_FOUND', 'GateRun was not found.');
    }
    return response(gateRun, requirement, {
      replayed: false,
      reusedInProgress: false,
    });
  }
}
