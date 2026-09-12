import { describe, expect, it } from 'vitest';

import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../../apps/server/src/identity/security.ts';

describe('M1 identity security', () => {
  it('derives a password hash with a random salt and verifies it', async () => {
    const first = await hashPassword('Correct horse battery 42');
    const second = await hashPassword('Correct horse battery 42');

    expect(first.hash).not.toBe('Correct horse battery 42');
    expect(first.salt).not.toBe(second.salt);
    await expect(
      verifyPassword('Correct horse battery 42', first),
    ).resolves.toBe(true);
    await expect(verifyPassword('wrong password 000', first)).resolves.toBe(
      false,
    );
  });

  it('rejects passwords outside the bounded policy', async () => {
    await expect(hashPassword('too-short')).rejects.toThrow(
      'PASSWORD_POLICY_VIOLATION',
    );
    await expect(hashPassword('x'.repeat(129))).rejects.toThrow(
      'PASSWORD_POLICY_VIOLATION',
    );
  });

  it('only persists one-way hashes for opaque session and CSRF tokens', () => {
    const token = createOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});
