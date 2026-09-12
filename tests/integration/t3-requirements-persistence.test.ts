import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { RequirementApplicationService } from '../../apps/server/src/requirements/index.ts';
import {
  PostgresLifecycleRepository,
  PostgresWorkSessionRepository,
  createDatabase,
  createLifecycleSchema,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createT3Fixture } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'T3_PERSISTENCE';
const schemaName = `codex_test_t3_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createT3Fixture(runId);

if (connectionString) {
  describe('T3 requirement persistence', () => {
    const database = createDatabase({ connectionString });
    const repository = new PostgresLifecycleRepository(database, schemaName);
    const workSessions = new PostgresWorkSessionRepository(
      database,
      schemaName,
    );
    const ports = createDependencyPorts(
      { appEnvironment: 'test', fixtureAdaptersEnabled: true },
      fixture.dependencyFixtures,
      () => fixture.now,
    );
    const service = new RequirementApplicationService({
      repository,
      authorizationPort: ports.authorization,
      deliverySummaryPort: ports.deliverySummary,
      now: () => fixture.now,
      idFactory: fixture.createIdFactory(),
    });

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      for (const write of fixture.seedWrites) {
        await repository.createRequirement(write);
      }
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('lists body-free projections and treats unclassified drafts as restricted', async () => {
      const page = await repository.listRequirementCandidates({
        search: 'INCOMPLETE',
        cursor: null,
        limit: 10,
      });
      expect(page.items).toEqual([
        expect.objectContaining({
          id: fixture.requirementIds.incomplete,
          sensitivity: 'RESTRICTED',
        }),
      ]);
      expect(page.items[0]).not.toHaveProperty('originalIdea');
      await expect(
        repository.findRequirementAccessMetadata(
          fixture.requirementIds.incomplete,
        ),
      ).resolves.toEqual({
        id: fixture.requirementIds.incomplete,
        sensitivity: 'RESTRICTED',
      });
    });

    it('creates same-name requirements separately and replays one key without duplication', async () => {
      const first = await service.createRequirement(
        fixture.actors.productManager,
        fixture.createInputs.sameName,
        fixture.idempotencyKeys.sameNameFirst,
      );
      const second = await service.createRequirement(
        fixture.actors.productManager,
        fixture.createInputs.sameName,
        fixture.idempotencyKeys.sameNameSecond,
      );
      const replay = await service.createRequirement(
        fixture.actors.productManager,
        fixture.createInputs.sameName,
        fixture.idempotencyKeys.sameNameFirst,
      );

      expect(first.requirement.id).not.toBe(second.requirement.id);
      expect(replay).toMatchObject({
        replayed: true,
        requirement: { id: first.requirement.id },
      });
      const count = await database
        .withSchema(schemaName)
        .selectFrom('requirements')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('name', '=', fixture.createInputs.sameName.name)
        .executeTakeFirstOrThrow();
      expect(Number(count.count)).toBe(2);
    });

    it('rejects one key with a different payload without a partial requirement', async () => {
      const before = await database
        .withSchema(schemaName)
        .selectFrom('requirements')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow();
      await service.createRequirement(
        fixture.actors.productManager,
        fixture.createInputs.incomplete,
        fixture.idempotencyKeys.conflict,
      );
      await expect(
        service.createRequirement(
          fixture.actors.productManager,
          fixture.createInputs.complete,
          fixture.idempotencyKeys.conflict,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      const after = await database
        .withSchema(schemaName)
        .selectFrom('requirements')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow();
      expect(Number(after.count) - Number(before.count)).toBe(1);
    });

    it('serializes concurrent duplicate arrivals into one requirement', async () => {
      const input = {
        name: 'T3 并发合成需求',
        originalIdea: '验证相同幂等键并发到达时只形成一个业务对象。',
      };
      const key = `CODEx_TEST_${runId}_IDEMPOTENCY_CONCURRENT`;
      const [first, second] = await Promise.all([
        service.createRequirement(fixture.actors.productManager, input, key),
        service.createRequirement(fixture.actors.productManager, input, key),
      ]);

      expect(first.requirement.id).toBe(second.requirement.id);
      expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
      const count = await database
        .withSchema(schemaName)
        .selectFrom('requirements')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('name', '=', input.name)
        .executeTakeFirstOrThrow();
      expect(Number(count.count)).toBe(1);
    });

    it('completes G0 atomically and replays without a second baseline or event', async () => {
      const first = await service.completeG0Registration(
        fixture.actors.productManager,
        fixture.requirementIds.incomplete,
        fixture.completeRegistration,
        0,
        fixture.idempotencyKeys.completeRegistration,
      );
      const replay = await service.completeG0Registration(
        fixture.actors.productManager,
        fixture.requirementIds.incomplete,
        fixture.completeRegistration,
        0,
        fixture.idempotencyKeys.completeRegistration,
      );
      expect(first).toMatchObject({
        replayed: false,
        requirement: { rowVersion: 1, gateProjection: 'NOT_STARTED' },
      });
      expect(replay).toMatchObject({
        replayed: true,
        requirement: { rowVersion: 1, gateProjection: 'NOT_STARTED' },
      });

      const scoped = database.withSchema(schemaName);
      const baselines = await scoped
        .selectFrom('material_baselines')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('requirement_id', '=', fixture.requirementIds.incomplete)
        .executeTakeFirstOrThrow();
      const completedEvents = await scoped
        .selectFrom('timeline_events')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('requirement_id', '=', fixture.requirementIds.incomplete)
        .where('event_type', '=', 'g0.completed')
        .executeTakeFirstOrThrow();
      const materialRefs = await scoped
        .selectFrom('material_refs')
        .select([
          'source',
          'version',
          'content_hash',
          'sensitivity',
          'validity',
        ])
        .where('baseline_id', '=', first.requirement.currentBaseline!.id)
        .execute();
      expect(Number(baselines.count)).toBe(1);
      expect(Number(completedEvents.count)).toBe(1);
      expect(materialRefs).toEqual([
        {
          source: 'T3 synthetic local-only idea INCOMPLETE.',
          version: '1',
          content_hash: `sha256:${createHash('sha256')
            .update('T3 synthetic local-only idea INCOMPLETE.')
            .digest('hex')}`,
          sensitivity: 'RESTRICTED',
          validity: 'VALID',
        },
      ]);
      await expect(
        workSessions.listReadinessContextCandidates({
          requirementId: fixture.requirementIds.incomplete,
          baselineId: first.requirement.currentBaseline!.id,
          limit: 20,
        }),
      ).resolves.toEqual([
        {
          materialRefId: expect.stringMatching(/^CODEx_TEST_/),
          referenceType: 'ORIGINAL_IDEA',
          version: '1',
          sensitivity: 'RESTRICTED',
        },
      ]);
    });
  });
} else {
  describe('T3 requirement persistence config', () => {
    it('requires DATABASE_URL for integration evidence', () => {
      expect(connectionString, 'DATABASE_URL is required').toBeTruthy();
    });
  });
}
