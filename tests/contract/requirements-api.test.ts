import { describe, expect, it } from 'vitest';

import {
  G0_GATE_PROJECTIONS,
  REQUIREMENT_LIST_SCOPES,
  REQUIREMENT_LIST_VIEWS,
  REQUIREMENT_SUBMISSION_STATUSES,
} from '../../packages/contracts/src/index.ts';

describe('T3 requirement API contracts', () => {
  it('publishes stable list, G0, and recovery statuses', () => {
    expect(REQUIREMENT_LIST_SCOPES).toEqual(['MINE', 'ALL', 'BLOCKED']);
    expect(REQUIREMENT_LIST_VIEWS).toEqual(['TABLE', 'STAGE']);
    expect(G0_GATE_PROJECTIONS).toEqual(['BLOCK', 'NOT_STARTED']);
    expect(REQUIREMENT_SUBMISSION_STATUSES).toEqual([
      'CREATED',
      'NOT_FOUND',
      'UNKNOWN',
    ]);
  });
});
