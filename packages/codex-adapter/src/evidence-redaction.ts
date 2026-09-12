export function redactAgentEvidence(
  value: string,
  context: { userProfile?: string; workspacePath?: string } = {},
): string {
  let result = value;
  for (const path of [context.userProfile, context.workspacePath]) {
    if (path) result = result.replaceAll(path, '<local-path>');
  }
  return result
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1<redacted>')
    .replace(
      /((?:token|cookie|password|secret)\s*[=:]\s*)[^\s;]+/gi,
      '$1<redacted>',
    )
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://<redacted>')
    .slice(0, 4_000);
}
