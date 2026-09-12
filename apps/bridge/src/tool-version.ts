export function normalizeDetectedToolVersion(value: string): string | null {
  const match = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/.exec(value.trim());
  return match?.[1] ?? null;
}
