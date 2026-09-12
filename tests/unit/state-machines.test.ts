import { describe, expect, it } from 'vitest';

import { LIFECYCLE_STAGES } from '../../packages/contracts/src/index.ts';
import {
  DomainRuleViolation,
  applyGateResult,
  nextLifecycleStage,
  transitionQuestion,
  type GateRun,
  type Question,
  type Requirement,
} from '../../packages/domain/src/index.ts';

const now = '2026-09-04T09:00:00.000Z';

const requirement: Requirement = {
  id: 'CODEx_TEST_T1_REQ_GATE',
  name: '门禁推进',
  originalIdea: 'PASS 只能推进一次。',
  initiatorId: 'CODEx_TEST_T1_ACTOR_PM',
  businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
  currentStage: 'G0',
  currentBaselineId: 'CODEx_TEST_T1_BASELINE_GATE',
  rowVersion: 3,
  createdAt: now,
  updatedAt: now,
};

const gateRun: GateRun = {
  id: 'CODEx_TEST_T1_GATE_RUN',
  requirementId: requirement.id,
  baselineId: requirement.currentBaselineId!,
  stage: 'G0',
  mode: 'MANUAL',
  status: 'IN_PROGRESS',
  result: null,
  validity: 'CURRENT',
  ownerId: 'CODEx_TEST_T1_ACTOR_OWNER',
  confirmedRole: 'BUSINESS_OWNER',
  confirmedBy: 'CODEx_TEST_T1_ACTOR_OWNER',
  confirmedAt: now,
  startedAt: now,
  completedAt: null,
  failureReason: null,
  unknownReason: null,
  registrationNote: 'Synthetic manual GateRun.',
};

describe('Question state machine', () => {
  const question: Question = {
    id: 'CODEx_TEST_T1_QUESTION',
    requirementId: requirement.id,
    baselineId: requirement.currentBaselineId!,
    prompt: '是否采用方案 A？',
    reason: '门禁需要明确方案。',
    candidates: ['方案 A', '方案 B'],
    ownerId: 'CODEx_TEST_T1_ACTOR_OWNER',
    closeByStage: 'G0',
    status: 'OPEN',
    currentDecisionId: null,
    rowVersion: 0,
    createdAt: now,
    updatedAt: now,
  };

  it('allows only explicit confirmed transitions and keeps inputs immutable', () => {
    const answered = transitionQuestion(question, {
      type: 'ANSWER',
      decisionId: 'CODEx_TEST_T1_DECISION_1',
      expectedRowVersion: 0,
      now,
    });
    const confirmed = transitionQuestion(answered, {
      type: 'CONFIRM',
      expectedRowVersion: 1,
      now,
    });
    const superseded = transitionQuestion(confirmed, {
      type: 'SUPERSEDE',
      expectedRowVersion: 2,
      now,
    });

    expect(question.status).toBe('OPEN');
    expect(answered).toMatchObject({
      status: 'ANSWERED',
      currentDecisionId: 'CODEx_TEST_T1_DECISION_1',
      rowVersion: 1,
    });
    expect(confirmed.status).toBe('CONFIRMED');
    expect(superseded.status).toBe('SUPERSEDED');
  });

  it('preserves the answer reference when a responsibility owner returns it', () => {
    const answered = transitionQuestion(question, {
      type: 'ANSWER',
      decisionId: 'CODEx_TEST_T1_DECISION_RETURNED',
      expectedRowVersion: 0,
      now,
    });
    const returned = transitionQuestion(answered, {
      type: 'RETURN',
      expectedRowVersion: 1,
      now,
    });

    expect(returned).toMatchObject({
      status: 'OPEN',
      currentDecisionId: 'CODEx_TEST_T1_DECISION_RETURNED',
      rowVersion: 2,
    });
  });

  it('rejects implicit skipping and stale writes', () => {
    expect(() =>
      transitionQuestion(question, {
        type: 'CONFIRM',
        expectedRowVersion: 0,
        now,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'INVALID_STATE_TRANSITION',
      }),
    );

    expect(() =>
      transitionQuestion(question, {
        type: 'ANSWER',
        decisionId: 'CODEx_TEST_T1_DECISION_STALE',
        expectedRowVersion: 7,
        now,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'VERSION_CONFLICT',
      }),
    );
  });
});

describe('GateRun state machine', () => {
  it('advances only to the adjacent stage and keeps G12 terminal', () => {
    for (const [index, stage] of LIFECYCLE_STAGES.entries()) {
      expect(nextLifecycleStage(stage)).toBe(
        index === LIFECYCLE_STAGES.length - 1
          ? null
          : LIFECYCLE_STAGES[index + 1],
      );
    }
  });

  it('advances a matching PASS from G0 to G1 exactly once', () => {
    const completed = applyGateResult({
      requirement,
      gateRun,
      result: 'PASS',
      completedAt: now,
      existingAdvancement: null,
    });
    const replayed = applyGateResult({
      requirement: completed.requirement,
      gateRun: completed.gateRun,
      result: 'PASS',
      completedAt: now,
      existingAdvancement: completed.advancement,
    });

    expect(completed.requirement).toMatchObject({
      currentStage: 'G1',
      rowVersion: 4,
    });
    expect(completed.advancement).toMatchObject({
      gateRunId: gateRun.id,
      fromStage: 'G0',
      toStage: 'G1',
    });
    expect(replayed).toEqual(completed);
  });

  it('rejects a replay whose recorded advancement is bound to another aggregate', () => {
    const completedGateRun: GateRun = {
      ...gateRun,
      status: 'COMPLETED',
      result: 'PASS',
      completedAt: now,
    };

    expect(() =>
      applyGateResult({
        requirement: { ...requirement, currentStage: 'G1' },
        gateRun: completedGateRun,
        result: 'PASS',
        completedAt: now,
        existingAdvancement: {
          id: `${gateRun.id}:advancement`,
          gateRunId: gateRun.id,
          requirementId: 'CODEx_TEST_T1_REQ_OTHER',
          baselineId: gateRun.baselineId,
          fromStage: 'G0',
          toStage: 'G1',
          advancedAt: now,
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'INVALID_STATE_TRANSITION',
      }),
    );
  });

  it('retains a late result as stale baseline history without advancing', () => {
    const currentRequirement = {
      ...requirement,
      currentBaselineId: 'CODEx_TEST_T1_BASELINE_NEW',
    };
    const completed = applyGateResult({
      requirement: currentRequirement,
      gateRun,
      result: 'PASS',
      completedAt: now,
      existingAdvancement: null,
    });

    expect(completed.requirement).toEqual(currentRequirement);
    expect(completed.gateRun).toMatchObject({
      result: 'PASS',
      validity: 'STALE_BASELINE',
    });
    expect(completed.advancement).toBeNull();
  });

  it('marks a late result for an old stage invalid without advancing', () => {
    const currentRequirement = {
      ...requirement,
      currentStage: 'G1' as const,
    };
    const completed = applyGateResult({
      requirement: currentRequirement,
      gateRun,
      result: 'PASS',
      completedAt: now,
      existingAdvancement: null,
    });

    expect(completed.requirement).toEqual(currentRequirement);
    expect(completed.gateRun.validity).toBe('INVALIDATED');
    expect(completed.advancement).toBeNull();
  });

  it('recovers a completed current PASS whose advancement was not recorded', () => {
    const interruptedGateRun: GateRun = {
      ...gateRun,
      status: 'COMPLETED',
      result: 'PASS',
      completedAt: now,
    };
    const recovered = applyGateResult({
      requirement,
      gateRun: interruptedGateRun,
      result: 'PASS',
      completedAt: now,
      existingAdvancement: null,
    });

    expect(recovered.requirement.currentStage).toBe('G1');
    expect(recovered.advancement?.gateRunId).toBe(interruptedGateRun.id);
  });

  it.each(['BLOCK', 'WARN', 'UNKNOWN'] as const)(
    'does not advance the requirement for %s',
    (result) => {
      const completed = applyGateResult({
        requirement,
        gateRun,
        result,
        completedAt: now,
        existingAdvancement: null,
        unknownReason:
          result === 'UNKNOWN' ? 'Result could not be determined.' : undefined,
      });

      expect(completed.requirement).toEqual(requirement);
      expect(completed.advancement).toBeNull();
    },
  );

  it('rejects NOT_APPLICABLE as a stage-level GateRun result', () => {
    expect(() =>
      applyGateResult({
        requirement,
        gateRun,
        result: 'NOT_APPLICABLE' as never,
        completedAt: now,
        existingAdvancement: null,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'VALIDATION_FAILED',
      }),
    );
  });
});
