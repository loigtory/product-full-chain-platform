export function createUiIdempotencyKey(
  action: string,
  standardPrefix = 'PFC_UI',
): string {
  const testRunId = import.meta.env.VITE_TEST_RUN_ID as string | undefined;
  const prefix = testRunId
    ? `CODEx_TEST_${testRunId}`
    : import.meta.env.MODE === 'experience'
      ? 'CODEx_TEST_EXPERIENCE_UI'
      : standardPrefix;
  return `${prefix}_${action}_${crypto.randomUUID()}`;
}
