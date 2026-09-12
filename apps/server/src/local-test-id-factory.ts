import { randomUUID } from 'node:crypto';

export function createLocalTestIdFactory(
  env: Readonly<{
    APP_ENV?: string;
    PFC_LOCAL_TEST_RUN_ID?: string;
  }>,
  options: Readonly<{
    schemaName: string;
    uuid?: () => string;
  }>,
): ((prefix: string) => string) | undefined {
  const runId = env.PFC_LOCAL_TEST_RUN_ID?.trim();
  if (!runId) return undefined;
  if (env.APP_ENV !== 'local') {
    throw new Error('PFC_LOCAL_TEST_RUN_ID_FORBIDDEN');
  }
  if (!/^codex_test_[a-z0-9_]+$/.test(options.schemaName)) {
    throw new Error('PFC_LOCAL_TEST_RUN_ID_STANDARD_SCHEMA_FORBIDDEN');
  }
  if (!/^[A-Z0-9][A-Z0-9_]{2,39}$/.test(runId)) {
    throw new Error('PFC_LOCAL_TEST_RUN_ID_INVALID');
  }
  const uuid = options.uuid ?? randomUUID;
  return (prefix: string) => {
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(prefix)) {
      throw new Error('PFC_LOCAL_TEST_ID_PREFIX_INVALID');
    }
    const id = `CODEx_TEST_${runId}_${prefix}-${uuid()}`;
    if (id.length > 160) throw new Error('PFC_LOCAL_TEST_ID_TOO_LONG');
    return id;
  };
}
