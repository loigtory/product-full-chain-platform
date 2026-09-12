import { DomainRuleViolation } from './errors.ts';

const repositoryFingerprintPattern = /^sha256:[0-9a-f]{64}$/;

export function assertRepositoryFingerprint(value: string): string {
  if (!repositoryFingerprintPattern.test(value)) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Repository fingerprint must be a canonical lowercase SHA-256 value.',
    );
  }
  return value;
}

export function assertAllowedRelativePath(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/');
  const parts = normalized.split('/');
  const invalid =
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    parts.some((part) => !part || part === '.' || part === '..');
  if (invalid) throw new Error('INVALID_WORKSPACE_RELATIVE_PATH');
  return normalized;
}
