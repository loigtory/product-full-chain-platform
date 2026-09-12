export function appServerRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function appServerNestedId(value: unknown, field: string): string {
  if (
    !appServerRecord(value) ||
    !appServerRecord(value[field]) ||
    typeof value[field].id !== 'string'
  ) {
    throw new Error(`APP_SERVER_${field.toUpperCase()}_ID_MISSING`);
  }
  return value[field].id;
}

export type AppServerTerminalResult = Readonly<{
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  reasonCode?: string;
}>;

export function semanticTerminalResult(
  text: string | null,
): AppServerTerminalResult {
  const result = text
    ?.trim()
    .match(/^[\s#>*_-]*(?:status\s*[:：]\s*)?(PASS|WARN|BLOCKED)\b/i)?.[1]
    ?.toUpperCase();
  if (result === 'PASS' || result === 'WARN') return { status: 'SUCCEEDED' };
  if (result === 'BLOCKED') {
    return { status: 'FAILED', reasonCode: 'AGENT_RESULT_BLOCKED' };
  }
  return { status: 'UNKNOWN', reasonCode: 'AGENT_RESULT_STATUS_MISSING' };
}

export function listedSkillIsAvailable(
  value: unknown,
  expected: { name: string; path: string },
): boolean {
  if (!appServerRecord(value) || !Array.isArray(value.data)) return false;
  const expectedPath = expected.path.replaceAll('\\', '/').toLowerCase();
  return value.data.some((entry) => {
    if (!appServerRecord(entry) || !Array.isArray(entry.skills)) return false;
    return entry.skills.some(
      (skill) =>
        appServerRecord(skill) &&
        skill.enabled === true &&
        skill.name === expected.name &&
        typeof skill.path === 'string' &&
        skill.path.replaceAll('\\', '/').toLowerCase() === expectedPath,
    );
  });
}
