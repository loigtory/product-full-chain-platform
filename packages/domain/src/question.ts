import { DomainRuleViolation } from './errors.ts';
import type {
  QuestionConfirmationRole,
  QuestionDecisionKind,
} from '@pfc/contracts';

import type { Decision, Question } from './types.ts';

export type QuestionTransition =
  | Readonly<{
      type: 'ANSWER' | 'DEFER';
      decisionId: string;
      expectedRowVersion: number;
      now: string;
    }>
  | Readonly<{
      type: 'CONFIRM' | 'RETURN' | 'SUPERSEDE' | 'REOPEN';
      expectedRowVersion: number;
      now: string;
    }>;

const allowedFrom = {
  ANSWER: ['OPEN'],
  CONFIRM: ['ANSWERED'],
  RETURN: ['ANSWERED'],
  SUPERSEDE: ['CONFIRMED'],
  DEFER: ['OPEN', 'ANSWERED'],
  REOPEN: ['DEFERRED'],
} as const;

const targetStatus = {
  ANSWER: 'ANSWERED',
  CONFIRM: 'CONFIRMED',
  RETURN: 'OPEN',
  SUPERSEDE: 'SUPERSEDED',
  DEFER: 'DEFERRED',
  REOPEN: 'OPEN',
} as const;

export function transitionQuestion(
  question: Question,
  transition: QuestionTransition,
): Question {
  if (question.rowVersion !== transition.expectedRowVersion) {
    throw new DomainRuleViolation(
      'VERSION_CONFLICT',
      'Question row version does not match.',
      {
        expectedVersion: transition.expectedRowVersion,
        currentVersion: question.rowVersion,
      },
    );
  }
  if (
    !(allowedFrom[transition.type] as readonly string[]).includes(
      question.status,
    )
  ) {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      `Question cannot ${transition.type.toLowerCase()} from ${question.status}.`,
      { from: question.status, action: transition.type },
    );
  }

  let currentDecisionId = question.currentDecisionId;
  if (transition.type === 'ANSWER' || transition.type === 'DEFER') {
    if (!transition.decisionId.trim()) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'An answer record ID is required.',
        { field: 'decisionId' },
      );
    }
    currentDecisionId = transition.decisionId;
  }
  if (transition.type === 'CONFIRM' && currentDecisionId === null) {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      'A Question without an answer cannot be confirmed.',
    );
  }

  return {
    ...question,
    status: targetStatus[transition.type],
    currentDecisionId,
    rowVersion: question.rowVersion + 1,
    updatedAt: transition.now,
  };
}

function nonBlank(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      `${field} must be between 1 and ${maximum} characters.`,
      { field, maximum },
    );
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  field: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined || !value.trim()) return null;
  return nonBlank(value, field, maximum);
}

function assertConfirmationRole(role: QuestionConfirmationRole): void {
  if (role !== 'PRODUCT_OWNER' && role !== 'BUSINESS_OWNER') {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Question confirmation role is invalid.',
      { field: 'confirmedRole' },
    );
  }
}

export function createQuestionDecision(input: {
  id: string;
  kind: QuestionDecisionKind;
  question: Question;
  rawAnswer: string;
  explanation?: string | null;
  versionNumber: number;
  confirmedRole?: QuestionConfirmationRole;
  confirmedBy?: string;
  supersedesDecisionId?: string | null;
  now: string;
}): Decision {
  const id = nonBlank(input.id, 'id', 160);
  const rawAnswer = nonBlank(input.rawAnswer, 'rawAnswer', 10_000);
  const explanation = optionalText(input.explanation, 'explanation', 2_000);
  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Decision version must be a positive integer.',
      { field: 'versionNumber' },
    );
  }
  if (input.kind === 'DEFERRAL' && explanation === null) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'A deferral requires a reopen condition.',
      { field: 'reopenCondition' },
    );
  }
  const hasConfirmation =
    input.confirmedRole !== undefined || input.confirmedBy !== undefined;
  if (hasConfirmation) {
    if (!input.confirmedRole || !input.confirmedBy) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Confirmation role and actor must be supplied together.',
      );
    }
    assertConfirmationRole(input.confirmedRole);
  }
  if (input.kind === 'DEFERRAL' && !hasConfirmation) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'A deferral requires responsibility confirmation.',
    );
  }

  return {
    id,
    questionId: input.question.id,
    kind: input.kind,
    rawAnswer,
    explanation,
    scope: Object.freeze({
      questionId: input.question.id,
      requirementId: input.question.requirementId,
      baselineId: input.question.baselineId,
      closeByStage: input.question.closeByStage,
    }),
    versionNumber: input.versionNumber,
    confirmedRole: input.confirmedRole ?? null,
    confirmedBy: input.confirmedBy?.trim() || null,
    confirmedAt: hasConfirmation ? input.now : null,
    validity: 'CURRENT',
    supersedesDecisionId: input.supersedesDecisionId ?? null,
    createdAt: input.now,
  };
}

export function confirmQuestionDecision(
  decision: Decision,
  input: {
    question: Question;
    decisionId: string;
    confirmedRole: QuestionConfirmationRole;
    confirmedBy: string;
    now: string;
  },
): Decision {
  assertConfirmationRole(input.confirmedRole);
  if (
    input.question.status !== 'ANSWERED' ||
    input.question.currentDecisionId !== input.decisionId ||
    decision.id !== input.decisionId ||
    decision.questionId !== input.question.id ||
    decision.kind !== 'ANSWER' ||
    decision.validity !== 'CURRENT' ||
    decision.confirmedAt !== null
  ) {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      'Only the current unanswered confirmation can be confirmed.',
    );
  }
  return {
    ...decision,
    confirmedRole: input.confirmedRole,
    confirmedBy: nonBlank(input.confirmedBy, 'confirmedBy', 160),
    confirmedAt: input.now,
  };
}

export function supersedeQuestionDecision(decision: Decision): Decision {
  if (decision.kind !== 'ANSWER' || decision.validity !== 'CURRENT') {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      'Only a current answer can be superseded.',
    );
  }
  return { ...decision, validity: 'SUPERSEDED' };
}
