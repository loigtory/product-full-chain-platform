import { describe, expect, it } from 'vitest';

import {
  assertGateCheckConsistency,
  createGateRun,
  DomainRuleViolation,
  type GateCheck,
} from '../../packages/domain/src/index.ts';

const now = '2026-09-05T06:00:00.000Z';

function check(
  result: GateCheck['result'],
  reason: string | null = null,
): GateCheck {
  return {
    id: `CODEx_TEST_T5_CHECK_${result}`,
    gateRunId: 'CODEx_TEST_T5_GATE_RUN',
    checkKey: `check.${result.toLowerCase()}`,
    result,
    reason,
    ownerId: 'CODEx_TEST_T5_OWNER',
    closePoint: 'G0',
    createdAt: now,
  };
}

describe('T5 GateRun creation and checks', () => {
  it('creates an automatic run in progress without manual confirmation fields', () => {
    expect(
      createGateRun({
        id: 'CODEx_TEST_T5_GATE_RUN',
        requirementId: 'CODEx_TEST_T5_REQUIREMENT',
        baselineId: 'CODEx_TEST_T5_BASELINE',
        stage: 'G0',
        mode: 'AUTOMATIC',
        ownerId: 'CODEx_TEST_T5_PM',
        now,
      }),
    ).toMatchObject({
      status: 'IN_PROGRESS',
      result: null,
      confirmedRole: null,
      registrationNote: null,
    });
  });

  it('requires a responsibility confirmation and note for a manual run', () => {
    expect(() =>
      createGateRun({
        id: 'CODEx_TEST_T5_GATE_RUN',
        requirementId: 'CODEx_TEST_T5_REQUIREMENT',
        baselineId: 'CODEx_TEST_T5_BASELINE',
        stage: 'G0',
        mode: 'MANUAL',
        ownerId: 'CODEx_TEST_T5_OWNER',
        now,
      }),
    ).toThrowError(DomainRuleViolation);
  });

  it('accepts PASS with positive coverage and reasoned N/A checks', () => {
    expect(() =>
      assertGateCheckConsistency('PASS', [
        check('PASS'),
        check('NOT_APPLICABLE', '当前版本没有外部发布目标。'),
      ]),
    ).not.toThrow();
  });

  it.each([
    ['PASS', [check('NOT_APPLICABLE', '不适用')]],
    ['PASS', [check('WARN', '待跟踪')]],
    ['WARN', [check('PASS')]],
    ['BLOCK', [check('PASS')]],
    ['PASS', [check('NOT_APPLICABLE')]],
  ] as const)('rejects an inconsistent %s aggregate', (result, checks) => {
    expect(() => assertGateCheckConsistency(result, checks)).toThrowError(
      DomainRuleViolation,
    );
  });
});
