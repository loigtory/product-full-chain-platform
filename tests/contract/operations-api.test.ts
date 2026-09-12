import { describe, expect, it } from 'vitest';

import {
  GATE_CENTER_STATUSES,
  GATE_CENTER_VIEWS,
  GATE_RUN_MODES,
  MATERIAL_BASELINE_STATUSES,
} from '../../packages/contracts/src/index.ts';

describe('UI-R6 operations read contracts', () => {
  it('publishes stable gate-center filter values', () => {
    expect(GATE_CENTER_VIEWS).toEqual(['CURRENT', 'HISTORY']);
    expect(GATE_CENTER_STATUSES).toEqual([
      'NOT_STARTED',
      'IN_PROGRESS',
      'PASS',
      'BLOCK',
      'WARN',
      'UNKNOWN',
    ]);
    expect(GATE_RUN_MODES).toEqual(['AUTOMATIC', 'MANUAL']);
  });

  it('publishes all persisted material baseline states', () => {
    expect(MATERIAL_BASELINE_STATUSES).toEqual([
      'CURRENT',
      'HISTORICAL',
      'CANDIDATE',
    ]);
  });
});
