import { describe, expect, it } from 'vitest';

import {
  GATE_CONFIRMATION_ROLES,
  GATE_PROJECTIONS,
  MANUAL_GATE_RUN_RESULTS,
} from '../../packages/contracts/src/index.ts';

describe('T5 GateRun contract', () => {
  it('keeps stage projections distinct from check-level N/A', () => {
    expect(GATE_PROJECTIONS).toEqual([
      'BLOCK',
      'NOT_STARTED',
      'PROCESSING',
      'WARN',
      'UNKNOWN',
    ]);
    expect(MANUAL_GATE_RUN_RESULTS).toEqual(['PASS', 'BLOCK', 'WARN']);
    expect(MANUAL_GATE_RUN_RESULTS).not.toContain('NOT_APPLICABLE');
  });

  it('allows only lifecycle responsibility roles to confirm a manual run', () => {
    expect(GATE_CONFIRMATION_ROLES).toEqual([
      'PRODUCT_OWNER',
      'BUSINESS_OWNER',
      'ENGINEERING_OWNER',
      'TEST_OWNER',
      'RELEASE_OWNER',
    ]);
    expect(GATE_CONFIRMATION_ROLES).not.toContain('PRODUCT_MANAGER');
  });
});
