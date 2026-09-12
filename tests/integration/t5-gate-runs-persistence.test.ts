import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { GateRunApplicationService } from '../../apps/server/src/gate-runs/index.ts';
import {
  PostgresLifecycleRepository,
  createDatabase,
  createLifecycleSchema,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createT5Fixture } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'T5_PERSISTENCE';
const schemaName = `codex_test_t5_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

if (connectionString) {
  describe('T5 GateRun persistence', () => {
    const database = createDatabase({ connectionString });
    const repository = new PostgresLifecycleRepository(database, schemaName);

    function serviceFor(
      fixture: ReturnType<typeof createT5Fixture>,
      gateExecution = createDependencyPorts(
        { appEnvironment: 'test', fixtureAdaptersEnabled: true },
        fixture.dependencyFixtures,
        () => fixture.now,
      ).gateExecution,
    ) {
      const ports = createDependencyPorts(
        { appEnvironment: 'test', fixtureAdaptersEnabled: true },
        fixture.dependencyFixtures,
        () => fixture.now,
      );
      return new GateRunApplicationService({
        repository,
        authorizationPort: ports.authorization,
        artifactEvidencePort: ports.artifactEvidence,
        gateExecutionPort: gateExecution,
        now: () => fixture.now,
        idFactory: fixture.createIdFactory(),
      });
    }

    async function seed(
      fixture: ReturnType<typeof createT5Fixture>,
      withEvidence = false,
    ) {
      await repository.createRequirement(fixture.requirementWrite);
      if (withEvidence) {
        await database
          .withSchema(schemaName)
          .insertInto('material_refs')
          .values({
            id: fixture.evidenceRefId,
            baseline_id: fixture.baselineId,
            reference_type: 'PRODUCT_SPEC',
            source: 'SYNTHETIC_LOCAL_FIXTURE',
            version: '1',
            content_hash: null,
            location: `test://${fixture.evidenceRefId}`,
            sensitivity: 'INTERNAL',
            validity: 'VALID',
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

    it('advances once and preserves one advancement across 100 concurrent completion replays', async () => {
      const fixture = createT5Fixture(`${runId}_REPLAY`);
      await seed(fixture);
      const service = serviceFor(fixture);
      const first = await service.startAutomaticGateRun(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.automaticRequest,
        fixture.requirementWrite.requirement.rowVersion,
        fixture.idempotencyKeys.automatic,
      );
      expect(first).toMatchObject({
        gateRun: { result: 'PASS', validity: 'CURRENT' },
        requirement: { currentStage: 'G1' },
      });

      const check = first.gateRun.checks[0]!;
      const completion = {
        requirementId: fixture.requirementId,
        gateRunId: first.gateRun.id,
        result: 'PASS' as const,
        checks: [
          {
            ...check,
            gateRunId: first.gateRun.id,
            createdAt: fixture.now,
          },
        ],
        evidence: [],
        completedAt: fixture.now,
        actorId: fixture.actors.productManager.actorId,
        gateTimelineEventId: `${fixture.prefix}_REPLAY_GATE_TIMELINE`,
        gateOutboxEventId: `${fixture.prefix}_REPLAY_GATE_OUTBOX`,
        advancementTimelineEventId: `${fixture.prefix}_REPLAY_ADV_TIMELINE`,
        advancementOutboxEventId: `${fixture.prefix}_REPLAY_ADV_OUTBOX`,
      };
      const replays = await Promise.all(
        Array.from({ length: 100 }, () =>
          repository.completeGateRun(completion),
        ),
      );
      expect(replays.every((item) => item.replayed)).toBe(true);

      const scoped = database.withSchema(schemaName);
      const advancementCount = await scoped
        .selectFrom('stage_advancements')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('gate_run_id', '=', first.gateRun.id)
        .executeTakeFirstOrThrow();
      const advancementEvents = await scoped
        .selectFrom('timeline_events')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('event_type', '=', 'requirement.advanced')
        .where('aggregate_id', '=', fixture.requirementId)
        .executeTakeFirstOrThrow();
      expect(Number(advancementCount.count)).toBe(1);
      expect(Number(advancementEvents.count)).toBe(1);
    });

    it('reuses one in-progress run across different keys and executes externally once', async () => {
      const fixture = createT5Fixture(`${runId}_CONCURRENT`);
      await seed(fixture);
      let executeCount = 0;
      const service = serviceFor(fixture, {
        getGateExecutionCapability: async () => ({
          status: 'AVAILABLE' as const,
          source: 'FIXTURE' as const,
          capabilityVersion: 'fixture/t5/concurrency',
          checkedAt: fixture.now,
          data: { executable: true as const },
        }),
        executeGate: async () => {
          executeCount += 1;
          return {
            status: 'AVAILABLE' as const,
            source: 'FIXTURE' as const,
            capabilityVersion: 'fixture/t5/concurrency',
            checkedAt: fixture.now,
            data: {
              executionId: `${fixture.prefix}_EXTERNAL_1`,
              status: 'RUNNING' as const,
              result: null,
            },
          };
        },
      });

      const [first, second] = await Promise.all([
        service.startAutomaticGateRun(
          fixture.actors.productManager,
          fixture.requirementId,
          fixture.automaticRequest,
          fixture.requirementWrite.requirement.rowVersion,
          fixture.idempotencyKeys.automatic,
        ),
        service.startAutomaticGateRun(
          fixture.actors.productManager,
          fixture.requirementId,
          fixture.automaticRequest,
          fixture.requirementWrite.requirement.rowVersion,
          fixture.idempotencyKeys.automaticSecond,
        ),
      ]);

      expect(first.gateRun.id).toBe(second.gateRun.id);
      expect([first.reusedInProgress, second.reusedInProgress].sort()).toEqual([
        false,
        true,
      ]);
      expect(executeCount).toBe(1);
    });

    it('keeps a late PASS on the old baseline without advancing the requirement', async () => {
      const fixture = createT5Fixture(`${runId}_STALE`);
      await seed(fixture);
      const service = serviceFor(fixture, {
        getGateExecutionCapability: async () => ({
          status: 'AVAILABLE' as const,
          source: 'FIXTURE' as const,
          capabilityVersion: 'fixture/t5/stale',
          checkedAt: fixture.now,
          data: { executable: true as const },
        }),
        executeGate: async () => ({
          status: 'AVAILABLE' as const,
          source: 'FIXTURE' as const,
          capabilityVersion: 'fixture/t5/stale',
          checkedAt: fixture.now,
          data: {
            executionId: `${fixture.prefix}_EXTERNAL_STALE`,
            status: 'RUNNING' as const,
            result: null,
          },
        }),
      });
      const started = await service.startAutomaticGateRun(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.automaticRequest,
        fixture.requirementWrite.requirement.rowVersion,
        fixture.idempotencyKeys.automatic,
      );
      const newBaselineId = `${fixture.prefix}_BASELINE_2`;
      await database.transaction().execute(async (transaction) => {
        const scoped = transaction.withSchema(schemaName);
        await scoped
          .updateTable('material_baselines')
          .set({ status: 'HISTORICAL' })
          .where('id', '=', fixture.baselineId)
          .executeTakeFirstOrThrow();
        await scoped
          .insertInto('material_baselines')
          .values({
            id: newBaselineId,
            requirement_id: fixture.requirementId,
            version_number: 2,
            status: 'CURRENT',
            source_type: 'BUSINESS_FEEDBACK',
            source_description: null,
            material_purpose: 'FACT',
            sensitivity: 'INTERNAL',
            confirmed_by: fixture.actors.productManager.actorId,
            confirmed_at: fixture.now,
            created_at: fixture.now,
          })
          .execute();
        await scoped
          .updateTable('requirements')
          .set({
            current_baseline_id: newBaselineId,
            row_version: fixture.requirementWrite.requirement.rowVersion + 1,
            updated_at: fixture.now,
          })
          .where('id', '=', fixture.requirementId)
          .executeTakeFirstOrThrow();
      });

      const completed = await repository.completeGateRun({
        requirementId: fixture.requirementId,
        gateRunId: started.gateRun.id,
        result: 'PASS',
        checks: [
          {
            id: `${fixture.prefix}_STALE_CHECK`,
            gateRunId: started.gateRun.id,
            checkKey: 'automatic.aggregate',
            result: 'PASS',
            reason: null,
            ownerId: fixture.actors.productManager.actorId,
            closePoint: 'G0',
            createdAt: fixture.now,
          },
        ],
        evidence: [],
        completedAt: fixture.now,
        actorId: fixture.actors.productManager.actorId,
        gateTimelineEventId: `${fixture.prefix}_STALE_TIMELINE`,
        gateOutboxEventId: `${fixture.prefix}_STALE_OUTBOX`,
        advancementTimelineEventId: `${fixture.prefix}_STALE_ADV_TIMELINE`,
        advancementOutboxEventId: `${fixture.prefix}_STALE_ADV_OUTBOX`,
      });
      expect(completed.gateRun.gateRun.validity).toBe('STALE_BASELINE');
      expect(completed.requirement.requirement).toMatchObject({
        currentStage: 'G0',
        currentBaselineId: newBaselineId,
      });
      expect(completed.gateRun.advancement).toBeNull();
    });

    it('persists manual confirmation, checks, and current valid evidence', async () => {
      const fixture = createT5Fixture(`${runId}_MANUAL`);
      await seed(fixture, true);
      const result = await serviceFor(fixture).registerManualGateRun(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.manualRequest,
        fixture.requirementWrite.requirement.rowVersion,
        fixture.idempotencyKeys.manual,
      );
      expect(result).toMatchObject({
        gateRun: {
          mode: 'MANUAL',
          result: 'PASS',
          confirmedRole: 'BUSINESS_OWNER',
          confirmedBy: fixture.actors.businessOwner.actorId,
          evidence: [{ evidenceRefId: fixture.evidenceRefId }],
        },
        requirement: { currentStage: 'G1' },
      });
      expect(result.gateRun.checks).toHaveLength(2);

      const eventRows = await database
        .withSchema(schemaName)
        .selectFrom('outbox_events')
        .select('payload_summary')
        .where('aggregate_id', '=', result.gateRun.id)
        .execute();
      const summaries = JSON.stringify(eventRows);
      expect(summaries).not.toContain(fixture.manualRequest.registrationNote);
      expect(summaries).not.toContain(fixture.evidenceRefId);
      expect(summaries).not.toContain(fixture.manualRequest.checks[1]!.reason!);
    });

    it('rejects a manual database row without confirmation fields', async () => {
      const fixture = createT5Fixture(`${runId}_CONSTRAINT`);
      await seed(fixture);
      await expect(
        database
          .withSchema(schemaName)
          .insertInto('gate_runs')
          .values({
            id: `${fixture.prefix}_INVALID_MANUAL`,
            requirement_id: fixture.requirementId,
            baseline_id: fixture.baselineId,
            stage: 'G0',
            mode: 'MANUAL',
            status: 'IN_PROGRESS',
            result: null,
            validity: 'CURRENT',
            owner_id: fixture.actors.businessOwner.actorId,
            confirmed_role: null,
            confirmed_by: null,
            confirmed_at: null,
            started_at: fixture.now,
            completed_at: null,
            failure_reason: null,
            unknown_reason: null,
            registration_note: null,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('enforces UNKNOWN reasons and same-baseline evidence at the database boundary', async () => {
      const fixture = createT5Fixture(`${runId}_DB_INVARIANTS`);
      await seed(fixture);
      const scoped = database.withSchema(schemaName);
      const gateRunId = `${fixture.prefix}_AUTOMATIC_IN_PROGRESS`;
      await scoped
        .insertInto('gate_runs')
        .values({
          id: gateRunId,
          requirement_id: fixture.requirementId,
          baseline_id: fixture.baselineId,
          stage: 'G0',
          mode: 'AUTOMATIC',
          status: 'IN_PROGRESS',
          result: null,
          validity: 'CURRENT',
          owner_id: fixture.actors.productManager.actorId,
          confirmed_role: null,
          confirmed_by: null,
          confirmed_at: null,
          started_at: fixture.now,
          completed_at: null,
          failure_reason: null,
          unknown_reason: null,
          registration_note: null,
        })
        .execute();
      await expect(
        scoped
          .insertInto('gate_checks')
          .values({
            id: `${fixture.prefix}_UNKNOWN_WITHOUT_REASON`,
            gate_run_id: gateRunId,
            check_key: 'automatic.aggregate',
            result: 'UNKNOWN',
            reason: null,
            owner_id: fixture.actors.productManager.actorId,
            close_point: 'G0',
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23514' });

      const otherBaselineId = `${fixture.prefix}_BASELINE_HISTORICAL`;
      const otherEvidenceId = `${fixture.prefix}_EVIDENCE_OTHER_BASELINE`;
      await scoped
        .insertInto('material_baselines')
        .values({
          id: otherBaselineId,
          requirement_id: fixture.requirementId,
          version_number: 2,
          status: 'HISTORICAL',
          source_type: 'BUSINESS_FEEDBACK',
          source_description: null,
          material_purpose: 'FACT',
          sensitivity: 'INTERNAL',
          confirmed_by: fixture.actors.productManager.actorId,
          confirmed_at: fixture.now,
          created_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('material_refs')
        .values({
          id: otherEvidenceId,
          baseline_id: otherBaselineId,
          reference_type: 'PRODUCT_SPEC',
          source: 'SYNTHETIC_LOCAL_FIXTURE',
          version: '2',
          content_hash: null,
          location: `test://${otherEvidenceId}`,
          sensitivity: 'INTERNAL',
          validity: 'VALID',
        })
        .execute();
      await expect(
        scoped
          .insertInto('gate_run_evidence')
          .values({
            gate_run_id: gateRunId,
            baseline_id: fixture.baselineId,
            evidence_ref_id: otherEvidenceId,
            access_decision: 'ALLOWED',
            action_authorization_ref: null,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });
} else {
  describe('T5 GateRun persistence config', () => {
    it('requires DATABASE_URL for integration evidence', () => {
      expect(connectionString, 'DATABASE_URL is required').toBeTruthy();
    });
  });
}
