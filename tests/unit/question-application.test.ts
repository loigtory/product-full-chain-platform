import { describe, expect, it } from 'vitest';

import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import {
  InMemoryRequirementRepository,
  RequirementApplicationService,
} from '../../apps/server/src/requirements/index.ts';
import { QuestionApplicationService } from '../../apps/server/src/questions/index.ts';
import { createT4Fixture } from '../../packages/test-data/src/index.ts';

const fixture = createT4Fixture('T4_APPLICATION');

function createServices() {
  const repository = new InMemoryRequirementRepository(
    [fixture.requirementWrite],
    fixture.questionRecords,
  );
  const ports = createDependencyPorts(
    { appEnvironment: 'test', fixtureAdaptersEnabled: true },
    fixture.dependencyFixtures,
    () => fixture.now,
  );
  const shared = {
    repository,
    authorizationPort: ports.authorization,
    now: () => fixture.now,
    idFactory: fixture.createIdFactory(),
  };
  return {
    repository,
    requirements: new RequirementApplicationService({
      ...shared,
      deliverySummaryPort: ports.deliverySummary,
    }),
    questions: new QuestionApplicationService(shared),
  };
}

describe('T4 Question application service', () => {
  it('returns current-baseline questions only after requirement authorization', async () => {
    const { requirements } = createServices();
    const detail = await requirements.getRequirement(
      fixture.actors.businessOwner,
      fixture.requirementId,
    );

    expect(detail.questions.map((question) => question.id)).toEqual([
      fixture.questionIds.open,
      fixture.questionIds.returnable,
      fixture.questionIds.confirmed,
    ]);
    expect(detail.questions[1]).toMatchObject({
      status: 'ANSWERED',
      decisions: [
        expect.objectContaining({
          rawAnswer: '按预算结算',
          confirmedAt: null,
        }),
      ],
    });
  });

  it('answers and confirms only the displayed Question scope without changing Requirement stage', async () => {
    const { questions, requirements } = createServices();
    const answered = await questions.answerQuestion(
      fixture.actors.businessOwner,
      fixture.requirementId,
      fixture.questionIds.open,
      fixture.inputs.answer,
      0,
      fixture.idempotencyKeys.answer,
    );
    const confirmed = await questions.confirmQuestion(
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
    const detail = await requirements.getRequirement(
      fixture.actors.businessOwner,
      fixture.requirementId,
    );

    expect(answered).toMatchObject({
      action: 'ANSWER',
      replayed: false,
      question: { status: 'ANSWERED', rowVersion: 1 },
    });
    expect(confirmed).toMatchObject({
      action: 'CONFIRM',
      replayed: false,
      question: {
        status: 'CONFIRMED',
        rowVersion: 2,
        decisions: [
          expect.objectContaining({
            rawAnswer: fixture.inputs.answer.rawAnswer,
            confirmedRole: 'BUSINESS_OWNER',
          }),
        ],
      },
    });
    expect(detail.currentStage).toBe('G0');
    expect(detail.gateProjection).toBe('NOT_STARTED');
  });

  it('returns an answer to OPEN while preserving its original Decision', async () => {
    const { questions } = createServices();
    const result = await questions.returnQuestion(
      fixture.actors.businessOwner,
      fixture.requirementId,
      fixture.questionIds.returnable,
      fixture.inputs.returned,
      1,
      fixture.idempotencyKeys.returned,
    );

    expect(result.question).toMatchObject({
      status: 'OPEN',
      currentDecisionId: fixture.decisionIds.returnable,
      decisions: [expect.objectContaining({ rawAnswer: '按预算结算' })],
    });
  });

  it('supersedes old records and returns a new confirmed Question', async () => {
    const { questions, requirements } = createServices();
    const result = await questions.supersedeQuestion(
      fixture.actors.businessOwner,
      fixture.requirementId,
      fixture.questionIds.confirmed,
      fixture.inputs.supersede,
      2,
      fixture.idempotencyKeys.supersede,
    );
    const detail = await requirements.getRequirement(
      fixture.actors.businessOwner,
      fixture.requirementId,
    );
    const oldQuestion = detail.questions.find(
      (question) => question.id === fixture.questionIds.confirmed,
    );

    expect(result.question).toMatchObject({
      status: 'CONFIRMED',
      decisions: [
        expect.objectContaining({
          rawAnswer: fixture.inputs.supersede.rawAnswer,
          supersedesDecisionId: fixture.decisionIds.confirmed,
        }),
      ],
    });
    expect(result.question.id).not.toBe(fixture.questionIds.confirmed);
    expect(oldQuestion).toMatchObject({
      status: 'SUPERSEDED',
      supersededByQuestionId: result.question.id,
      decisions: [expect.objectContaining({ validity: 'SUPERSEDED' })],
    });
  });

  it('defers with a reason and reopen condition without reporting CONFIRMED', async () => {
    const { questions } = createServices();
    const result = await questions.deferQuestion(
      fixture.actors.businessOwner,
      fixture.requirementId,
      fixture.questionIds.open,
      fixture.inputs.defer,
      0,
      fixture.idempotencyKeys.defer,
    );

    expect(result.question).toMatchObject({
      status: 'DEFERRED',
      decisions: [
        expect.objectContaining({
          kind: 'DEFERRAL',
          rawAnswer: fixture.inputs.defer.reason,
          explanation: fixture.inputs.defer.reopenCondition,
        }),
      ],
    });
  });

  it('replays the same command, rejects key reuse, and rejects a stale version', async () => {
    const { questions } = createServices();
    const first = await questions.answerQuestion(
      fixture.actors.businessOwner,
      fixture.requirementId,
      fixture.questionIds.open,
      fixture.inputs.answer,
      0,
      fixture.idempotencyKeys.answer,
    );
    const replay = await questions.answerQuestion(
      fixture.actors.businessOwner,
      fixture.requirementId,
      fixture.questionIds.open,
      fixture.inputs.answer,
      0,
      fixture.idempotencyKeys.answer,
    );

    expect(replay).toMatchObject({
      replayed: true,
      question: { id: first.question.id, rowVersion: 1 },
    });
    await expect(
      questions.answerQuestion(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.questionIds.open,
        { ...fixture.inputs.answer, rawAnswer: '另一答案' },
        0,
        fixture.idempotencyKeys.answer,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      questions.returnQuestion(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.questionIds.returnable,
        fixture.inputs.returned,
        9,
        fixture.idempotencyKeys.conflict,
      ),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('denies a non-owner action before reading Question content', async () => {
    const { questions, repository } = createServices();

    await expect(
      questions.confirmQuestion(
        fixture.actors.member,
        fixture.requirementId,
        fixture.questionIds.returnable,
        fixture.inputs.confirm,
        1,
        fixture.idempotencyKeys.confirm,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(repository.questionReadCount(fixture.questionIds.returnable)).toBe(
      0,
    );
  });
});
