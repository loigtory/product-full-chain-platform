import { describe, expect, it } from 'vitest';

import { createAIWorkSessionTestData } from '../../packages/test-data/src/index.ts';

describe('AI-UX-R1 deterministic test data', () => {
  it('creates all confirmed roles and scenario IDs inside one isolated namespace', () => {
    const data = createAIWorkSessionTestData('Factory-01');

    expect(data.schemaName).toBe('codex_test_aiux_factory_01');
    expect(Object.keys(data.accounts)).toEqual([
      'productManager',
      'productOwner',
      'businessOwner',
      'engineeringOwner',
      'testOwner',
      'releaseOwner',
      'teamAdmin',
    ]);
    expect(data.scenarioIds).toEqual([
      'AIUX-DATA-01',
      'AIUX-DATA-02',
      'AIUX-DATA-03',
      'AIUX-DATA-04',
      'AIUX-DATA-05',
      'AIUX-DATA-06',
      'AIUX-DATA-07',
      'AIUX-DATA-08',
      'AIUX-DATA-09',
      'AIUX-DATA-10',
      'AIUX-DATA-11',
      'AIUX-DATA-12',
    ]);
    expect(
      data.createdIds.every((value) =>
        value.startsWith('CODEx_TEST_AIUX_Factory_01_'),
      ),
    ).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(
      /password|token|cookie|databaseUrl/i,
    );
  });
});
