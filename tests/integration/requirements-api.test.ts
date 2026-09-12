import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../apps/server/src/app.ts';
import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import {
  InMemoryRequirementRepository,
  RequirementApplicationService,
} from '../../apps/server/src/requirements/index.ts';
import { createT3Fixture } from '../../packages/test-data/src/index.ts';

const fixture = createT3Fixture('T3_API');
const servers: Array<ReturnType<typeof buildServer>> = [];

function createApi() {
  const repository = new InMemoryRequirementRepository(fixture.seedWrites);
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
  const server = buildServer({
    requirementService: service,
    resolveActor: async () => fixture.actors.productManager,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('T3 requirement HTTP API', () => {
  it('reports T3 business capability when the application service is installed', async () => {
    const response = await createApi().inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      stage: 't3',
      businessFeatures: true,
    });
  });

  it('returns an authorized body-free list with explicit partial warnings', async () => {
    const response = await createApi().inject({
      method: 'GET',
      url: '/api/v1/requirements?scope=ALL&search=&limit=20',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ partial: true });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).not.toHaveProperty('originalIdea');
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warningCode: 'DELIVERY_SUMMARY_UNKNOWN' }),
      ]),
    );
  });

  it('denies a detail without returning its name or original idea', async () => {
    const response = await createApi().inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementIds.denied}`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'PERMISSION_DENIED',
      retryable: false,
      recoveryAction: 'RETURN_TO_WORKLIST',
    });
    expect(response.body).not.toContain('T3 合成需求 DENIED');
    expect(response.body).not.toContain('synthetic local-only idea');
  });

  it('creates and safely replays a draft with the required idempotency key', async () => {
    const server = createApi();
    const request = {
      method: 'POST' as const,
      url: '/api/v1/requirements',
      headers: {
        'idempotency-key': fixture.idempotencyKeys.incomplete,
      },
      payload: fixture.createInputs.incomplete,
    };
    const created = await server.inject(request);
    const replay = await server.inject(request);

    expect(created.statusCode).toBe(201);
    expect(created.headers.location).toContain('/api/v1/requirements/');
    expect(created.headers.etag).toBe('"0"');
    expect(created.json()).toMatchObject({
      replayed: false,
      requirement: { gateProjection: 'BLOCK', currentBaseline: null },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      replayed: true,
      requirement: { id: created.json().requirement.id },
    });
  });

  it('rejects missing keys, invalid input, and key reuse without partial records', async () => {
    const server = createApi();
    const missingKey = await server.inject({
      method: 'POST',
      url: '/api/v1/requirements',
      payload: fixture.createInputs.incomplete,
    });
    const invalid = await server.inject({
      method: 'POST',
      url: '/api/v1/requirements',
      headers: { 'idempotency-key': 'CODEx_TEST_T3_API_INVALID' },
      payload: { name: '', originalIdea: '' },
    });
    await server.inject({
      method: 'POST',
      url: '/api/v1/requirements',
      headers: { 'idempotency-key': fixture.idempotencyKeys.conflict },
      payload: fixture.createInputs.incomplete,
    });
    const conflict = await server.inject({
      method: 'POST',
      url: '/api/v1/requirements',
      headers: { 'idempotency-key': fixture.idempotencyKeys.conflict },
      payload: fixture.createInputs.complete,
    });

    for (const response of [missingKey, invalid]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        retryable: false,
        recoveryAction: 'CORRECT_INPUT',
      });
    }
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('completes an incomplete draft with If-Match and exposes the new ETag', async () => {
    const server = createApi();
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/requirements/${fixture.requirementIds.incomplete}/g0-registration`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.completeRegistration,
        'if-match': '"0"',
      },
      payload: fixture.completeRegistration,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.json()).toMatchObject({
      replayed: false,
      requirement: {
        gateProjection: 'NOT_STARTED',
        rowVersion: 1,
        missingFields: [],
        currentBaseline: {
          sourceType: 'OTHER',
          sourceDescription: '来自跨部门专题讨论，原分类无法准确覆盖',
        },
      },
    });
  });

  it('reads a submission outcome without creating a second draft', async () => {
    const server = createApi();
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/requirements',
      headers: { 'idempotency-key': fixture.idempotencyKeys.recovery },
      payload: fixture.createInputs.incomplete,
    });
    const recovery = await server.inject({
      method: 'GET',
      url: `/api/v1/requirement-submissions/${fixture.idempotencyKeys.recovery}`,
    });

    expect(recovery.statusCode).toBe(200);
    expect(recovery.json()).toEqual({
      status: 'CREATED',
      existingResourceId: created.json().requirement.id,
    });
  });

  it('fails closed when no T3 application service is installed', async () => {
    const server = buildServer();
    servers.push(server);
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/requirements',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
      recoveryAction: 'RETRY',
    });
  });
});
