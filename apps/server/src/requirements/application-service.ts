import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  AuthorizationPort,
  CapabilityStatus,
  CreateRequirementRequest,
  DeliverySummaryPort,
  GateExecutionCapabilityDto,
  GateExecutionPort,
  GateProjection,
  GateRunDto,
  G0RegistrationDto,
  RequirementDetailDto,
  RequirementListResponse,
  RequirementListScope,
  RequirementMutationResponse,
  RequirementSubmissionResponse,
  QuestionDto,
} from '@pfc/contracts';
import {
  completeG0Registration,
  createInitialMaterialRef,
  createOutboxEvent,
  createRequirementDraft,
  DomainRuleViolation,
  evaluateG0Registration,
  type IdempotencyRecord,
  type Requirement,
  type MaterialBaseline,
  type MaterialImpactAssessment,
  type TimelineEvent,
} from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type {
  GateRunRecord,
  RequirementRecord,
  RequirementRepositoryPort,
  RequirementWrite,
  QuestionRecord,
} from './repository-port.ts';

type IdKind =
  | 'requirement'
  | 'baseline'
  | 'material'
  | 'timeline'
  | 'outbox'
  | 'idempotency';

type IdFactory = (kind: IdKind) => string;

const createRoute = '/api/v1/requirements';

function defaultIdFactory(kind: IdKind): string {
  return `${kind.toUpperCase()}_${randomUUID()}`;
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function exactContentHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const uncheckedGateExecution: GateExecutionCapabilityDto = {
  status: 'UNAVAILABLE',
  capabilityVersion: 'not-checked/v1',
  checkedAt: '1970-01-01T00:00:00.000Z',
  reasonCode: 'GATE_EXECUTION_NOT_CHECKED',
};

function toGateRunDto(record: GateRunRecord): GateRunDto {
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

function currentGateRun(
  requirement: Pick<Requirement, 'currentBaselineId' | 'currentStage'>,
  records: readonly GateRunRecord[],
): GateRunRecord | null {
  return (
    records.find(
      ({ gateRun }) =>
        gateRun.baselineId === requirement.currentBaselineId &&
        gateRun.stage === requirement.currentStage &&
        gateRun.validity === 'CURRENT',
    ) ??
    records.find(
      ({ gateRun }) =>
        gateRun.stage === requirement.currentStage &&
        gateRun.validity === 'CURRENT',
    ) ??
    null
  );
}

function toBaselineDto(baseline: MaterialBaseline) {
  return {
    id: baseline.id,
    versionNumber: baseline.versionNumber,
    sourceType: baseline.sourceType,
    sourceDescription: baseline.sourceDescription,
    materialPurpose: baseline.materialPurpose,
    sensitivity: baseline.sensitivity,
    confirmedBy: baseline.confirmedBy,
    confirmedAt: baseline.confirmedAt,
  };
}

function toMaterialImpactDto(impact: MaterialImpactAssessment) {
  return { ...impact };
}

function gateProjection(
  requirement: Pick<Requirement, 'currentBaselineId' | 'currentStage'>,
  records: readonly GateRunRecord[] = [],
): GateProjection {
  if (!requirement.currentBaselineId) return 'BLOCK';
  const current = currentGateRun(requirement, records)?.gateRun;
  if (!current) return 'NOT_STARTED';
  if (current.status === 'IN_PROGRESS') return 'PROCESSING';
  if (current.result === 'BLOCK') return 'BLOCK';
  if (current.result === 'WARN') return 'WARN';
  if (current.result === 'UNKNOWN') return 'UNKNOWN';
  return 'NOT_STARTED';
}

function nextAction(projection: GateProjection): string {
  switch (projection) {
    case 'BLOCK':
      return '处理门禁阻断';
    case 'PROCESSING':
      return '查看门禁运行';
    case 'WARN':
      return '处理门禁警告';
    case 'UNKNOWN':
      return '刷新门禁结果';
    default:
      return '运行当前门禁';
  }
}

function toQuestionDtos(records: readonly QuestionRecord[]): QuestionDto[] {
  return records.map((record) => {
    const currentDecisionId = record.question.currentDecisionId;
    const replacingRecord = currentDecisionId
      ? records.find((candidate) =>
          candidate.decisions.some(
            (decision) => decision.supersedesDecisionId === currentDecisionId,
          ),
        )
      : undefined;
    return {
      ...record.question,
      supersededByQuestionId: replacingRecord?.question.id ?? null,
      decisions: record.decisions.toSorted(
        (left, right) => left.versionNumber - right.versionNumber,
      ),
    };
  });
}

function toDetail(
  record: RequirementRecord,
  questionRecords: readonly QuestionRecord[] = [],
  gateRunRecords: readonly GateRunRecord[] = [],
  gateExecution: GateExecutionCapabilityDto = uncheckedGateExecution,
  materialBaselines: readonly MaterialBaseline[] = record.currentBaseline
    ? [record.currentBaseline]
    : [],
  materialImpacts: readonly MaterialImpactAssessment[] = [],
): RequirementDetailDto {
  const registration = record.requirement.draftRegistration ?? {};
  const current = currentGateRun(record.requirement, gateRunRecords);
  return {
    id: record.requirement.id,
    name: record.requirement.name,
    originalIdea: record.requirement.originalIdea,
    initiatorId: record.requirement.initiatorId,
    businessOwnerId: record.requirement.businessOwnerId,
    currentStage: record.requirement.currentStage,
    rowVersion: record.requirement.rowVersion,
    registration,
    missingFields: evaluateG0Registration(registration).missingFields,
    gateProjection: gateProjection(record.requirement, gateRunRecords),
    currentBaseline: record.currentBaseline
      ? toBaselineDto(record.currentBaseline)
      : null,
    materialBaselines: materialBaselines.map(toBaselineDto),
    materialImpacts: materialImpacts.map(toMaterialImpactDto),
    questions: toQuestionDtos(questionRecords),
    currentGateRun: current ? toGateRunDto(current) : null,
    gateRuns: gateRunRecords.map(toGateRunDto),
    gateExecution,
    createdAt: record.requirement.createdAt,
    updatedAt: record.requirement.updatedAt,
  };
}

function assertCreatePermission(actor: ActorContext): void {
  if (
    actor.authenticationStatus !== 'AUTHENTICATED' ||
    !actor.roles.includes('PRODUCT_MANAGER') ||
    actor.teamIds.length === 0
  ) {
    throw new DomainRuleViolation(
      'PERMISSION_DENIED',
      'Current actor cannot create a requirement.',
    );
  }
}

export class RequirementApplicationService {
  private readonly authorization: RequirementAuthorizationService;
  private readonly repository: RequirementRepositoryPort;
  private readonly deliverySummaryPort: DeliverySummaryPort;
  private readonly gateExecutionPort: GateExecutionPort;
  private readonly now: () => string;
  private readonly idFactory: IdFactory;

  constructor(input: {
    repository: RequirementRepositoryPort;
    authorizationPort: AuthorizationPort;
    deliverySummaryPort: DeliverySummaryPort;
    gateExecutionPort?: GateExecutionPort;
    now?: () => string;
    idFactory?: IdFactory;
  }) {
    this.repository = input.repository;
    this.authorization = new RequirementAuthorizationService(
      input.authorizationPort,
    );
    this.deliverySummaryPort = input.deliverySummaryPort;
    this.now = input.now ?? (() => new Date().toISOString());
    this.gateExecutionPort =
      input.gateExecutionPort ??
      ({
        getGateExecutionCapability: async () => ({
          status: 'UNAVAILABLE',
          source: 'UNAVAILABLE',
          capabilityVersion: 'unconfigured/v1',
          checkedAt: this.now(),
          reasonCode: 'CAPABILITY_NOT_CONFIGURED',
        }),
        executeGate: async () => ({
          status: 'UNAVAILABLE',
          source: 'UNAVAILABLE',
          capabilityVersion: 'unconfigured/v1',
          checkedAt: this.now(),
          reasonCode: 'CAPABILITY_NOT_CONFIGURED',
        }),
      } satisfies GateExecutionPort);
    this.idFactory = input.idFactory ?? defaultIdFactory;
  }

  async listRequirements(
    actor: ActorContext,
    query: {
      scope: RequirementListScope;
      search: string;
      cursor: string | null;
      limit: number;
    },
  ): Promise<RequirementListResponse> {
    const page = await this.repository.listRequirementCandidates(query);
    const authorized = await Promise.all(
      page.items.map(async (item) => {
        if (
          query.scope === 'MINE' &&
          item.initiatorId !== actor.actorId &&
          item.businessOwnerId !== actor.actorId
        ) {
          return null;
        }
        const decision = await this.authorization.authorize(actor, {
          requirementId: item.id,
          action: 'VIEW_REQUIREMENT',
          sensitivity: item.sensitivity,
          materialRefIds: [],
          requestedAt: this.now(),
        });
        if (decision.decision !== 'ALLOW') return null;

        let dependencyStatus: CapabilityStatus = 'AVAILABLE';
        let warningCode: string | null = null;
        if (item.currentBaselineId) {
          const summary = await this.deliverySummaryPort.getDeliverySummary({
            actorId: actor.actorId,
            requirementId: item.id,
            baselineId: item.currentBaselineId,
            stage: item.currentStage,
          });
          dependencyStatus = summary.status;
          warningCode =
            summary.status === 'AVAILABLE'
              ? null
              : `DELIVERY_SUMMARY_${summary.status}`;
        }
        const gateRuns = item.currentBaselineId
          ? await this.repository.listGateRunRecordsByRequirement(item.id)
          : [];
        const projection = gateProjection(item, gateRuns);
        if (
          query.scope === 'BLOCKED' &&
          !['BLOCK', 'WARN', 'UNKNOWN'].includes(projection)
        ) {
          return null;
        }
        return {
          id: item.id,
          name: item.name,
          currentStage: item.currentStage,
          gateProjection: projection,
          ownerId: item.businessOwnerId ?? item.initiatorId,
          nextAction: item.currentBaselineId
            ? nextAction(projection)
            : '补齐 G0 登记',
          updatedAt: item.updatedAt,
          dependencyStatus,
          warningCode,
        };
      }),
    );
    const items = authorized.filter((item) => item !== null);
    return {
      items,
      nextCursor: page.nextCursor,
      partial: items.some((item) => item.warningCode !== null),
      checkedAt: this.now(),
    };
  }

  async getRequirement(
    actor: ActorContext,
    requirementId: string,
  ): Promise<RequirementDetailDto> {
    const metadata =
      await this.repository.findRequirementAccessMetadata(requirementId);
    if (!metadata) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    const decision = await this.authorization.authorize(actor, {
      requirementId,
      action: 'VIEW_REQUIREMENT',
      sensitivity: metadata.sensitivity,
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'Requirement access was denied.',
        { reasonCode: decision.reasonCode },
      );
    }
    const record =
      await this.repository.findRequirementRecordById(requirementId);
    if (!record) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    const [questions, gateRuns, gateCapability, materialBaselines, impacts] =
      record.currentBaseline
        ? await Promise.all([
            this.repository.listQuestionRecordsByRequirement(
              requirementId,
              record.currentBaseline.id,
            ),
            this.repository.listGateRunRecordsByRequirement(requirementId),
            this.gateExecutionPort
              .getGateExecutionCapability({
                actorId: actor.actorId,
                requirementId,
                baselineId: record.currentBaseline.id,
                stage: record.requirement.currentStage,
              })
              .catch(() => ({
                status: 'UNKNOWN' as const,
                source: 'UNAVAILABLE' as const,
                capabilityVersion: 'probe-error/v1',
                checkedAt: this.now(),
                reasonCode: 'GATE_EXECUTION_PROBE_FAILED',
              })),
            this.repository.listMaterialBaselinesByRequirement(requirementId),
            this.repository.listMaterialImpactsByRequirement(requirementId),
          ])
        : [
            [],
            [],
            {
              status: 'UNAVAILABLE' as const,
              source: 'UNAVAILABLE' as const,
              capabilityVersion: 'g0-incomplete/v1',
              checkedAt: this.now(),
              reasonCode: 'G0_REGISTRATION_INCOMPLETE',
            },
            [],
            [],
          ];
    return toDetail(
      record,
      questions,
      gateRuns,
      {
        status: gateCapability.status,
        capabilityVersion: gateCapability.capabilityVersion,
        checkedAt: gateCapability.checkedAt,
        reasonCode:
          gateCapability.status === 'AVAILABLE'
            ? null
            : gateCapability.reasonCode,
      },
      materialBaselines,
      impacts,
    );
  }

  async createRequirement(
    actor: ActorContext,
    input: CreateRequirementRequest,
    idempotencyKey: string,
  ): Promise<RequirementMutationResponse> {
    assertCreatePermission(actor);
    const now = this.now();
    const requirementId = this.idFactory('requirement');
    const baselineId = this.idFactory('baseline');
    const draft = createRequirementDraft({
      id: requirementId,
      name: input.name,
      originalIdea: input.originalIdea,
      initiatorId: actor.actorId,
      now,
      registration: input.registration,
      initialBaselineId: baselineId,
      confirmedBy: actor.actorId,
    });
    const write = this.createWrite({
      requirement: draft.requirement,
      materialBaseline: draft.materialBaseline,
      actorId: actor.actorId,
      eventType: 'requirement.created',
      beforeSummary: null,
      afterSummary: {
        stage: 'G0',
        incomplete: draft.missingFields.length > 0,
      },
      occurredAt: now,
    });
    const hash = requestHash(input);
    const idempotency = this.createIdempotency({
      actorId: actor.actorId,
      route: createRoute,
      idempotencyKey,
      requestHash: hash,
      resourceId: requirementId,
      now,
    });
    const result = await this.repository.createRequirementIdempotently({
      write,
      idempotency,
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for another request.',
        { existingResourceId: result.resourceId },
      );
    }
    const record = await this.repository.findRequirementRecordById(
      result.resourceId,
    );
    if (!record) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Create result is unknown.',
      );
    }
    return {
      replayed: result.status === 'REPLAYED',
      requirement: toDetail(record),
    };
  }

  async completeG0Registration(
    actor: ActorContext,
    requirementId: string,
    registration: G0RegistrationDto,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<RequirementMutationResponse> {
    const current = await this.getRequirement(actor, requirementId);
    const route = `/api/v1/requirements/${requirementId}/g0-registration`;
    const commandHash = requestHash({ registration, expectedRowVersion });
    const actionDecision = await this.authorization.authorize(actor, {
      requirementId,
      action: 'COMPLETE_G0_REGISTRATION',
      sensitivity: current.registration.sensitivity ?? 'RESTRICTED',
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (actionDecision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        actionDecision.code ?? 'PERMISSION_DENIED',
        'G0 registration access was denied.',
        { reasonCode: actionDecision.reasonCode },
      );
    }
    const existingCommand = await this.repository.findIdempotencyRecord({
      actorId: actor.actorId,
      route,
      idempotencyKey,
    });
    if (existingCommand) {
      if (existingCommand.requestHash !== commandHash) {
        throw new DomainRuleViolation(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for another request.',
          { existingResourceId: existingCommand.resultReference },
        );
      }
      if (existingCommand.resultReference !== requirementId) {
        throw new DomainRuleViolation(
          'RESULT_UNKNOWN',
          'Update result is unknown.',
        );
      }
      return { replayed: true, requirement: current };
    }
    const record =
      await this.repository.findRequirementRecordById(requirementId);
    if (!record) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    const now = this.now();
    const completed = completeG0Registration({
      requirement: record.requirement,
      baselineId: this.idFactory('baseline'),
      registration,
      confirmedBy: actor.actorId,
      now,
      expectedRowVersion,
    });
    const write = this.createWrite({
      requirement: completed.requirement,
      materialBaseline: completed.materialBaseline,
      actorId: actor.actorId,
      eventType: 'g0.completed',
      beforeSummary: { stage: 'G0', incomplete: true },
      afterSummary: { stage: 'G0', incomplete: false },
      occurredAt: now,
    });
    const result = await this.repository.completeG0RegistrationIdempotently({
      previousRowVersion: expectedRowVersion,
      write,
      idempotency: this.createIdempotency({
        actorId: actor.actorId,
        route,
        idempotencyKey,
        requestHash: commandHash,
        resourceId: requirementId,
        now,
      }),
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for another request.',
        { existingResourceId: result.resourceId },
      );
    }
    const updated =
      await this.repository.findRequirementRecordById(requirementId);
    if (!updated) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Update result is unknown.',
      );
    }
    return {
      replayed: result.status === 'REPLAYED',
      requirement: toDetail(updated),
    };
  }

  async getRequirementSubmission(
    actor: ActorContext,
    idempotencyKey: string,
  ): Promise<RequirementSubmissionResponse> {
    if (actor.authenticationStatus !== 'AUTHENTICATED') {
      return { status: 'UNKNOWN', existingResourceId: null };
    }
    const record = await this.repository.findIdempotencyRecord({
      actorId: actor.actorId,
      route: createRoute,
      idempotencyKey,
    });
    if (!record) return { status: 'NOT_FOUND', existingResourceId: null };
    return record.resultReference
      ? { status: 'CREATED', existingResourceId: record.resultReference }
      : { status: 'UNKNOWN', existingResourceId: null };
  }

  private createWrite(input: {
    requirement: Requirement;
    materialBaseline: RequirementRecord['currentBaseline'];
    actorId: string;
    eventType: string;
    beforeSummary: TimelineEvent['beforeSummary'];
    afterSummary: TimelineEvent['afterSummary'];
    occurredAt: string;
  }): RequirementWrite {
    const timelineEvent: TimelineEvent = {
      id: this.idFactory('timeline'),
      requirementId: input.requirement.id,
      aggregateType: 'requirement',
      aggregateId: input.requirement.id,
      eventType: input.eventType,
      actorId: input.actorId,
      beforeSummary: input.beforeSummary,
      afterSummary: input.afterSummary,
      aggregateVersion: input.requirement.rowVersion,
      occurredAt: input.occurredAt,
    };
    return {
      requirement: input.requirement,
      materialBaseline: input.materialBaseline,
      materialRefs: input.materialBaseline
        ? [
            createInitialMaterialRef({
              id: this.idFactory('material'),
              requirement: input.requirement,
              baseline: input.materialBaseline,
              contentHash: exactContentHash(input.requirement.originalIdea),
            }),
          ]
        : [],
      timelineEvent,
      outboxEvent: createOutboxEvent({
        id: this.idFactory('outbox'),
        type: input.eventType,
        aggregateType: 'requirement',
        aggregateId: input.requirement.id,
        aggregateVersion: input.requirement.rowVersion,
        occurredAt: input.occurredAt,
        summary: input.afterSummary,
      }),
    };
  }

  private createIdempotency(input: {
    actorId: string;
    route: string;
    idempotencyKey: string;
    requestHash: string;
    resourceId: string;
    now: string;
  }): IdempotencyRecord {
    return {
      id: this.idFactory('idempotency'),
      actorId: input.actorId,
      route: input.route,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      resultReference: input.resourceId,
      responseSummary: { status: 'CREATED' },
      createdAt: input.now,
    };
  }
}
