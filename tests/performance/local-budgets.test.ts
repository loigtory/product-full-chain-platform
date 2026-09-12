import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthorizationPort } from '@pfc/contracts';
import { createT5Fixture, createT7PerformanceFixture } from '@pfc/test-data';
import { buildServer } from '../../apps/server/src/app.ts';
import {
  createDependencyPorts,
  createUnavailableDependencyPorts,
} from '../../apps/server/src/dependencies/index.ts';
import { GateRunApplicationService } from '../../apps/server/src/gate-runs/application-service.ts';
import { RequirementApplicationService } from '../../apps/server/src/requirements/application-service.ts';
import { InMemoryRequirementRepository } from '../../apps/server/src/requirements/in-memory-repository.ts';
import { TimelineApplicationService } from '../../apps/server/src/timeline/application-service.ts';

function p95(samples: readonly number[]): number {
  const sorted = samples.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Infinity;
}

async function elapsed(operation: () => Promise<void>): Promise<number> {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

const metrics: Record<string, number> = {};

describe('T7 local engineering performance budgets', () => {
  const fixture = createT7PerformanceFixture('T7_PERFORMANCE', {
    requirementCount: 1_000,
    timelineEventCount: 100,
  });
  const repository = new InMemoryRequirementRepository(fixture.seedWrites);
  const authorizationPort: AuthorizationPort = {
    lookupRequirementAuthorization: async ({ actor, requirementId }) => ({
      status: 'AVAILABLE',
      source: 'FIXTURE',
      capabilityVersion: 'fixture/t7-performance/v1',
      checkedAt: fixture.now,
      data: {
        actorId: actor.actorId,
        requirementId,
        membership: { team: 'YES', requirement: 'YES', restricted: 'YES' },
        allowedActions: ['VIEW_REQUIREMENT'],
        approvedTransmissionTargets: [],
        actionAuthorizations: [],
      },
    }),
  };
  const unavailable = createUnavailableDependencyPorts(() => fixture.now);
  const requirementService = new RequirementApplicationService({
    repository,
    authorizationPort,
    deliverySummaryPort: unavailable.deliverySummary,
    gateExecutionPort: unavailable.gateExecution,
    now: () => fixture.now,
  });
  const timelineService = new TimelineApplicationService({
    repository,
    authorizationPort,
    now: () => fixture.now,
  });
  const server = buildServer({
    requirementService,
    timelineService,
    resolveActor: () => fixture.actor,
  });

  beforeAll(async () => server.ready(), 15_000);
  afterAll(async () => {
    await server.close();
    console.log(
      `T7_PERFORMANCE_RESULT list_p95_ms=${metrics.listP95?.toFixed(2)} detail_p95_ms=${metrics.detailP95?.toFixed(2)} timeline_p95_ms=${metrics.timelineP95?.toFixed(2)} sse_p95_ms=${metrics.sseP95?.toFixed(2)} command_p95_ms=${metrics.commandP95?.toFixed(2)}`,
    );
  });

  it('serves a 1,000-item worklist under 10 concurrent local reads', async () => {
    await server.inject({
      method: 'GET',
      url: '/api/v1/requirements?limit=50',
    });
    const samples = await Promise.all(
      Array.from({ length: 10 }, () =>
        elapsed(async () => {
          const response = await server.inject({
            method: 'GET',
            url: '/api/v1/requirements?limit=50',
          });
          expect(response.statusCode).toBe(200);
          expect(response.json().items).toHaveLength(50);
        }),
      ),
    );
    metrics.listP95 = p95(samples);
    expect(metrics.listP95).toBeLessThanOrEqual(500);
  }, 15_000);

  it('keeps detail, 100-event timeline pagination, and SSE replay within local budgets', async () => {
    const detailSamples: number[] = [];
    const timelineSamples: number[] = [];
    const sseSamples: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      detailSamples.push(
        await elapsed(async () => {
          const response = await server.inject({
            method: 'GET',
            url: `/api/v1/requirements/${fixture.timelineRequirementId}`,
          });
          expect(response.statusCode).toBe(200);
        }),
      );
      timelineSamples.push(
        await elapsed(async () => {
          const response = await server.inject({
            method: 'GET',
            url: `/api/v1/requirements/${fixture.timelineRequirementId}/timeline?limit=50`,
          });
          expect(response.statusCode).toBe(200);
          expect(response.json().items).toHaveLength(50);
        }),
      );
      sseSamples.push(
        await elapsed(async () => {
          const response = await server.inject({
            method: 'GET',
            url: `/api/v1/requirements/${fixture.timelineRequirementId}/events?after=0`,
          });
          expect(response.statusCode).toBe(200);
          expect(response.headers['content-type']).toContain(
            'text/event-stream',
          );
          expect(response.body).toContain('id:');
        }),
      );
    }
    metrics.detailP95 = p95(detailSamples);
    metrics.timelineP95 = p95(timelineSamples);
    metrics.sseP95 = p95(sseSamples);
    expect(metrics.detailP95).toBeLessThanOrEqual(800);
    expect(metrics.timelineP95).toBeLessThanOrEqual(800);
    expect(metrics.sseP95).toBeLessThanOrEqual(2_000);
  }, 15_000);

  it('confirms a command under budget and replays the same PASS 100 times with one advance', async () => {
    const gateFixture = createT5Fixture('T7_COMMAND_REPLAY');
    const gateRepository = new InMemoryRequirementRepository([
      gateFixture.requirementWrite,
    ]);
    const ports = createDependencyPorts(
      { appEnvironment: 'test', fixtureAdaptersEnabled: true },
      gateFixture.dependencyFixtures,
      () => gateFixture.now,
    );
    const service = new GateRunApplicationService({
      repository: gateRepository,
      authorizationPort: ports.authorization,
      artifactEvidencePort: ports.artifactEvidence,
      gateExecutionPort: ports.gateExecution,
      now: () => gateFixture.now,
      idFactory: gateFixture.createIdFactory(),
    });

    const initialDuration = await elapsed(async () => {
      const first = await service.startAutomaticGateRun(
        gateFixture.actors.productManager,
        gateFixture.requirementId,
        gateFixture.automaticRequest,
        gateFixture.requirementWrite.requirement.rowVersion,
        gateFixture.idempotencyKeys.automatic,
      );
      expect(first.requirement.currentStage).toBe('G1');
    });
    expect(initialDuration).toBeLessThanOrEqual(1_000);

    const replaySamples = await Promise.all(
      Array.from({ length: 100 }, () =>
        elapsed(async () => {
          const replay = await service.startAutomaticGateRun(
            gateFixture.actors.productManager,
            gateFixture.requirementId,
            gateFixture.automaticRequest,
            gateFixture.requirementWrite.requirement.rowVersion,
            gateFixture.idempotencyKeys.automatic,
          );
          expect(replay.replayed).toBe(true);
          expect(replay.requirement.currentStage).toBe('G1');
        }),
      ),
    );
    metrics.commandP95 = p95([initialDuration, ...replaySamples]);
    expect(metrics.commandP95).toBeLessThanOrEqual(1_000);
    expect(
      (
        await gateRepository.listGateRunRecordsByRequirement(
          gateFixture.requirementId,
        )
      ).length,
    ).toBe(1);
    const timeline = await gateRepository.listTimelineEvents({
      requirementId: gateFixture.requirementId,
      cursor: null,
      afterSequence: null,
      limit: 100,
    });
    expect(
      timeline.items.filter(
        ({ event }) => event.eventType === 'requirement.advanced',
      ),
    ).toHaveLength(1);
  }, 15_000);
});
