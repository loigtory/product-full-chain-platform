import { describe, expect, it } from 'vitest';

import {
  MATERIAL_IMPACT_CONFIRMATION_ROLES,
  MATERIAL_IMPACT_DECISIONS,
  MATERIAL_IMPACT_STATUSES,
} from '../../packages/contracts/src/index.ts';

describe('T6 material impact contract', () => {
  it('keeps the decision, lifecycle state, and confirming roles explicit', () => {
    expect(MATERIAL_IMPACT_DECISIONS).toEqual(['IMPACTS', 'NO_IMPACT']);
    expect(MATERIAL_IMPACT_STATUSES).toEqual([
      'PENDING',
      'CONFIRMED',
      'CANCELLED',
    ]);
    expect(MATERIAL_IMPACT_CONFIRMATION_ROLES).toEqual([
      'PRODUCT_OWNER',
      'BUSINESS_OWNER',
    ]);
  });
});
