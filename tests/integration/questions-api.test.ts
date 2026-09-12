import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../apps/server/src/app.ts';
import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { QuestionApplicationService } from '../../apps/server/src/questions/index.ts';
import {
  InMemoryRequirementRepository,
  RequirementApplicationService,
} from '../../apps/server/src/requirements/index.ts';
import { createT4Fixture } from '../../packages/test-data/src/index.ts';

const fixture = createT4Fixture('T4_API');
const servers: Array<ReturnType<typeof buildServer>> = [];

function createApi(actor = fixture.actors.businessOwner) {
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
  const server = buildServer({
    requirementService: new RequirementApplicationService({
      ...shared,
      deliverySummaryPort: ports.deliverySummary,
    }),
    questionService: new QuestionApplicationService(shared),
    resolveActor: async () => actor,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('T4 Question HTTP API', () => {
  it('reports T4 and exposes authorized Question history in Requirement detail', async () => {
    const server = createApi();
    const health = await server.inject({ method: 'GET', url: '/health' });
    const detail = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}`,
    });

    expect(health.json()).toEqual({
      status: 'ok',
      stage: 't4',
      businessFeatures: true,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.questionIds.returnable,
          status: 'ANSWERED',
          decisions: [expect.objectContaining({ rawAnswer: '按预算结算' })],
        }),
      ]),
    );
  });

  it('answers and confirms with Question If-Match and idempotency headers', async () => {
    const server = createApi();
    const answered = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/questions/${fixture.questionIds.open}/answers`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.answer,
        'if-match': '"0"',
      },
      payload: fixture.inputs.answer,
    });
    const decisionId = answered.json().question.currentDecisionId;
    const confirmed = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/questions/${fixture.questionIds.open}/confirmations`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.confirm,
        'if-match': '"1"',
      },
      payload: { decisionId, confirmedRole: 'BUSINESS_OWNER' },
    });

    expect(answered.statusCode).toBe(200);
    expect(answered.headers.etag).toBe('"1"');
    expect(answered.json()).toMatchObject({
      action: 'ANSWER',
      replayed: false,
      question: { status: 'ANSWERED' },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.headers.etag).toBe('"2"');
    expect(confirmed.json()).toMatchObject({
      action: 'CONFIRM',
      question: {
        status: 'CONFIRMED',
        decisions: [
          expect.objectContaining({ confirmedRole: 'BUSINESS_OWNER' }),
        ],
      },
    });
  });

  it('supports return, deferral, and supersession without touching GateRun', async () => {
    const returned = await createApi().inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/questions/${fixture.questionIds.returnable}/returns`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.returned,
        'if-match': '"1"',
      },
      payload: fixture.inputs.returned,
    });
    const deferred = await createApi().inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/questions/${fixture.questionIds.open}/deferrals`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.defer,
        'if-match': '"0"',
      },
      payload: fixture.inputs.defer,
    });
    const superseded = await createApi().inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/questions/${fixture.questionIds.confirmed}/supersessions`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.supersede,
        'if-match': '"2"',
      },
      payload: fixture.inputs.supersede,
    });

    expect(returned.json()).toMatchObject({
      action: 'RETURN',
      question: { status: 'OPEN' },
    });
    expect(deferred.json()).toMatchObject({
      action: 'DEFER',
      question: { status: 'DEFERRED' },
    });
    expect(superseded.json()).toMatchObject({
      action: 'SUPERSEDE',
      question: { status: 'CONFIRMED' },
    });
  });

  it('rejects missing headers and stale versions with stable safe errors', async () => {
    const server = createApi();
    const missing = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/questions/${fixture.questionIds.open}/answers`,
      payload: fixture.inputs.answer,
    });
    const stale = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/questions/${fixture.questionIds.returnable}/confirmations`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.confirm,
        'if-match': '"9"',
      },
      payload: fixture.inputs.confirm,
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      recoveryAction: 'CORRECT_INPUT',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'VERSION_CONFLICT',
      currentVersion: 1,
      recoveryAction: 'RELOAD_CURRENT',
    });
    expect(stale.body).not.toContain('按预算结算');
  });

  it('denies a member without confirmation action and returns no Question body', async () => {
    const response = await createApi(fixture.actors.member).inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/questions/${fixture.questionIds.returnable}/confirmations`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.confirm,
        'if-match': '"1"',
      },
      payload: fixture.inputs.confirm,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(response.body).not.toContain('RETURNABLE');
    expect(response.body).not.toContain('按预算结算');
  });
});
