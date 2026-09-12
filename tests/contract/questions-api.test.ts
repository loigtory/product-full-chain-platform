import { describe, expect, it } from 'vitest';

import {
  QUESTION_CONFIRMATION_ROLES,
  QUESTION_DECISION_KINDS,
  QUESTION_MUTATION_ACTIONS,
  type QuestionDto,
} from '../../packages/contracts/src/index.ts';

describe('T4 Question and Decision contracts', () => {
  it('publishes bounded decision kinds, confirmation roles, and mutation actions', () => {
    expect(QUESTION_DECISION_KINDS).toEqual(['ANSWER', 'DEFERRAL']);
    expect(QUESTION_CONFIRMATION_ROLES).toEqual([
      'PRODUCT_OWNER',
      'BUSINESS_OWNER',
    ]);
    expect(QUESTION_MUTATION_ACTIONS).toEqual([
      'ANSWER',
      'CONFIRM',
      'RETURN',
      'SUPERSEDE',
      'DEFER',
    ]);
  });

  it('keeps original answer, explicit scope, confirmation, and supersession visible', () => {
    const question: QuestionDto = {
      id: 'CODEx_TEST_T4_QUESTION',
      requirementId: 'CODEx_TEST_T4_REQUIREMENT',
      baselineId: 'CODEx_TEST_T4_BASELINE',
      prompt: '本版本采用哪种结算口径？',
      reason: '门禁需要唯一口径。',
      candidates: ['按实结算', '按预算结算'],
      ownerId: 'CODEx_TEST_T4_BUSINESS_OWNER',
      closeByStage: 'G1',
      status: 'CONFIRMED',
      currentDecisionId: 'CODEx_TEST_T4_DECISION',
      rowVersion: 2,
      supersededByQuestionId: null,
      decisions: [
        {
          id: 'CODEx_TEST_T4_DECISION',
          questionId: 'CODEx_TEST_T4_QUESTION',
          kind: 'ANSWER',
          rawAnswer: '按实结算',
          explanation: '与财务确认口径一致。',
          scope: {
            questionId: 'CODEx_TEST_T4_QUESTION',
            requirementId: 'CODEx_TEST_T4_REQUIREMENT',
            baselineId: 'CODEx_TEST_T4_BASELINE',
            closeByStage: 'G1',
          },
          versionNumber: 1,
          confirmedRole: 'BUSINESS_OWNER',
          confirmedBy: 'CODEx_TEST_T4_BUSINESS_OWNER',
          confirmedAt: '2026-09-05T05:00:00.000Z',
          validity: 'CURRENT',
          supersedesDecisionId: null,
          createdAt: '2026-09-05T04:59:00.000Z',
        },
      ],
      createdAt: '2026-09-05T04:58:00.000Z',
      updatedAt: '2026-09-05T05:00:00.000Z',
    };

    expect(question.decisions[0]).toMatchObject({
      rawAnswer: '按实结算',
      confirmedRole: 'BUSINESS_OWNER',
      validity: 'CURRENT',
    });
    expect(question.decisions[0].scope).toMatchObject({
      baselineId: question.baselineId,
      closeByStage: question.closeByStage,
    });
  });
});
