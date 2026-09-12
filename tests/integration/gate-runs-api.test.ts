import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../apps/server/src/app.ts';
import {
  createDependencyPorts,
  createUnavailableDependencyPorts,
} from '../../apps/server/src/dependencies/index.ts';
import { GateRunApplicationService } from '../../apps/server/src/gate-runs/index.ts';
import {
  InMemoryRequirementRepository,
  RequirementApplicationService,
} from '../../apps/server/src/requirements/index.ts';
import { createT5Fixture } from '../../packages/test-data/src/index.ts';

const fixture = createT5Fixture('T5_API');
const servers: Array<ReturnType<typeof buildServer>> = [];

function createApi(input?: {
  actor?: (typeof fixture.actors)[keyof typeof fixture.actors];
  automaticUnavailable?: boolean;
}) {
  const repository = new InMemoryRequirementRepository([
    fixture.requirementWrite,
  ]);
  const ports = createDependencyPorts(
    { appEnvironment: 'test', fixtureAdaptersEnabled: true },
    fixture.dependencyFixtures,
    () => fixture.now,
  );
  const gateExecutionPort = input?.automaticUnavailable
    ? createUnavailableDependencyPorts(() => fixture.now).gateExecution
    : ports.gateExecution;
  const gateRunService = new GateRunApplicationService({
    repository,
    authorizationPort: ports.authorization,
    artifactEvidencePort: ports.artifactEvidence,
    gateExecutionPort,
    now: () => fixture.now,
    idFactory: fixture.createIdFactory(),
  });
  const server = buildServer({
    requirementService: new RequirementApplicationService({
      repository,
      authorizationPort: ports.authorization,
      deliverySummaryPort: ports.deliverySummary,
      gateExecutionPort,
      now: () => fixture.now,
    }),
    gateRunService,
    resolveActor: async () => input?.actor ?? fixture.actors.productManager,
  });
  servers.push(server);
  return { server, repository };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('T5 GateRun HTTP API', () => {
  it('starts an automatic run, advances once, and exposes a recoverable result', async () => {
    const { server } = createApi();
    const health = await server.inject({ method: 'GET', url: '/health' });
    const started = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/gate-runs/automatic`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.automatic,
        'if-match': `"${fixture.requirementWrite.requirement.rowVersion}"`,
      },
      payload: fixture.automaticRequest,
    });
    const replayed = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/gate-runs/automatic`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.automatic,
        'if-match': `"${fixture.requirementWrite.requirement.rowVersion}"`,
      },
      payload: fixture.automaticRequest,
    });
    const gateRunId = started.json().gateRun.id as string;
    const recovered = await server.inject({
      method: 'GET',
      url: `/api/v1/requirements/${fixture.requirementId}/gate-runs/${gateRunId}`,
    });

    expect(health.json()).toEqual({
      status: 'ok',
      stage: 't5',
      businessFeatures: true,
    });
    expect(started.statusCode).toBe(201);
    expect(started.headers.location).toContain(gateRunId);
    expect(started.json()).toMatchObject({
      replayed: false,
      gateRun: { status: 'COMPLETED', result: 'PASS' },
      requirement: { currentStage: 'G1' },
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({
      replayed: true,
      gateRun: { id: gateRunId },
      requirement: { currentStage: 'G1' },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      gateRun: { id: gateRunId, result: 'PASS' },
    });
  });

  it('registers a manual run with evidence and responsibility confirmation', async () => {
    const { server } = createApi({ actor: fixture.actors.businessOwner });
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/gate-runs/manual`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.manual,
        'if-match': `"${fixture.requirementWrite.requirement.rowVersion}"`,
      },
      payload: fixture.manualRequest,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      gateRun: {
        mode: 'MANUAL',
        result: 'PASS',
        confirmedRole: 'BUSINESS_OWNER',
        evidence: [{ evidenceRefId: fixture.evidenceRefId }],
      },
      requirement: { currentStage: 'G1' },
    });
  });

  it('rejects missing concurrency headers and an invalid overall N/A result', async () => {
    const { server } = createApi({ actor: fixture.actors.businessOwner });
    const missingHeaders = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/gate-runs/manual`,
      payload: fixture.manualRequest,
    });
    const invalidResult = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/gate-runs/manual`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.manual,
        'if-match': `"${fixture.requirementWrite.requirement.rowVersion}"`,
      },
      payload: { ...fixture.manualRequest, result: 'NOT_APPLICABLE' },
    });

    expect(missingHeaders.statusCode).toBe(400);
    expect(missingHeaders.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(invalidResult.statusCode).toBe(400);
    expect(invalidResult.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('returns 503 and creates no run when automatic execution is unavailable', async () => {
    const { server, repository } = createApi({ automaticUnavailable: true });
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/requirements/${fixture.requirementId}/gate-runs/automatic`,
      headers: {
        'idempotency-key': fixture.idempotencyKeys.automatic,
        'if-match': `"${fixture.requirementWrite.requirement.rowVersion}"`,
      },
      payload: fixture.automaticRequest,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      recoveryAction: 'RETRY',
    });
    await expect(
      repository.listGateRunRecordsByRequirement(fixture.requirementId),
    ).resolves.toEqual([]);
  });
});
