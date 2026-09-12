import type { ActorRole } from './access.ts';
import type { LifecycleStage, QuestionStatus } from './lifecycle.ts';

export const QUESTION_DECISION_KINDS = ['ANSWER', 'DEFERRAL'] as const;
export const QUESTION_CONFIRMATION_ROLES = [
  'PRODUCT_OWNER',
  'BUSINESS_OWNER',
] as const satisfies readonly ActorRole[];
export const QUESTION_MUTATION_ACTIONS = [
  'ANSWER',
  'CONFIRM',
  'RETURN',
  'SUPERSEDE',
  'DEFER',
] as const;

export type QuestionDecisionKind = (typeof QUESTION_DECISION_KINDS)[number];
export type QuestionConfirmationRole =
  (typeof QUESTION_CONFIRMATION_ROLES)[number];
export type QuestionMutationAction = (typeof QUESTION_MUTATION_ACTIONS)[number];

export type QuestionDecisionScopeDto = Readonly<{
  questionId: string;
  requirementId: string;
  baselineId: string;
  closeByStage: LifecycleStage;
}>;

export type DecisionDto = Readonly<{
  id: string;
  questionId: string;
  kind: QuestionDecisionKind;
  rawAnswer: string;
  explanation: string | null;
  scope: QuestionDecisionScopeDto;
  versionNumber: number;
  confirmedRole: QuestionConfirmationRole | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  validity: 'CURRENT' | 'SUPERSEDED';
  supersedesDecisionId: string | null;
  createdAt: string;
}>;

export type QuestionDto = Readonly<{
  id: string;
  requirementId: string;
  baselineId: string;
  prompt: string;
  reason: string | null;
  candidates: readonly string[];
  ownerId: string;
  closeByStage: LifecycleStage;
  status: QuestionStatus;
  currentDecisionId: string | null;
  rowVersion: number;
  supersededByQuestionId: string | null;
  decisions: readonly DecisionDto[];
  createdAt: string;
  updatedAt: string;
}>;

export type AnswerQuestionRequest = Readonly<{
  rawAnswer: string;
  explanation?: string | null;
}>;

export type ConfirmQuestionRequest = Readonly<{
  decisionId: string;
  confirmedRole: QuestionConfirmationRole;
}>;

export type ReturnQuestionRequest = Readonly<{
  reason: string;
}>;

export type SupersedeQuestionRequest = Readonly<{
  rawAnswer: string;
  explanation?: string | null;
  confirmedRole: QuestionConfirmationRole;
}>;

export type DeferQuestionRequest = Readonly<{
  reason: string;
  reopenCondition: string;
  confirmedRole: QuestionConfirmationRole;
}>;

export type QuestionMutationResponse = Readonly<{
  action: QuestionMutationAction;
  replayed: boolean;
  question: QuestionDto;
}>;
