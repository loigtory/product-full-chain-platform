import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { QuestionApplicationService } from '../../apps/server/src/questions/index.ts';
import {
  PostgresLifecycleRepository,
  createDatabase,
  createLifecycleSchema,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createT4Fixture } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'T4_PERSISTENCE';
const schemaName = `codex_test_t4_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createT4Fixture(runId);

if (connectionString) {
  describe('T4 Question persistence', () => {
    const database = createDatabase({ connectionString });
    const repository = new PostgresLifecycleRepository(database, schemaName);
    const ports = createDependencyPorts(
      { appEnvironment: 'test', fixtureAdaptersEnabled: true },
      fixture.dependencyFixtures,
      () => fixture.now,
    );
    const service = new QuestionApplicationService({
      repository,
      authorizationPort: ports.authorization,
      now: () => fixture.now,
      idFactory: fixture.createIdFactory(),
    });

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      await repository.createRequirement(fixture.requirementWrite);
      const scoped = database.withSchema(schemaName);
      for (const record of fixture.questionRecords) {
        await scoped
          .insertInto('questions')
          .values({
            id: record.question.id,
            requirement_id: record.question.requirementId,
            baseline_id: record.question.baselineId,
            prompt: record.question.prompt,
            reason: record.question.reason,
            candidates: JSON.stringify(record.question.candidates),
            owner_id: record.question.ownerId,
            close_by_stage: record.question.closeByStage,
            status: record.question.status,
            current_decision_id: null,
            row_version: record.question.rowVersion,
            created_at: record.question.createdAt,
            updated_at: record.question.updatedAt,
          })
          .execute();
        for (const decision of record.decisions) {
          await scoped
            .insertInto('decisions')
            .values({
              id: decision.id,
              question_id: decision.questionId,
              decision_kind: decision.kind,
              raw_answer: decision.rawAnswer,
              explanation: decision.explanation,
              scope: decision.scope,
              version_number: decision.versionNumber,
              confirmed_role: decision.confirmedRole,
              confirmed_by: decision.confirmedBy,
              confirmed_at: decision.confirmedAt,
              validity: decision.validity,
              supersedes_decision_id: decision.supersedesDecisionId,
              created_at: decision.createdAt,
            })
            .execute();
        }
        if (record.question.currentDecisionId) {
          await scoped
            .updateTable('questions')
            .set({ current_decision_id: record.question.currentDecisionId })
            .where('id', '=', record.question.id)
            .executeTakeFirstOrThrow();
        }
      }
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('answers and confirms atomically without changing Requirement stage', async () => {
      const answered = await service.answerQuestion(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.questionIds.open,
        fixture.inputs.answer,
        0,
        fixture.idempotencyKeys.answer,
      );
      const confirmed = await service.confirmQuestion(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.questionIds.open,
        {
          decisionId: answered.question.currentDecisionId!,
          confirmedRole: 'BUSINESS_OWNER',
        },
        1,
        fixture.idempotencyKeys.confirm,
      );
      const requirement = await repository.findRequirementById(
        fixture.requirementId,
      );

      expect(confirmed.question).toMatchObject({
        status: 'CONFIRMED',
        rowVersion: 2,
        decisions: [
          expect.objectContaining({ confirmedRole: 'BUSINESS_OWNER' }),
        ],
      });
      expect(requirement).toMatchObject({
        currentStage: 'G0',
        rowVersion: fixture.requirementWrite.requirement.rowVersion,
      });

      const scoped = database.withSchema(schemaName);
      const decisions = await scoped
        .selectFrom('decisions')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('question_id', '=', fixture.questionIds.open)
        .executeTakeFirstOrThrow();
      const events = await scoped
        .selectFrom('timeline_events')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('aggregate_id', '=', fixture.questionIds.open)
        .executeTakeFirstOrThrow();
      expect(Number(decisions.count)).toBe(1);
      expect(Number(events.count)).toBe(2);
    });

    it('replays one return command and keeps the reason out of outbox summaries', async () => {
      const first = await service.returnQuestion(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.questionIds.returnable,
        fixture.inputs.returned,
        1,
        fixture.idempotencyKeys.returned,
      );
      const replay = await service.returnQuestion(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.questionIds.returnable,
        fixture.inputs.returned,
        1,
        fixture.idempotencyKeys.returned,
      );

      expect(first.replayed).toBe(false);
      expect(replay).toMatchObject({
        replayed: true,
        question: { status: 'OPEN', rowVersion: 2 },
      });
      const scoped = database.withSchema(schemaName);
      const timeline = await scoped
        .selectFrom('timeline_events')
        .select('after_summary')
        .where('event_type', '=', 'question.returned')
        .executeTakeFirstOrThrow();
      const outbox = await scoped
        .selectFrom('outbox_events')
        .select('payload_summary')
        .where('event_type', '=', 'question.returned')
        .executeTakeFirstOrThrow();
      expect(timeline.after_summary).toMatchObject({
        returnReason: fixture.inputs.returned.reason,
      });
      expect(JSON.stringify(outbox.payload_summary)).not.toContain(
        fixture.inputs.returned.reason,
      );
    });

    it('rejects a partially confirmed Decision at the database boundary', async () => {
      const scoped = database.withSchema(schemaName);
      await expect(
        scoped
          .updateTable('decisions')
          .set({ confirmed_role: 'BUSINESS_OWNER' })
          .where('id', '=', fixture.decisionIds.returnable)
          .execute(),
      ).rejects.toMatchObject({ code: '23514' });

      const unchanged = await scoped
        .selectFrom('decisions')
        .select(['confirmed_role', 'confirmed_by', 'confirmed_at'])
        .where('id', '=', fixture.decisionIds.returnable)
        .executeTakeFirstOrThrow();
      expect(unchanged).toEqual({
        confirmed_role: null,
        confirmed_by: null,
        confirmed_at: null,
      });
    });

    it('serializes concurrent confirmations with different keys', async () => {
      const concurrentFixture = createT4Fixture(`${runId}_CONCURRENT`);
      const record = concurrentFixture.questionRecords.find(
        (item) => item.question.id === concurrentFixture.questionIds.returnable,
      )!;
      const scoped = database.withSchema(schemaName);
      await repository.createRequirement(concurrentFixture.requirementWrite);
      await scoped
        .insertInto('questions')
        .values({
          id: record.question.id,
          requirement_id: record.question.requirementId,
          baseline_id: record.question.baselineId,
          prompt: record.question.prompt,
          reason: record.question.reason,
          candidates: JSON.stringify(record.question.candidates),
          owner_id: record.question.ownerId,
          close_by_stage: record.question.closeByStage,
          status: record.question.status,
          current_decision_id: null,
          row_version: record.question.rowVersion,
          created_at: record.question.createdAt,
          updated_at: record.question.updatedAt,
        })
        .execute();
      const decision = record.decisions[0];
      await scoped
        .insertInto('decisions')
        .values({
          id: decision.id,
          question_id: decision.questionId,
          decision_kind: decision.kind,
          raw_answer: decision.rawAnswer,
          explanation: decision.explanation,
          scope: decision.scope,
          version_number: decision.versionNumber,
          confirmed_role: null,
          confirmed_by: null,
          confirmed_at: null,
          validity: decision.validity,
          supersedes_decision_id: null,
          created_at: decision.createdAt,
        })
        .execute();
      await scoped
        .updateTable('questions')
        .set({ current_decision_id: decision.id })
        .where('id', '=', record.question.id)
        .executeTakeFirstOrThrow();

      const concurrentPorts = createDependencyPorts(
        { appEnvironment: 'test', fixtureAdaptersEnabled: true },
        concurrentFixture.dependencyFixtures,
        () => concurrentFixture.now,
      );
      const concurrentService = new QuestionApplicationService({
        repository,
        authorizationPort: concurrentPorts.authorization,
        now: () => concurrentFixture.now,
        idFactory: concurrentFixture.createIdFactory(),
      });
      const command = (key: string) =>
        concurrentService.confirmQuestion(
          concurrentFixture.actors.businessOwner,
          concurrentFixture.requirementId,
          concurrentFixture.questionIds.returnable,
          {
            decisionId: concurrentFixture.decisionIds.returnable,
            confirmedRole: 'BUSINESS_OWNER',
          },
          1,
          key,
        );
      const results = await Promise.allSettled([
        command(`${concurrentFixture.prefix}_CONCURRENT_1`),
        command(`${concurrentFixture.prefix}_CONCURRENT_2`),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ code: 'VERSION_CONFLICT' }),
        }),
      ]);
    });

    it('preserves superseded Question and Decision while creating one replacement', async () => {
      const result = await service.supersedeQuestion(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.questionIds.confirmed,
        fixture.inputs.supersede,
        2,
        fixture.idempotencyKeys.supersede,
      );
      const scoped = database.withSchema(schemaName);
      const oldQuestion = await scoped
        .selectFrom('questions')
        .select(['status', 'current_decision_id'])
        .where('id', '=', fixture.questionIds.confirmed)
        .executeTakeFirstOrThrow();
      const oldDecision = await scoped
        .selectFrom('decisions')
        .select(['validity', 'raw_answer'])
        .where('id', '=', fixture.decisionIds.confirmed)
        .executeTakeFirstOrThrow();

      expect(result.question).toMatchObject({ status: 'CONFIRMED' });
      expect(oldQuestion.status).toBe('SUPERSEDED');
      expect(oldQuestion.current_decision_id).toBe(
        fixture.decisionIds.confirmed,
      );
      expect(oldDecision).toEqual({
        validity: 'SUPERSEDED',
        raw_answer: '按预算结算',
      });
    });
  });
} else {
  describe('T4 Question persistence config', () => {
    it('requires DATABASE_URL for integration evidence', () => {
      expect(connectionString, 'DATABASE_URL is required').toBeTruthy();
    });
  });
}
