import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  AuthorizationPort,
  ConfirmMaterialImpactRequest,
  CreateMaterialImpactAssessmentRequest,
  MaterialImpactAssessmentDto,
  MaterialImpactMutationResponse,
} from '@pfc/contracts';
import {
  confirmMaterialImpact,
  createMaterialImpactAssessment,
  createOutboxEvent,
  DomainRuleViolation,
  type IdempotencyRecord,
  type TimelineEvent,
} from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type { RequirementRepositoryPort } from '../requirements/repository-port.ts';

type IdKind = 'baseline' | 'impact' | 'timeline' | 'outbox' | 'idempotency';
type IdFactory = (kind: IdKind) => string;

function defaultIdFactory(kind: IdKind): string {
  return `${kind.toUpperCase()}_${randomUUID()}`;
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toDto(
  assessment: import('@pfc/domain').MaterialImpactAssessment,
): MaterialImpactAssessmentDto {
  return { ...assessment };
}

function requirementSummary(
  requirement: import('@pfc/domain').Requirement,
): MaterialImpactMutationResponse['requirement'] {
  return {
    id: requirement.id,
    currentStage: requirement.currentStage,
    currentBaselineId: requirement.currentBaselineId,
    rowVersion: requirement.rowVersion,
  };
}

export class MaterialImpactApplicationService {
  private readonly authorization: RequirementAuthorizationService;
  private readonly repository: RequirementRepositoryPort;
  private readonly now: () => string;
  private readonly idFactory: IdFactory;

  constructor(input: {
    repository: RequirementRepositoryPort;
    authorizationPort: AuthorizationPort;
    now?: () => string;
    idFactory?: IdFactory;
  }) {
    this.repository = input.repository;
    this.authorization = new RequirementAuthorizationService(
      input.authorizationPort,
    );
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory = input.idFactory ?? defaultIdFactory;
  }

  async createAssessment(
    actor: ActorContext,
    requirementId: string,
    input: CreateMaterialImpactAssessmentRequest,
    idempotencyKey: string,
  ): Promise<MaterialImpactMutationResponse> {
    if (!actor.roles.includes('PRODUCT_MANAGER')) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Only a product manager can assess new material.',
      );
    }
    const route = `/api/v1/requirements/${requirementId}/material-impact-assessments`;
    const hash = requestHash(input);
    const metadata = await this.requireMetadata(requirementId);
    await this.requireAccess(
      actor,
      requirementId,
      'ASSESS_MATERIAL_IMPACT',
      metadata.sensitivity,
    );
    if (input.candidateBaseline.sensitivity !== metadata.sensitivity) {
      await this.requireAccess(
        actor,
        requirementId,
        'ASSESS_MATERIAL_IMPACT',
        input.candidateBaseline.sensitivity,
      );
    }
    const replay = await this.readReplay(
      actor,
      requirementId,
      route,
      idempotencyKey,
      hash,
    );
    if (replay) return replay;
    const [record, baselines] = await Promise.all([
      this.requireRequirement(requirementId),
      this.repository.listMaterialBaselinesByRequirement(requirementId),
    ]);
    if (!record.currentBaseline) {
      throw new DomainRuleViolation(
        'INVALID_STATE_TRANSITION',
        'Material impact requires a current baseline.',
      );
    }
    const now = this.now();
    const pending = createMaterialImpactAssessment({
      assessmentId: this.idFactory('impact'),
      candidateBaselineId: this.idFactory('baseline'),
      requirement: record.requirement,
      currentBaseline: record.currentBaseline,
      nextVersionNumber:
        Math.max(0, ...baselines.map((baseline) => baseline.versionNumber)) + 1,
      registration: {
        ...input.candidateBaseline,
        businessOwnerId: record.requirement.businessOwnerId,
      },
      recommendedStage: input.recommendedStage,
      actorId: actor.actorId,
      now,
    });
    const timelineEvent = this.timeline({
      requirementId,
      aggregateId: pending.assessment.id,
      eventType: 'material-impact.created',
      actorId: actor.actorId,
      beforeSummary: { currentBaselineId: record.currentBaseline.id },
      afterSummary: {
        impactId: pending.assessment.id,
        status: 'PENDING',
        currentBaselineId: record.currentBaseline.id,
        candidateBaselineId: pending.candidateBaseline.id,
      },
      aggregateVersion: record.requirement.rowVersion,
      occurredAt: now,
    });
    const result = await this.repository.createMaterialImpactIdempotently({
      write: {
        requirementId,
        expectedCurrentBaselineId: record.currentBaseline.id,
        candidateBaseline: pending.candidateBaseline,
        assessment: pending.assessment,
        timelineEvent,
        outboxEvent: createOutboxEvent({
          id: this.idFactory('outbox'),
          type: timelineEvent.eventType,
          aggregateType: timelineEvent.aggregateType,
          aggregateId: timelineEvent.aggregateId,
          aggregateVersion: timelineEvent.aggregateVersion,
          occurredAt: now,
          summary: timelineEvent.afterSummary,
        }),
      },
      idempotency: this.idempotency(
        actor.actorId,
        route,
        idempotencyKey,
        hash,
        pending.assessment.id,
        now,
      ),
    });
    this.throwIfConflict(result.status, result.resourceId);
    return this.readResponse(
      requirementId,
      result.resourceId,
      result.status === 'REPLAYED',
    );
  }

  async confirmAssessment(
    actor: ActorContext,
    requirementId: string,
    impactId: string,
    input: ConfirmMaterialImpactRequest,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<MaterialImpactMutationResponse> {
    const route = `/api/v1/requirements/${requirementId}/material-impact-assessments/${impactId}/confirmations`;
    const hash = requestHash({ input, expectedRowVersion });
    const metadata = await this.requireMetadata(requirementId);
    await this.requireAccess(
      actor,
      requirementId,
      'CONFIRM_MATERIAL_IMPACT',
      metadata.sensitivity,
    );
    const replay = await this.readReplay(
      actor,
      requirementId,
      route,
      idempotencyKey,
      hash,
    );
    if (replay) return replay;
    const [record, baselines, assessment, gateRuns] = await Promise.all([
      this.requireRequirement(requirementId),
      this.repository.listMaterialBaselinesByRequirement(requirementId),
      this.repository.findMaterialImpactById(requirementId, impactId),
      this.repository.listGateRunRecordsByRequirement(requirementId),
    ]);
    if (!record.currentBaseline || !assessment) {
      throw new DomainRuleViolation(
        'NOT_FOUND',
        'Material impact was not found.',
      );
    }
    const candidate = baselines.find(
      (baseline) => baseline.id === assessment.candidateBaselineId,
    );
    if (!candidate) {
      throw new DomainRuleViolation(
        'NOT_FOUND',
        'Candidate baseline was not found.',
      );
    }
    const now = this.now();
    const confirmed = confirmMaterialImpact({
      requirement: record.requirement,
      currentBaseline: record.currentBaseline,
      candidateBaseline: candidate,
      assessment,
      decision: input.decision,
      selectedStage: input.selectedStage ?? null,
      reason: input.reason,
      confirmedRole: input.confirmedRole,
      confirmedBy: actor.actorId,
      actorRoles: actor.roles,
      expectedRowVersion,
      gateRuns: gateRuns
        .filter(
          ({ gateRun }) =>
            gateRun.baselineId === record.currentBaseline!.id &&
            gateRun.validity === 'CURRENT',
        )
        .map(({ gateRun }) => ({
          id: gateRun.id,
          stage: gateRun.stage,
        })),
      now,
    });
    const timelineEvent = this.timeline({
      requirementId,
      aggregateId: impactId,
      eventType: 'baseline.switched',
      actorId: actor.actorId,
      beforeSummary: {
        baselineId: confirmed.previousBaseline.id,
        stage: record.requirement.currentStage,
      },
      afterSummary: {
        baselineId: confirmed.currentBaseline.id,
        stage: confirmed.requirement.currentStage,
        decision: input.decision,
        confirmedRole: input.confirmedRole,
        invalidatedCount: confirmed.invalidatedGateRunIds.length,
      },
      aggregateVersion: confirmed.requirement.rowVersion,
      occurredAt: now,
    });
    const result = await this.repository.confirmMaterialImpactIdempotently({
      write: {
        requirement: confirmed.requirement,
        previousRowVersion: expectedRowVersion,
        previousBaseline: confirmed.previousBaseline,
        currentBaseline: confirmed.currentBaseline,
        assessment: confirmed.assessment,
        invalidatedGateRunIds: confirmed.invalidatedGateRunIds,
        timelineEvent,
        outboxEvent: createOutboxEvent({
          id: this.idFactory('outbox'),
          type: timelineEvent.eventType,
          aggregateType: timelineEvent.aggregateType,
          aggregateId: timelineEvent.aggregateId,
          aggregateVersion: timelineEvent.aggregateVersion,
          occurredAt: now,
          summary: timelineEvent.afterSummary,
        }),
      },
      idempotency: this.idempotency(
        actor.actorId,
        route,
        idempotencyKey,
        hash,
        impactId,
        now,
      ),
    });
    this.throwIfConflict(result.status, result.resourceId);
    return this.readResponse(
      requirementId,
      result.resourceId,
      result.status === 'REPLAYED',
    );
  }

  private async requireMetadata(requirementId: string) {
    const metadata =
      await this.repository.findRequirementAccessMetadata(requirementId);
    if (!metadata)
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    return metadata;
  }

  private async requireRequirement(requirementId: string) {
    const record =
      await this.repository.findRequirementRecordById(requirementId);
    if (!record)
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    return record;
  }

  private async requireAccess(
    actor: ActorContext,
    requirementId: string,
    action: 'ASSESS_MATERIAL_IMPACT' | 'CONFIRM_MATERIAL_IMPACT',
    sensitivity: import('@pfc/contracts').SensitivityLevel,
  ): Promise<void> {
    const decision = await this.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity,
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'Material impact access was denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  private async readReplay(
    actor: ActorContext,
    requirementId: string,
    route: string,
    idempotencyKey: string,
    hash: string,
  ): Promise<MaterialImpactMutationResponse | null> {
    const prior = await this.repository.findIdempotencyRecord({
      actorId: actor.actorId,
      route,
      idempotencyKey,
    });
    if (!prior) return null;
    if (prior.requestHash !== hash) {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for another request.',
        { existingResourceId: prior.resultReference ?? undefined },
      );
    }
    if (!prior.resultReference) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Impact result is unknown.',
      );
    }
    return this.readResponse(requirementId, prior.resultReference, true);
  }

  private async readResponse(
    requirementId: string,
    impactId: string,
    replayed: boolean,
  ): Promise<MaterialImpactMutationResponse> {
    const [record, assessment] = await Promise.all([
      this.requireRequirement(requirementId),
      this.repository.findMaterialImpactById(requirementId, impactId),
    ]);
    if (!assessment) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Impact result is unknown.',
      );
    }
    return {
      replayed,
      requirement: requirementSummary(record.requirement),
      assessment: toDto(assessment),
    };
  }

  private throwIfConflict(status: string, resourceId: string): void {
    if (status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for another request.',
        { existingResourceId: resourceId },
      );
    }
  }

  private idempotency(
    actorId: string,
    route: string,
    idempotencyKey: string,
    hash: string,
    resourceId: string,
    now: string,
  ): IdempotencyRecord {
    return {
      id: this.idFactory('idempotency'),
      actorId,
      route,
      idempotencyKey,
      requestHash: hash,
      resultReference: resourceId,
      responseSummary: { status: 'CREATED' },
      createdAt: now,
    };
  }

  private timeline(
    input: Omit<TimelineEvent, 'id' | 'aggregateType'>,
  ): TimelineEvent {
    return {
      id: this.idFactory('timeline'),
      aggregateType: 'materialImpact',
      ...input,
    };
  }
}
