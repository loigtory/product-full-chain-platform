import { describe, expect, it } from 'vitest';

import {
  assertRepositoryFingerprint,
  DomainRuleViolation,
} from '../../packages/domain/src/index.ts';

describe('workspace repository fingerprint', () => {
  const validFingerprint = `sha256:${'a'.repeat(64)}`;

  it('accepts only a canonical lowercase SHA-256 fingerprint', () => {
    expect(assertRepositoryFingerprint(validFingerprint)).toBe(
      validFingerprint,
    );
  });

  it.each([
    '',
    'plain',
    `sha256:${'a'.repeat(63)}`,
    `sha256:${'a'.repeat(65)}`,
    `sha256:${'A'.repeat(64)}`,
    ` ${validFingerprint}`,
    `${validFingerprint} `,
  ])('rejects the non-canonical value %j', (value) => {
    expect(() => assertRepositoryFingerprint(value)).toThrow(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'VALIDATION_FAILED',
      }),
    );
  });
});
