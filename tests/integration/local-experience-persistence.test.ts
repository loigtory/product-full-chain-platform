import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXPERIENCE_ID_PREFIX } from '../../apps/server/src/local-experience.ts';
import {
  PostgresLifecycleRepository,
  createDatabase,
  createLifecycleSchema,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import {
  createLocalExperienceFixture,
  seedLocalExperienceDatabase,
} from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const schemaName = 'codex_test_experience_persistence';

if (connectionString) {
  describe('local experience PostgreSQL persistence', () => {
    const database = createDatabase({ connectionString, maxConnections: 1 });
    const fixture = createLocalExperienceFixture();

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('seeds all scenarios atomically and survives repository recreation', async () => {
      await expect(
        seedLocalExperienceDatabase(database, schemaName, fixture),
      ).resolves.toEqual({ requirements: 3, questions: 3, gateRuns: 3 });

      const firstRepository = new PostgresLifecycleRepository(
        database,
        schemaName,
      );
      const page = await firstRepository.listRequirementCandidates({
        search: '',
        cursor: null,
        limit: 10,
      });
      expect(page.items).toHaveLength(3);
      expect(
        page.items.every((item) => item.id.startsWith(EXPERIENCE_ID_PREFIX)),
      ).toBe(true);

      const recreatedRepository = new PostgresLifecycleRepository(
        database,
        schemaName,
      );
      const gateRequirement = fixture.requirementWrites[1];
      const record = await recreatedRepository.findRequirementRecordById(
        gateRequirement.requirement.id,
      );
      expect(record?.requirement.name).toBe('体验：可执行门禁的结算规则');
      await expect(
        recreatedRepository.listQuestionRecordsByRequirement(
          gateRequirement.requirement.id,
          gateRequirement.materialBaseline!.id,
        ),
      ).resolves.toHaveLength(3);
    });
  });
}
