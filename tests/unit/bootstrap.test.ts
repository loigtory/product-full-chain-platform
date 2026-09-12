import { describe, expect, it } from 'vitest';

import { createBootstrapStatus } from '../../packages/domain/src/bootstrap.ts';

describe('createBootstrapStatus', () => {
  it('reports an explicit T0-only ready state without claiming business capability', () => {
    expect(createBootstrapStatus()).toEqual({
      state: 'ready',
      scope: 'T0',
      businessFeatures: false,
    });
  });
});
