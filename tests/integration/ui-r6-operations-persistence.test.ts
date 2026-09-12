import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const schemaName = 'codex_test_ui_r6_operations';

if (connectionString) {
  describe('UI-R6 PostgreSQL operations read models', () => {
    const database = createDatabase({ connectionString, maxConnections: 1 });
    const fixture = createLocalExperienceFixture();
    const repository = new PostgresLifecycleRepository(database, schemaName);

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      await seedLocalExperienceDatabase(database, schemaName, fixture);
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('filters current and historical gate records without per-row detail reads', async () => {
      const current = await repository.listGateCenterItems({
        view: 'CURRENT',
        search: '',
        stage: 'G3',
        status: 'WARN',
        mode: 'AUTOMATIC',
        cursor: null,
        limit: 20,
      });
      const history = await repository.listGateCenterItems({
        view: 'HISTORY',
        search: '',
        stage: null,
        status: 'PASS',
        mode: 'AUTOMATIC',
        cursor: null,
        limit: 20,
      });

      expect(current.items).toHaveLength(1);
      expect(current.items[0]).toMatchObject({
        requirementName: '体验：材料变更影响评估',
        stage: 'G3',
        status: 'WARN',
        historyCount: 3,
      });
      expect(history.items).toHaveLength(2);
      expect(history.items.every((item) => item.gateRunId)).toBe(true);
    });

    it('returns candidate baseline, material references, and its pending impact together', async () => {
      const candidates = await repository.listMaterialLibraryItems({
        search: '材料变更',
        status: 'CANDIDATE',
        sourceType: 'USER_INTERVIEW',
        materialPurpose: 'FACT',
        sensitivity: 'INTERNAL',
        cursor: null,
        limit: 20,
      });
      const current = await repository.listMaterialLibraryItems({
        search: '材料变更',
        status: 'CURRENT',
        sourceType: null,
        materialPurpose: null,
        sensitivity: null,
        cursor: null,
        limit: 20,
      });

      expect(candidates.items).toHaveLength(1);
      expect(candidates.items[0]).toMatchObject({
        requirementName: '体验：材料变更影响评估',
        status: 'CANDIDATE',
        pendingImpact: {
          status: 'PENDING',
          recommendedStage: 'G1',
        },
      });
      expect(current.items).toHaveLength(1);
      expect(current.items[0]?.materialRefs).toHaveLength(2);
      expect(current.items[0]?.materialRefs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ referenceType: 'ORIGINAL_IDEA' }),
          expect.objectContaining({ referenceType: 'USER_INTERVIEW_NOTE' }),
        ]),
      );
      expect(
        current.items[0]?.materialRefs.every(
          (materialRef) => !('location' in materialRef),
        ),
      ).toBe(true);
    });

    it('rejects a malformed operations cursor instead of partially parsing it', async () => {
      await expect(
        repository.listGateCenterItems({
          view: 'CURRENT',
          search: '',
          stage: null,
          status: null,
          mode: null,
          cursor: '1oops',
          limit: 20,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
}
