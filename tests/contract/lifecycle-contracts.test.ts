import { describe, expect, it } from 'vitest';

import {
  GATE_RESULTS,
  GATE_RUN_RESULTS,
  LIFECYCLE_ERROR_CODES,
  LIFECYCLE_STAGES,
  MATERIAL_PURPOSES,
  MATERIAL_SOURCE_TYPES,
  QUESTION_STATUSES,
  SENSITIVITY_LEVELS,
} from '../../packages/contracts/src/index.ts';

describe('lifecycle contracts', () => {
  it('publishes the confirmed lifecycle and material value sets', () => {
    expect(LIFECYCLE_STAGES).toEqual([
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
    ]);
    expect(MATERIAL_SOURCE_TYPES).toEqual([
      'BUSINESS_FEEDBACK',
      'USER_INTERVIEW',
      'OPERATIONS_ISSUE',
      'INTERNAL_IMPROVEMENT',
      'POLICY_OR_COMPLIANCE',
      'OTHER',
    ]);
    expect(MATERIAL_PURPOSES).toEqual([
      'FACT',
      'CONSTRAINT',
      'ASSUMPTION',
      'HISTORICAL_DESIGN',
      'REGRESSION_SAMPLE',
    ]);
    expect(SENSITIVITY_LEVELS).toEqual(['INTERNAL', 'RESTRICTED', 'PUBLIC']);
  });

  it('keeps derived and persisted gate/question states distinguishable', () => {
    expect(QUESTION_STATUSES).toEqual([
      'OPEN',
      'ANSWERED',
      'CONFIRMED',
      'SUPERSEDED',
      'DEFERRED',
    ]);
    expect(GATE_RESULTS).toEqual([
      'PASS',
      'BLOCK',
      'WARN',
      'NOT_APPLICABLE',
      'UNKNOWN',
    ]);
    expect(GATE_RUN_RESULTS).toEqual(['PASS', 'BLOCK', 'WARN', 'UNKNOWN']);
    expect(LIFECYCLE_ERROR_CODES).toContain('INVALID_STATE_TRANSITION');
    expect(LIFECYCLE_ERROR_CODES).toContain('VERSION_CONFLICT');
    expect(LIFECYCLE_ERROR_CODES).toContain('STALE_BASELINE_RESULT');
  });
});
