import { describe, expect, it } from 'vitest';

import { createApplication } from '../../apps/server/src/composition/create-application.ts';
import { createLocalTestIdFactory } from '../../apps/server/src/local-test-id-factory.ts';

describe('M2 local test ID factory', () => {
  it('prefixes generated identifiers only in an explicit local run', () => {
    const factory = createLocalTestIdFactory(
      {
        APP_ENV: 'local',
        PFC_LOCAL_TEST_RUN_ID: 'M2_R1_REAL_20260906',
      },
      {
        schemaName: 'codex_test_m2_r1',
        uuid: () => 'CODEx_TEST_UUID',
      },
    );

    expect(factory?.('agent-run')).toBe(
      'CODEx_TEST_M2_R1_REAL_20260906_agent-run-CODEx_TEST_UUID',
    );
  });

  it('is disabled by default and rejected outside local', () => {
    expect(
      createLocalTestIdFactory(
        { APP_ENV: 'local' },
        { schemaName: 'codex_test_m2_r1' },
      ),
    ).toBeUndefined();
    expect(
      createLocalTestIdFactory(
        { APP_ENV: 'local', PFC_LOCAL_TEST_RUN_ID: '   ' },
        { schemaName: 'codex_test_m2_r1' },
      ),
    ).toBeUndefined();
    expect(() =>
      createLocalTestIdFactory(
        {
          APP_ENV: 'production',
          PFC_LOCAL_TEST_RUN_ID: 'M2_R1_REAL_20260906',
        },
        { schemaName: 'codex_test_m2_r1' },
      ),
    ).toThrow('PFC_LOCAL_TEST_RUN_ID_FORBIDDEN');
  });

  it('rejects a local test ID factory in the standard product schema', () => {
    expect(() =>
      createLocalTestIdFactory(
        {
          APP_ENV: 'local',
          PFC_LOCAL_TEST_RUN_ID: 'M2_R1_REAL_20260906',
        },
        { schemaName: 'pfc' },
      ),
    ).toThrow('PFC_LOCAL_TEST_RUN_ID_STANDARD_SCHEMA_FORBIDDEN');
  });

  it('fails application startup before standard services can use test IDs', () => {
    expect(() =>
      createApplication({
        APP_ENV: 'local',
        FIXTURE_ADAPTERS_ENABLED: 'false',
        PFC_EXPERIENCE_MODE: 'false',
        PFC_LOCAL_TEST_RUN_ID: 'M2_R1_REAL_20260906',
      }),
    ).toThrow('PFC_LOCAL_TEST_RUN_ID_STANDARD_SCHEMA_FORBIDDEN');
  });
});
