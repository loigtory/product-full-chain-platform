import { createHash } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresLifecycleRepository,
  createDatabase,
  createLifecycleSchema,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createT1Fixture } from '../../packages/test-data/src/index.ts';

const { DatabaseError } = pg;
const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'T1_LOCAL';
const schemaName = `codex_test_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createT1Fixture(runId);

if (connectionString) {
  describe('T1 lifecycle persistence', () => {
    const database = createDatabase({ connectionString });
    const repository = new PostgresLifecycleRepository(database, schemaName);

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('creates all lifecycle tables in an isolated schema', async () => {
      const tables = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', schemaName)
        .orderBy('table_name')
        .execute();

      expect(tables.map(({ table_name }) => table_name)).toEqual([
        'audit_events',
        'decisions',
        'gate_checks',
        'gate_run_evidence',
        'gate_runs',
        'idempotency_records',
        'material_baselines',
        'material_impact_assessments',
        'material_refs',
        'outbox_events',
        'questions',
        'requirements',
        'stage_advancements',
        'timeline_events',
      ]);
    });

    it('writes the current object, timeline, and redacted outbox atomically', async () => {
      await repository.createRequirement(fixture.primaryWrite);

      await expect(
        repository.findRequirementById(fixture.primaryWrite.requirement.id),
      ).resolves.toMatchObject({
        id: fixture.primaryWrite.requirement.id,
        currentStage: 'G0',
        currentBaselineId: fixture.primaryWrite.materialBaseline!.id,
      });
      await expect(repository.listPendingOutbox(10)).resolves.toEqual([
        expect.objectContaining({
          id: fixture.primaryWrite.outboxEvent.id,
          aggregateId: fixture.primaryWrite.requirement.id,
          summary: { stage: 'G0', incomplete: false },
        }),
      ]);
      await expect(
        database
          .withSchema(schemaName)
          .selectFrom('material_refs')
          .select([
            'baseline_id',
            'reference_type',
            'source',
            'version',
            'content_hash',
            'location',
            'sensitivity',
            'validity',
          ])
          .where('baseline_id', '=', fixture.primaryWrite.materialBaseline!.id)
          .execute(),
      ).resolves.toEqual([
        expect.objectContaining({
          reference_type: 'ORIGINAL_IDEA',
          source: fixture.primaryWrite.requirement.originalIdea,
          version: '1',
          content_hash: `sha256:${createHash('sha256')
            .update(fixture.primaryWrite.requirement.originalIdea)
            .digest('hex')}`,
          location: `pfc://requirements/${fixture.primaryWrite.requirement.id}/original-idea`,
          sensitivity: fixture.primaryWrite.materialBaseline!.sensitivity,
          validity: 'VALID',
        }),
      ]);
      await expect(
        repository.listMaterialLibraryItems({
          search: fixture.primaryWrite.requirement.name,
          status: 'CURRENT',
          sourceType: null,
          materialPurpose: null,
          sensitivity: null,
          cursor: null,
          limit: 20,
        }),
      ).resolves.toMatchObject({
        items: [
          {
            requirementId: fixture.primaryWrite.requirement.id,
            materialRefs: [
              {
                referenceType: 'ORIGINAL_IDEA',
                source: fixture.primaryWrite.requirement.originalIdea,
                version: '1',
                sensitivity: fixture.primaryWrite.materialBaseline!.sensitivity,
                validity: 'VALID',
              },
            ],
          },
        ],
      });

      await expect(
        repository.createRequirement({
          ...fixture.rollbackWrite,
          outboxEvent: {
            ...fixture.rollbackWrite.outboxEvent,
            id: fixture.primaryWrite.outboxEvent.id,
          },
        }),
      ).rejects.toBeInstanceOf(DatabaseError);
      await expect(
        repository.findRequirementById(fixture.rollbackWrite.requirement.id),
      ).resolves.toBeNull();
      await expect(
        database
          .withSchema(schemaName)
          .selectFrom('material_refs')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('baseline_id', '=', fixture.rollbackWrite.materialBaseline!.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ count: '0' });
    });

    it('enforces one current baseline for each requirement', async () => {
      await expect(
        database
          .withSchema(schemaName)
          .insertInto('material_baselines')
          .values({
            ...fixture.secondCurrentBaseline,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('rejects a current baseline that belongs to another requirement', async () => {
      await repository.createRequirement(fixture.rollbackWrite);

      await expect(
        database
          .withSchema(schemaName)
          .updateTable('requirements')
          .set({
            current_baseline_id: fixture.primaryWrite.materialBaseline!.id,
          })
          .where('id', '=', fixture.rollbackWrite.requirement.id)
          .execute(),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('rejects unsafe event summaries before any aggregate write commits', async () => {
      await expect(
        repository.createRequirement({
          ...fixture.unsafeWrite,
          outboxEvent: {
            ...fixture.unsafeWrite.outboxEvent,
            summary: { originalIdea: 'must remain inside the aggregate' },
          },
        }),
      ).rejects.toMatchObject({ code: 'SENSITIVE_SUMMARY_FIELD' });
      await expect(
        repository.findRequirementById(fixture.unsafeWrite.requirement.id),
      ).resolves.toBeNull();
    });

    it('rejects inconsistent aggregate bindings before any SQL write', async () => {
      await expect(
        repository.createRequirement({
          ...fixture.invalidBindingWrite,
          outboxEvent: {
            ...fixture.invalidBindingWrite.outboxEvent,
            aggregateId: fixture.primaryWrite.requirement.id,
            status: 'PUBLISHED',
          },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        repository.findRequirementById(
          fixture.invalidBindingWrite.requirement.id,
        ),
      ).resolves.toBeNull();
    });

    it('rejects an incorrect initial-material hash before any SQL write', async () => {
      await expect(
        repository.createRequirement({
          ...fixture.invalidBindingWrite,
          materialRefs: fixture.invalidBindingWrite.materialRefs.map(
            (materialRef) => ({
              ...materialRef,
              contentHash: `sha256:${'0'.repeat(64)}`,
            }),
          ),
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        repository.findRequirementById(
          fixture.invalidBindingWrite.requirement.id,
        ),
      ).resolves.toBeNull();
    });

    it('enforces one in-progress run and one advancement for a GateRun', async () => {
      const scoped = database.withSchema(schemaName);
      await scoped
        .insertInto('gate_runs')
        .values(fixture.inProgressGateRun)
        .execute();

      await expect(
        scoped
          .insertInto('gate_runs')
          .values({
            ...fixture.inProgressGateRun,
            id: `${fixture.inProgressGateRun.id}_DUPLICATE`,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23505' });

      await expect(
        scoped
          .insertInto('stage_advancements')
          .values({
            ...fixture.stageAdvancement,
            id: `${fixture.stageAdvancement.id}_INVALID`,
            gate_run_id: fixture.inProgressGateRun.id,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23514' });

      await scoped
        .insertInto('gate_runs')
        .values(fixture.completedGateRun)
        .execute();
      await scoped
        .insertInto('stage_advancements')
        .values(fixture.stageAdvancement)
        .execute();
      await expect(
        scoped
          .insertInto('stage_advancements')
          .values({
            ...fixture.stageAdvancement,
            id: `${fixture.stageAdvancement.id}_DUPLICATE`,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('rejects NOT_APPLICABLE as a stage-level GateRun result', async () => {
      await expect(
        database
          .withSchema(schemaName)
          .insertInto('gate_runs')
          .values({
            ...fixture.completedGateRun,
            id: `${fixture.completedGateRun.id}_NOT_APPLICABLE`,
            result: 'NOT_APPLICABLE' as never,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('rejects physical deletion of lifecycle facts', async () => {
      await expect(
        database
          .withSchema(schemaName)
          .deleteFrom('requirements')
          .where('id', '=', fixture.primaryWrite.requirement.id)
          .execute(),
      ).rejects.toMatchObject({ code: 'P0001' });
    });
  });
} else {
  describe('T1 lifecycle persistence config', () => {
    it('requires DATABASE_URL for migration integration evidence', () => {
      expect(connectionString, 'DATABASE_URL is required').toBeTruthy();
    });
  });
}
