import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { MaterialImpactApplicationService } from '../../apps/server/src/material-impacts/index.ts';
import {
  createDatabase,
  createLifecycleSchema,
  dropLifecycleSchema,
  PostgresLifecycleRepository,
} from '../../packages/persistence/src/index.ts';
import { createT6Fixture } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'T6_PERSISTENCE';
const schemaName = `codex_test_t6_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

if (connectionString) {
  describe('T6 material impact persistence', () => {
    const database = createDatabase({ connectionString });
    const repository = new PostgresLifecycleRepository(database, schemaName);

    function serviceFor(
      fixture: ReturnType<typeof createT6Fixture>,
      idFactory = fixture.createIdFactory(),
    ) {
      const ports = createDependencyPorts(
        { appEnvironment: 'test', fixtureAdaptersEnabled: true },
        fixture.dependencyFixtures,
        () => fixture.now,
      );
      return new MaterialImpactApplicationService({
        repository,
        authorizationPort: ports.authorization,
        now: () => fixture.now,
        idFactory,
      });
    }

    async function seed(fixture: ReturnType<typeof createT6Fixture>) {
      await repository.createRequirement(fixture.requirementWrite);
      const scoped = database.withSchema(schemaName);
      for (const { gateRun } of fixture.gateRuns) {
        await scoped
          .insertInto('gate_runs')
          .values({
            id: gateRun.id,
            requirement_id: gateRun.requirementId,
            baseline_id: gateRun.baselineId,
            stage: gateRun.stage,
            mode: gateRun.mode,
            status: gateRun.status,
            result: gateRun.result,
            validity: gateRun.validity,
            owner_id: gateRun.ownerId,
            confirmed_role: gateRun.confirmedRole,
            confirmed_by: gateRun.confirmedBy,
            confirmed_at: gateRun.confirmedAt,
            started_at: gateRun.startedAt,
            completed_at: gateRun.completedAt,
            failure_reason: gateRun.failureReason,
            unknown_reason: gateRun.unknownReason,
            registration_note: gateRun.registrationNote,
          })
          .execute();
      }
    }

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      const result = await sql<{ remaining: string }>`
        select count(*)::text as remaining
        from information_schema.schemata
        where schema_name = ${schemaName}
      `.execute(database);
      expect(Number(result.rows[0]?.remaining ?? '1')).toBe(0);
      await database.destroy();
    });

    it('persists one atomic IMPACTS switch and keeps old results as invalidated history', async () => {
      const fixture = createT6Fixture(`${runId}_SWITCH`);
      await seed(fixture);
      const service = serviceFor(fixture);
      const pending = await service.createAssessment(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.createRequest,
        fixture.idempotencyKeys.create,
      );
      const before = await repository.findRequirementRecordById(
        fixture.requirementId,
      );
      expect(before?.requirement).toMatchObject({
        currentStage: 'G3',
        currentBaselineId: fixture.baselineId,
        rowVersion: 4,
      });

      const confirmed = await service.confirmAssessment(
        fixture.actors.businessOwner,
        fixture.requirementId,
        pending.assessment.id,
        fixture.impactConfirmation,
        4,
        fixture.idempotencyKeys.confirm,
      );
      expect(confirmed).toMatchObject({
        requirement: { currentStage: 'G1', rowVersion: 5 },
        assessment: {
          status: 'CONFIRMED',
          decision: 'IMPACTS',
          invalidatedGateRunIds: expect.arrayContaining([
            `${fixture.prefix}_GATE_G1`,
            `${fixture.prefix}_GATE_G3`,
          ]),
        },
      });
      const baselines = await repository.listMaterialBaselinesByRequirement(
        fixture.requirementId,
      );
      expect(
        baselines.map((item) => [item.versionNumber, item.status]),
      ).toEqual([
        [2, 'CURRENT'],
        [1, 'HISTORICAL'],
      ]);
      const runs = await repository.listGateRunRecordsByRequirement(
        fixture.requirementId,
      );
      expect(
        runs.find((item) => item.gateRun.stage === 'G0')?.gateRun.validity,
      ).toBe('CURRENT');
      expect(
        runs.find((item) => item.gateRun.stage === 'G1')?.gateRun.validity,
      ).toBe('INVALIDATED');
      const events = await repository.listTimelineEvents({
        requirementId: fixture.requirementId,
        cursor: null,
        afterSequence: null,
        limit: 10,
      });
      expect(events.items.map((item) => item.event.eventType)).toEqual([
        'baseline.switched',
        'material-impact.created',
        fixture.requirementWrite.timelineEvent.eventType,
      ]);
      expect(JSON.stringify(events)).not.toContain(
        fixture.impactConfirmation.reason,
      );
    });

    it('rolls back baseline, requirement, invalidations, impact and idempotency when the final outbox write fails', async () => {
      const fixture = createT6Fixture(`${runId}_ROLLBACK`);
      await seed(fixture);
      let counter = 0;
      const collisionOutboxId = `${fixture.prefix}_OUTBOX_COLLISION`;
      const service = serviceFor(fixture, (kind) =>
        kind === 'outbox'
          ? collisionOutboxId
          : `${fixture.prefix}_${kind.toUpperCase()}_${++counter}`,
      );
      const pending = await service.createAssessment(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.createRequest,
        fixture.idempotencyKeys.create,
      );

      await expect(
        service.confirmAssessment(
          fixture.actors.businessOwner,
          fixture.requirementId,
          pending.assessment.id,
          fixture.impactConfirmation,
          4,
          fixture.idempotencyKeys.confirm,
        ),
      ).rejects.toBeTruthy();
      await expect(
        repository.findRequirementRecordById(fixture.requirementId),
      ).resolves.toMatchObject({
        requirement: {
          currentStage: 'G3',
          currentBaselineId: fixture.baselineId,
          rowVersion: 4,
        },
      });
      await expect(
        repository.findMaterialImpactById(
          fixture.requirementId,
          pending.assessment.id,
        ),
      ).resolves.toMatchObject({ status: 'PENDING', decision: null });
      expect(
        (
          await repository.listGateRunRecordsByRequirement(
            fixture.requirementId,
          )
        ).every((item) => item.gateRun.validity === 'CURRENT'),
      ).toBe(true);
      await expect(
        repository.findIdempotencyRecord({
          actorId: fixture.actors.businessOwner.actorId,
          route: `/api/v1/requirements/${fixture.requirementId}/material-impact-assessments/${pending.assessment.id}/confirmations`,
          idempotencyKey: fixture.idempotencyKeys.confirm,
        }),
      ).resolves.toBeNull();
    });

    it('allows only one of two concurrent confirmations to switch the baseline', async () => {
      const fixture = createT6Fixture(`${runId}_CONCURRENT`);
      await seed(fixture);
      const service = serviceFor(fixture);
      const pending = await service.createAssessment(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.createRequest,
        fixture.idempotencyKeys.create,
      );
      const outcomes = await Promise.allSettled([
        service.confirmAssessment(
          fixture.actors.businessOwner,
          fixture.requirementId,
          pending.assessment.id,
          fixture.impactConfirmation,
          4,
          `${fixture.idempotencyKeys.confirm}_A`,
        ),
        service.confirmAssessment(
          fixture.actors.businessOwner,
          fixture.requirementId,
          pending.assessment.id,
          fixture.impactConfirmation,
          4,
          `${fixture.idempotencyKeys.confirm}_B`,
        ),
      ]);
      expect(outcomes.map((item) => item.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      await expect(
        repository.findRequirementRecordById(fixture.requirementId),
      ).resolves.toMatchObject({
        requirement: { currentStage: 'G1', rowVersion: 5 },
      });
    });

    it('switches a NO_IMPACT baseline without invalidating GateRuns', async () => {
      const fixture = createT6Fixture(`${runId}_NO_IMPACT`);
      await seed(fixture);
      const service = serviceFor(fixture);
      const pending = await service.createAssessment(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.createRequest,
        fixture.idempotencyKeys.create,
      );
      const confirmed = await service.confirmAssessment(
        fixture.actors.businessOwner,
        fixture.requirementId,
        pending.assessment.id,
        fixture.noImpactConfirmation,
        4,
        fixture.idempotencyKeys.confirm,
      );

      expect(confirmed.requirement.currentStage).toBe('G3');
      expect(confirmed.assessment.invalidatedGateRunIds).toEqual([]);
      expect(
        (
          await repository.listGateRunRecordsByRequirement(
            fixture.requirementId,
          )
        ).every((item) => item.gateRun.validity === 'CURRENT'),
      ).toBe(true);
    });
  });
} else {
  describe('T6 material impact persistence config', () => {
    it('requires DATABASE_URL for integration evidence', () => {
      expect(connectionString, 'DATABASE_URL is required').toBeTruthy();
    });
  });
}
