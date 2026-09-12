import { describe, expect, it } from 'vitest';

import {
  confirmQuestionDecision,
  createQuestionDecision,
  DomainRuleViolation,
  supersedeQuestionDecision,
  transitionQuestion,
  type Question,
} from '../../packages/domain/src/index.ts';

const now = '2026-09-05T05:00:00.000Z';

const question: Question = {
  id: 'CODEx_TEST_T4_QUESTION',
  requirementId: 'CODEx_TEST_T4_REQUIREMENT',
  baselineId: 'CODEx_TEST_T4_BASELINE',
  prompt: '本版本采用哪种结算口径？',
  reason: '门禁需要唯一口径。',
  candidates: ['按实结算', '按预算结算'],
  ownerId: 'CODEx_TEST_T4_BUSINESS_OWNER',
  closeByStage: 'G1',
  status: 'OPEN',
  currentDecisionId: null,
  rowVersion: 0,
  createdAt: now,
  updatedAt: now,
};

describe('T4 Question decisions', () => {
  it('creates an unconfirmed answer with an immutable explicit scope', () => {
    const decision = createQuestionDecision({
      id: 'CODEx_TEST_T4_DECISION_1',
      kind: 'ANSWER',
      question,
      rawAnswer: '按实结算',
      explanation: '采用可核对的实际金额。',
      versionNumber: 1,
      now,
    });

    expect(decision).toMatchObject({
      kind: 'ANSWER',
      rawAnswer: '按实结算',
      confirmedAt: null,
      validity: 'CURRENT',
      scope: {
        questionId: question.id,
        requirementId: question.requirementId,
        baselineId: question.baselineId,
        closeByStage: question.closeByStage,
      },
    });
  });

  it('confirms the current answer once without changing its original text', () => {
    const answer = createQuestionDecision({
      id: 'CODEx_TEST_T4_DECISION_1',
      kind: 'ANSWER',
      question,
      rawAnswer: '按实结算',
      explanation: null,
      versionNumber: 1,
      now,
    });
    const answered = transitionQuestion(question, {
      type: 'ANSWER',
      decisionId: answer.id,
      expectedRowVersion: 0,
      now,
    });
    const confirmed = confirmQuestionDecision(answer, {
      question: answered,
      decisionId: answer.id,
      confirmedRole: 'BUSINESS_OWNER',
      confirmedBy: question.ownerId,
      now,
    });

    expect(answer.confirmedAt).toBeNull();
    expect(confirmed).toMatchObject({
      rawAnswer: '按实结算',
      confirmedRole: 'BUSINESS_OWNER',
      confirmedBy: question.ownerId,
      confirmedAt: now,
    });
    expect(() =>
      confirmQuestionDecision(confirmed, {
        question: answered,
        decisionId: answer.id,
        confirmedRole: 'BUSINESS_OWNER',
        confirmedBy: question.ownerId,
        now,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'INVALID_STATE_TRANSITION',
      }),
    );
  });

  it('records deferral reason and reopen condition without presenting it as confirmed', () => {
    const decision = createQuestionDecision({
      id: 'CODEx_TEST_T4_DEFERRAL_1',
      kind: 'DEFERRAL',
      question,
      rawAnswer: '当前版本不依赖该统计口径。',
      explanation: '进入 G3 前或范围变化时重开。',
      versionNumber: 1,
      confirmedRole: 'BUSINESS_OWNER',
      confirmedBy: question.ownerId,
      now,
    });
    const deferred = transitionQuestion(question, {
      type: 'DEFER',
      decisionId: decision.id,
      expectedRowVersion: 0,
      now,
    });

    expect(deferred).toMatchObject({
      status: 'DEFERRED',
      currentDecisionId: decision.id,
    });
    expect(decision).toMatchObject({
      kind: 'DEFERRAL',
      confirmedRole: 'BUSINESS_OWNER',
      rawAnswer: '当前版本不依赖该统计口径。',
      explanation: '进入 G3 前或范围变化时重开。',
    });
  });

  it('marks an old decision superseded without overwriting it', () => {
    const answer = createQuestionDecision({
      id: 'CODEx_TEST_T4_DECISION_1',
      kind: 'ANSWER',
      question,
      rawAnswer: '按预算结算',
      explanation: null,
      versionNumber: 1,
      now,
    });
    const answered = transitionQuestion(question, {
      type: 'ANSWER',
      decisionId: answer.id,
      expectedRowVersion: 0,
      now,
    });
    const confirmed = confirmQuestionDecision(answer, {
      question: answered,
      decisionId: answer.id,
      confirmedRole: 'BUSINESS_OWNER',
      confirmedBy: question.ownerId,
      now,
    });
    const superseded = supersedeQuestionDecision(confirmed);

    expect(confirmed.validity).toBe('CURRENT');
    expect(superseded).toMatchObject({
      id: answer.id,
      rawAnswer: answer.rawAnswer,
      validity: 'SUPERSEDED',
    });
  });
});
