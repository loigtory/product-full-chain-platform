import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../apps/server/src/app.ts';
import type { DependencyPorts } from '../../apps/server/src/dependencies/index.ts';

const servers: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('GET /health', () => {
  it('returns a bootstrap-only health contract', async () => {
    const server = buildServer();
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      stage: 'bootstrap',
      businessFeatures: false,
    });
  });

  it('installs fail-closed dependency ports when no adapter is injected', async () => {
    const server = buildServer();
    servers.push(server);
    const ports = server.getDecorator<DependencyPorts>('pfcDependencyPorts');

    await expect(
      ports.authorization.lookupRequirementAuthorization({
        actor: {
          actorId: 'CODEx_TEST_T2_SERVER_ACTOR',
          roles: [],
          teamIds: [],
          authenticationStatus: 'AUTHENTICATED',
        },
        requirementId: 'CODEx_TEST_T2_SERVER_REQ',
        action: 'VIEW_REQUIREMENT',
      }),
    ).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      source: 'UNAVAILABLE',
      reasonCode: 'CAPABILITY_NOT_CONFIGURED',
    });
  });
});
