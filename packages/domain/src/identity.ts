export function normalizeLoginName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/.test(normalized)) {
    throw new Error('INVALID_LOGIN_NAME');
  }
  return normalized;
}
