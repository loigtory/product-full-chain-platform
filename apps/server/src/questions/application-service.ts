import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  AnswerQuestionRequest,
  AuthorizationPort,
  ConfirmQuestionRequest,
  DeferQuestionRequest,
  QuestionConfirmationRole,
  QuestionDto,
  QuestionMutationAction,
  QuestionMutationResponse,
  RequirementAction,
  ReturnQuestionRequest,
  SupersedeQuestionRequest,
} from '@pfc/contracts';
import {
  confirmQuestionDecision,
  createOutboxEvent,
  createQuestionDecision,
  DomainRuleViolation,
  supersedeQuestionDecision,
  transitionQuestion,
  type IdempotencyRecord,
  type Question,
  type TimelineEvent,
} from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type {
  IdempotentQuestionCommand,
  QuestionMutationWrite,
  QuestionRecord,
  RequirementRepositoryPort,
} from '../requirements/repository-port.ts';

type IdKind = 'question' | 'decision' | 'timeline' | 'outbox' | 'idempotency';

type IdFactory = (kind: IdKind) => string;

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

function toQuestionDto(
  record: QuestionRecord,
  allRecords: readonly QuestionRecord[],
): QuestionDto {
  const currentDecisionId = record.question.currentDecisionId;
  const replacingRecord = currentDecisionId
    ? allRecords.find((candidate) =>
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
}

function assertResponsibility(
  actor: ActorContext,
  question: Question,
  role?: QuestionConfirmationRole,
): void {
  const hasResponsibilityRole = actor.roles.some(
    (item) => item === 'PRODUCT_OWNER' || item === 'BUSINESS_OWNER',
  );
  const roleMatches = role === undefined || actor.roles.includes(role);
  if (
    (!hasResponsibilityRole && actor.actorId !== question.ownerId) ||
    !roleMatches
  ) {
    throw new DomainRuleViolation(
      'PERMISSION_DENIED',
      'Current actor cannot perform this Question action.',
    );
  }
}

export class QuestionApplicationService {
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

  private route(
    requirementId: string,
    questionId: string,
    suffix: string,
  ): string {
    return `/api/v1/requirements/${requirementId}/questions/${questionId}/${suffix}`;
  }

  private async authorize(
    actor: ActorContext,
    requirementId: string,
    action: RequirementAction,
  ): Promise<void> {
    const metadata =
      await this.repository.findRequirementAccessMetadata(requirementId);
    if (!metadata) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    const decision = await this.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity: metadata.sensitivity,
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'Question action access was denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  private async loadCurrentQuestion(
    requirementId: string,
    questionId: string,
  ): Promise<QuestionRecord> {
    const requirement =
      await this.repository.findRequirementRecordById(requirementId);
    if (!requirement) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    const record = await this.repository.findQuestionRecordById(
      requirementId,
      questionId,
    );
    if (!record) {
      throw new DomainRuleViolation('NOT_FOUND', 'Question was not found.');
    }
    if (
      !requirement.currentBaseline ||
      record.question.baselineId !== requirement.currentBaseline.id
    ) {
      throw new DomainRuleViolation(
        'INVALID_STATE_TRANSITION',
        'Question does not belong to the current baseline.',
      );
    }
    return record;
  }

  private idempotency(input: {
    actorId: string;
    route: string;
    key: string;
    hash: string;
    resultQuestionId: string;
    now: string;
  }): IdempotencyRecord {
    return {
      id: this.idFactory('idempotency'),
      actorId: input.actorId,
      route: input.route,
      idempotencyKey: nonBlank(input.key, 'idempotencyKey', 200),
      requestHash: input.hash,
      resultReference: input.resultQuestionId,
      responseSummary: { questionId: input.resultQuestionId },
      createdAt: input.now,
    };
  }

  private events(input: {
    requirementId: string;
    question: Question;
    actorId: string;
    eventType: string;
    beforeStatus: Question['status'];
    now: string;
    timelineExtra?: Readonly<Record<string, string | number | boolean | null>>;
  }): Pick<QuestionMutationWrite, 'timelineEvent' | 'outboxEvent'> {
    const afterSummary = {
      questionId: input.question.id,
      fromStatus: input.beforeStatus,
      toStatus: input.question.status,
      ...(input.timelineExtra ?? {}),
    };
    const timelineEvent: TimelineEvent = {
      id: this.idFactory('timeline'),
      requirementId: input.requirementId,
      aggregateType: 'question',
      aggregateId: input.question.id,
      eventType: input.eventType,
      actorId: input.actorId,
      beforeSummary: { status: input.beforeStatus },
      afterSummary,
      aggregateVersion: input.question.rowVersion,
      occurredAt: input.now,
    };
    return {
      timelineEvent,
      outboxEvent: createOutboxEvent({
        id: this.idFactory('outbox'),
        type: input.eventType,
        aggregateType: 'question',
        aggregateId: input.question.id,
        aggregateVersion: input.question.rowVersion,
        occurredAt: input.now,
        summary: {
          questionId: input.question.id,
          fromStatus: input.beforeStatus,
          toStatus: input.question.status,
        },
      }),
    };
  }

  private async execute(input: {
    actor: ActorContext;
    action: QuestionMutationAction;
    authorizationAction: RequirementAction;
    requirementId: string;
    questionId: string;
    suffix: string;
    body: unknown;
    expectedRowVersion: number;
    idempotencyKey: string;
    role?: QuestionConfirmationRole;
    build: (
      record: QuestionRecord,
      now: string,
    ) => Omit<
      QuestionMutationWrite,
      'requirementId' | 'previousQuestionId' | 'previousRowVersion'
    >;
  }): Promise<QuestionMutationResponse> {
    await this.authorize(
      input.actor,
      input.requirementId,
      input.authorizationAction,
    );
    const route = this.route(
      input.requirementId,
      input.questionId,
      input.suffix,
    );
    const hash = requestHash({
      body: input.body,
      expectedRowVersion: input.expectedRowVersion,
    });
    const existing = await this.repository.findIdempotencyRecord({
      actorId: input.actor.actorId,
      route,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new DomainRuleViolation(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for another request.',
          { existingResourceId: existing.resultReference },
        );
      }
      if (!existing.resultReference) {
        throw new DomainRuleViolation('RESULT_UNKNOWN', 'Result is unknown.');
      }
      const replay = await this.repository.findQuestionRecordById(
        input.requirementId,
        existing.resultReference,
      );
      if (!replay) {
        throw new DomainRuleViolation('RESULT_UNKNOWN', 'Result is unknown.');
      }
      const allRecords = await this.repository.listQuestionRecordsByRequirement(
        input.requirementId,
        replay.question.baselineId,
      );
      return {
        action: input.action,
        replayed: true,
        question: toQuestionDto(replay, allRecords),
      };
    }

    const record = await this.loadCurrentQuestion(
      input.requirementId,
      input.questionId,
    );
    assertResponsibility(input.actor, record.question, input.role);
    if (record.question.rowVersion !== input.expectedRowVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Question row version does not match.',
        { currentVersion: record.question.rowVersion },
      );
    }
    const now = this.now();
    const built = input.build(record, now);
    const command: IdempotentQuestionCommand = {
      write: {
        ...built,
        requirementId: input.requirementId,
        previousQuestionId: input.questionId,
        previousRowVersion: input.expectedRowVersion,
      },
      idempotency: this.idempotency({
        actorId: input.actor.actorId,
        route,
        key: input.idempotencyKey,
        hash,
        resultQuestionId: built.resultQuestionId,
        now,
      }),
    };
    const result = await this.repository.mutateQuestionIdempotently(command);
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for another request.',
        { existingResourceId: result.resourceId },
      );
    }
    const saved = await this.repository.findQuestionRecordById(
      input.requirementId,
      result.resourceId,
    );
    if (!saved) {
      throw new DomainRuleViolation('RESULT_UNKNOWN', 'Result is unknown.');
    }
    const allRecords = await this.repository.listQuestionRecordsByRequirement(
      input.requirementId,
      saved.question.baselineId,
    );
    return {
      action: input.action,
      replayed: result.status === 'REPLAYED',
      question: toQuestionDto(saved, allRecords),
    };
  }

  async answerQuestion(
    actor: ActorContext,
    requirementId: string,
    questionId: string,
    body: AnswerQuestionRequest,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse> {
    return this.execute({
      actor,
      action: 'ANSWER',
      authorizationAction: 'ANSWER_QUESTION',
      requirementId,
      questionId,
      suffix: 'answers',
      body,
      expectedRowVersion,
      idempotencyKey,
      build: (record, now) => {
        const previousDecision = record.decisions.find(
          (decision) =>
            decision.id === record.question.currentDecisionId &&
            decision.validity === 'CURRENT',
        );
        const decision = createQuestionDecision({
          id: this.idFactory('decision'),
          kind: 'ANSWER',
          question: record.question,
          rawAnswer: body.rawAnswer,
          explanation: body.explanation,
          versionNumber:
            Math.max(0, ...record.decisions.map((item) => item.versionNumber)) +
            1,
          supersedesDecisionId: previousDecision?.id ?? null,
          now,
        });
        const question = transitionQuestion(record.question, {
          type: 'ANSWER',
          decisionId: decision.id,
          expectedRowVersion,
          now,
        });
        return {
          question,
          decisionToInsert: decision,
          decisionToUpdate: previousDecision
            ? supersedeQuestionDecision(previousDecision)
            : null,
          newQuestion: null,
          resultQuestionId: question.id,
          ...this.events({
            requirementId,
            question,
            actorId: actor.actorId,
            eventType: 'question.answered',
            beforeStatus: record.question.status,
            now,
          }),
        };
      },
    });
  }

  async confirmQuestion(
    actor: ActorContext,
    requirementId: string,
    questionId: string,
    body: ConfirmQuestionRequest,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse> {
    return this.execute({
      actor,
      action: 'CONFIRM',
      authorizationAction: 'CONFIRM_QUESTION',
      requirementId,
      questionId,
      suffix: 'confirmations',
      body,
      expectedRowVersion,
      idempotencyKey,
      role: body.confirmedRole,
      build: (record, now) => {
        const currentDecision = record.decisions.find(
          (decision) => decision.id === body.decisionId,
        );
        if (!currentDecision) {
          throw new DomainRuleViolation('NOT_FOUND', 'Decision was not found.');
        }
        const decision = confirmQuestionDecision(currentDecision, {
          question: record.question,
          decisionId: body.decisionId,
          confirmedRole: body.confirmedRole,
          confirmedBy: actor.actorId,
          now,
        });
        const question = transitionQuestion(record.question, {
          type: 'CONFIRM',
          expectedRowVersion,
          now,
        });
        return {
          question,
          decisionToInsert: null,
          decisionToUpdate: decision,
          newQuestion: null,
          resultQuestionId: question.id,
          ...this.events({
            requirementId,
            question,
            actorId: actor.actorId,
            eventType: 'decision.confirmed',
            beforeStatus: record.question.status,
            now,
          }),
        };
      },
    });
  }

  async returnQuestion(
    actor: ActorContext,
    requirementId: string,
    questionId: string,
    body: ReturnQuestionRequest,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse> {
    return this.execute({
      actor,
      action: 'RETURN',
      authorizationAction: 'CONFIRM_QUESTION',
      requirementId,
      questionId,
      suffix: 'returns',
      body,
      expectedRowVersion,
      idempotencyKey,
      build: (record, now) => {
        const reason = nonBlank(body.reason, 'reason');
        const question = transitionQuestion(record.question, {
          type: 'RETURN',
          expectedRowVersion,
          now,
        });
        return {
          question,
          decisionToInsert: null,
          decisionToUpdate: null,
          newQuestion: null,
          resultQuestionId: question.id,
          ...this.events({
            requirementId,
            question,
            actorId: actor.actorId,
            eventType: 'question.returned',
            beforeStatus: record.question.status,
            now,
            timelineExtra: { returnReason: reason },
          }),
        };
      },
    });
  }

  async deferQuestion(
    actor: ActorContext,
    requirementId: string,
    questionId: string,
    body: DeferQuestionRequest,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse> {
    return this.execute({
      actor,
      action: 'DEFER',
      authorizationAction: 'CONFIRM_QUESTION',
      requirementId,
      questionId,
      suffix: 'deferrals',
      body,
      expectedRowVersion,
      idempotencyKey,
      role: body.confirmedRole,
      build: (record, now) => {
        const previousDecision = record.decisions.find(
          (decision) =>
            decision.id === record.question.currentDecisionId &&
            decision.validity === 'CURRENT',
        );
        const decision = createQuestionDecision({
          id: this.idFactory('decision'),
          kind: 'DEFERRAL',
          question: record.question,
          rawAnswer: body.reason,
          explanation: body.reopenCondition,
          versionNumber:
            Math.max(0, ...record.decisions.map((item) => item.versionNumber)) +
            1,
          confirmedRole: body.confirmedRole,
          confirmedBy: actor.actorId,
          supersedesDecisionId: previousDecision?.id ?? null,
          now,
        });
        const question = transitionQuestion(record.question, {
          type: 'DEFER',
          decisionId: decision.id,
          expectedRowVersion,
          now,
        });
        return {
          question,
          decisionToInsert: decision,
          decisionToUpdate: previousDecision
            ? supersedeQuestionDecision(previousDecision)
            : null,
          newQuestion: null,
          resultQuestionId: question.id,
          ...this.events({
            requirementId,
            question,
            actorId: actor.actorId,
            eventType: 'question.deferred',
            beforeStatus: record.question.status,
            now,
          }),
        };
      },
    });
  }

  async supersedeQuestion(
    actor: ActorContext,
    requirementId: string,
    questionId: string,
    body: SupersedeQuestionRequest,
    expectedRowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse> {
    return this.execute({
      actor,
      action: 'SUPERSEDE',
      authorizationAction: 'CONFIRM_QUESTION',
      requirementId,
      questionId,
      suffix: 'supersessions',
      body,
      expectedRowVersion,
      idempotencyKey,
      role: body.confirmedRole,
      build: (record, now) => {
        if (
          record.question.status !== 'CONFIRMED' ||
          !record.question.currentDecisionId
        ) {
          throw new DomainRuleViolation(
            'INVALID_STATE_TRANSITION',
            'Only a confirmed Question can be superseded.',
          );
        }
        const currentDecision = record.decisions.find(
          (decision) => decision.id === record.question.currentDecisionId,
        );
        if (!currentDecision || currentDecision.confirmedAt === null) {
          throw new DomainRuleViolation(
            'INVALID_STATE_TRANSITION',
            'Confirmed Question has no confirmed current Decision.',
          );
        }
        const oldQuestion = transitionQuestion(record.question, {
          type: 'SUPERSEDE',
          expectedRowVersion,
          now,
        });
        const newQuestionId = this.idFactory('question');
        const newDecisionId = this.idFactory('decision');
        const newQuestionDraft: Question = {
          ...record.question,
          id: newQuestionId,
          status: 'OPEN',
          currentDecisionId: null,
          rowVersion: 0,
          createdAt: now,
          updatedAt: now,
        };
        const newDecision = createQuestionDecision({
          id: newDecisionId,
          kind: 'ANSWER',
          question: newQuestionDraft,
          rawAnswer: body.rawAnswer,
          explanation: body.explanation,
          versionNumber: currentDecision.versionNumber + 1,
          confirmedRole: body.confirmedRole,
          confirmedBy: actor.actorId,
          supersedesDecisionId: currentDecision.id,
          now,
        });
        const newQuestion: Question = {
          ...newQuestionDraft,
          status: 'CONFIRMED',
          currentDecisionId: newDecision.id,
        };
        return {
          question: oldQuestion,
          decisionToInsert: null,
          decisionToUpdate: supersedeQuestionDecision(currentDecision),
          newQuestion: { question: newQuestion, decisions: [newDecision] },
          resultQuestionId: newQuestion.id,
          ...this.events({
            requirementId,
            question: oldQuestion,
            actorId: actor.actorId,
            eventType: 'decision.superseded',
            beforeStatus: record.question.status,
            now,
            timelineExtra: { supersededByQuestionId: newQuestion.id },
          }),
        };
      },
    });
  }
}
