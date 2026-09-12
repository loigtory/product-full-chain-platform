import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../apps/server/src/app.ts';
import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { MaterialImpactApplicationService } from '../../apps/server/src/material-impacts/index.ts';
import {
  InMemoryRequirementRepository,
  RequirementApplicationService,
} from '../../apps/server/src/requirements/index.ts';
import { TimelineApplicationService } from '../../apps/server/src/timeline/index.ts';
import { createT6Fixture } from '../../packages/test-data/src/index.ts';

const servers: Array<ReturnType<typeof buildServer>> = [];

function harness(runId: string) {
  const fixture = createT6Fixture(runId);
  const repository = new InMemoryRequirementRepository(
    [fixture.requirementWrite],
    [],
    fixture.gateRuns,
  );
  const ports = createDependencyPorts(
    { appEnvironment: 'test', fixtureAdaptersEnabled: true },
    fixture.dependencyFixtures,
    () => fixture.now,
  );
  const materialImpactService = new MaterialImpactApplicationService({
    repository,
    authorizationPort: ports.authorization,
    now: () => fixture.now,
    idFactory: fixture.createIdFactory(),
  });
  const timelineService = new TimelineApplicationService({
    repository,
    authorizationPort: ports.authorization,
    now: () => fixture.now,
  });
  const actors = fixture.actors;
  const server = buildServer({
    requirementService: new RequirementApplicationService({
      repository,
      authorizationPort: ports.authorization,
      deliverySummaryPort: ports.deliverySummary,
      gateExecutionPort: ports.gateExecution,
      now: () => fixture.now,
    }),
    materialImpactService,
    timelineService,
    resolveActor: async (request) => {
      const key = request.headers['x-test-actor'];
      if (key === 'business') return actors.businessOwner;
      if (key === 'outsider') return actors.outsider;
      return actors.productManager;
    },
  });
  servers.push(server);
  return { fixture, repository, server };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('T6 material impact and timeline HTTP API', () => {
  it('keeps a pending candidate inactive, then atomically switches and exposes history', async () => {
    const { fixture, server } = harness('T6_API_SWITCH');
    const created = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/material-impact-assessments`,
      headers: { 'idempotency-key': fixture.idempotencyKeys.create },
      payload: fixture.createRequest,
    });
    const impactId = created.json().assessment.id as string;
    const before = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}`,
    });
    const confirmed = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/material-impact-assessments/${impactId}/confirmations`,
      headers: {
        'x-test-actor': 'business',
        'idempotency-key': fixture.idempotencyKeys.confirm,
        'if-match': '"4"',
      },
      payload: fixture.impactConfirmation,
    });
    const after = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}`,
      headers: { 'x-test-actor': 'business' },
    });

    expect(
      (await server.inject({ method: 'GET', url: '/health' })).json(),
    ).toEqual({
      status: 'ok',
      stage: 't6',
      businessFeatures: true,
    });
    expect(created.statusCode).toBe(201);
    expect(before.json()).toMatchObject({
      currentStage: 'G3',
      currentBaseline: { id: fixture.baselineId },
      materialImpacts: [{ id: impactId, status: 'PENDING' }],
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json()).toMatchObject({
      assessment: { decision: 'IMPACTS', status: 'CONFIRMED' },
      requirement: { currentStage: 'G1', rowVersion: 5 },
    });
    expect(after.json()).toMatchObject({
      currentStage: 'G1',
      currentBaseline: { versionNumber: 2 },
      materialBaselines: [{ versionNumber: 2 }, { versionNumber: 1 }],
      materialImpacts: [
        {
          id: impactId,
          decision: 'IMPACTS',
          invalidatedGateRunIds: expect.arrayContaining([
            `${fixture.prefix}_GATE_G1`,
            `${fixture.prefix}_GATE_G3`,
          ]),
        },
      ],
    });
  });

  it('paginates timeline events and replays SSE after Last-Event-ID', async () => {
    const { fixture, server } = harness('T6_API_SSE');
    const created = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/material-impact-assessments`,
      headers: { 'idempotency-key': fixture.idempotencyKeys.create },
      payload: fixture.createRequest,
    });
    const impactId = created.json().assessment.id as string;
    await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/material-impact-assessments/${impactId}/confirmations`,
      headers: {
        'x-test-actor': 'business',
        'idempotency-key': fixture.idempotencyKeys.confirm,
        'if-match': '4',
      },
      payload: fixture.impactConfirmation,
    });
    const page = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}/timeline?limit=2`,
      headers: { 'x-test-actor': 'business' },
    });
    const items = page.json().items as Array<{
      sequence: number;
      type: string;
    }>;
    const oldestSequence = Math.min(...items.map((item) => item.sequence));
    const replay = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}/events`,
      headers: {
        'x-test-actor': 'business',
        'last-event-id': String(oldestSequence),
      },
    });
    const reset = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}/events`,
      headers: { 'x-test-actor': 'business', 'last-event-id': '999999' },
    });

    expect(page.statusCode).toBe(200);
    expect(items.map((item) => item.type)).toEqual([
      'baseline.switched',
      'material-impact.created',
    ]);
    expect(replay.headers['content-type']).toContain('text/event-stream');
    expect(replay.body).toContain('baseline.switched');
    expect(replay.body).not.toContain(fixture.impactConfirmation.reason);
    expect(reset.body).toContain('stream.reset-required');
  });

  it('re-authorizes timeline and SSE requests without leaking event summaries', async () => {
    const { fixture, server } = harness('T6_API_REVOKED');
    const timeline = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}/timeline`,
      headers: { 'x-test-actor': 'outsider' },
    });
    const events = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}/events`,
      headers: { 'x-test-actor': 'outsider' },
    });

    expect(timeline.statusCode).toBe(403);
    expect(events.statusCode).toBe(403);
    expect(timeline.json()).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(events.body).not.toContain(
      fixture.requirementWrite.requirement.name,
    );
  });
});
