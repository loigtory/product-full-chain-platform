import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../apps/server/src/app.ts';
import {
  createExperienceActor,
  createExperienceDependencyPorts,
} from '../../apps/server/src/local-experience.ts';
import { OperationsApplicationService } from '../../apps/server/src/operations/application-service.ts';
import type { OperationsRepositoryPort } from '../../apps/server/src/operations/repository-port.ts';

const now = '2026-09-05T12:30:00.000Z';
const requirementId = 'CODEx_TEST_EXPERIENCE_UI_R6_REQUIREMENT';
const repository: OperationsRepositoryPort = {
  listGateCenterItems: vi.fn(async () => ({
    items: [
      {
        key: `CURRENT:${requirementId}`,
        requirementId,
        requirementName: '聚合门禁需求',
        requirementStage: 'G3',
        stage: 'G3',
        baselineId: 'CODEx_TEST_EXPERIENCE_UI_R6_BASELINE',
        gateRunId: null,
        mode: null,
        status: 'NOT_STARTED',
        validity: null,
        ownerId: 'CODEx_TEST_EXPERIENCE_ACTOR_FULL_ACCESS',
        startedAt: null,
        completedAt: null,
        updatedAt: now,
        nextAction: '运行当前门禁',
        historyCount: 3,
        sensitivity: 'INTERNAL',
      } as const,
    ],
    nextCursor: null,
  })),
  listMaterialLibraryItems: vi.fn(async () => ({
    items: [
      {
        baselineId: 'CODEx_TEST_EXPERIENCE_UI_R6_BASELINE',
        requirementId,
        requirementName: '聚合材料需求',
        requirementStage: 'G3',
        versionNumber: 2,
        status: 'CANDIDATE',
        sourceType: 'USER_INTERVIEW',
        sourceDescription: null,
        materialPurpose: 'FACT',
        sensitivity: 'INTERNAL',
        confirmedBy: 'CODEx_TEST_EXPERIENCE_ACTOR_FULL_ACCESS',
        confirmedAt: now,
        createdAt: now,
        materialRefs: [],
        pendingImpact: null,
      } as const,
    ],
    nextCursor: null,
  })),
};
const servers: Array<ReturnType<typeof buildServer>> = [];

function createApi() {
  const ports = createExperienceDependencyPorts(() => now);
  const server = buildServer({
    operationsService: new OperationsApplicationService({
      repository,
      authorizationPort: ports.authorization,
      now: () => now,
    }),
    resolveActor: () => createExperienceActor(),
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('UI-R6 operations HTTP API', () => {
  it('passes normalized filters to the gate-center aggregate', async () => {
    const response = await createApi().inject({
      method: 'GET',
      url: '/api/v1/gate-center?view=CURRENT&stage=G3&status=NOT_STARTED&search=%E9%97%A8%E7%A6%81&limit=30',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      checkedAt: now,
      items: [{ requirementName: '聚合门禁需求' }],
    });
    expect(repository.listGateCenterItems).toHaveBeenCalledWith({
      view: 'CURRENT',
      stage: 'G3',
      status: 'NOT_STARTED',
      mode: null,
      search: '门禁',
      cursor: null,
      limit: 30,
    });
  });

  it('passes material filters and rejects unknown enum values', async () => {
    const server = createApi();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/material-library?status=CANDIDATE&sourceType=USER_INTERVIEW&materialPurpose=FACT&sensitivity=INTERNAL',
    });
    const invalid = await server.inject({
      method: 'GET',
      url: '/api/v1/gate-center?status=SUCCESS',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      requirementName: '聚合材料需求',
      status: 'CANDIDATE',
    });
    expect(repository.listMaterialLibraryItems).toHaveBeenCalledWith({
      status: 'CANDIDATE',
      sourceType: 'USER_INTERVIEW',
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
      search: '',
      cursor: null,
      limit: 20,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('fails closed when the aggregate service is unavailable', async () => {
    const server = buildServer({ resolveActor: () => createExperienceActor() });
    servers.push(server);
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/gate-center',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
