import { afterAll, describe, expect, it, vi } from 'vitest';

import type { ActorContext } from '@pfc/contracts';

import { BridgePairingApplicationService } from '../../apps/server/src/bridge-pairings/application-service.ts';
import { buildServer } from '../../apps/server/src/app.ts';

const actor: ActorContext = {
  actorId: 'CODEx_TEST_M2_TEAM_ADMIN_001',
  roles: ['TEAM_ADMIN'],
  teamIds: ['CODEx_TEST_M2_TEAM_001'],
  authenticationStatus: 'AUTHENTICATED',
};

describe('M2 Bridge pairing HTTP API', () => {
  const repository = {
    findMembership: vi.fn(async () => ({
      role: 'TEAM_ADMIN' as const,
      status: 'ACTIVE' as const,
    })),
    listBridgesForTeam: vi.fn(async () => [
      {
        id: 'CODEx_TEST_M2_BRIDGE_001',
        teamId: 'CODEx_TEST_M2_TEAM_001',
        protocolVersion: 'pfc-bridge/1',
        bridgeVersion: '0.0.0',
        nodeVersion: 'v24.20.0',
        codexVersion: '0.148.0',
        zedVersion: null,
        status: 'ONLINE' as const,
        lastHeartbeatAt: '2026-09-06T06:00:00.000Z',
        revokedAt: null,
        workspaces: [],
        capability: null,
      },
    ]),
    createPairing: vi.fn(async (input) => ({
      status: 'CREATED' as const,
      pairingId: input.id,
      expiresAt: input.expiresAt,
    })),
    exchangePairing: vi.fn(async () => ({
      status: 'EXCHANGED' as const,
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      teamId: 'CODEx_TEST_M2_TEAM_001',
    })),
  };
  let id = 0;
  let secret = 0;
  const service = new BridgePairingApplicationService({
    repository,
    now: () => '2026-09-06T06:00:00.000Z',
    idFactory: (prefix) => `CODEx_TEST_M2_${prefix}_${++id}`,
    secretFactory: () => `CODEx_TEST_M2_SECRET_${++secret}_LONG_ENOUGH`,
  });
  const server = buildServer({
    bridgePairingService: service,
    resolveActor: () => actor,
  });

  afterAll(async () => server.close());

  it('returns Bridge status through the authenticated team API', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/teams/CODEx_TEST_M2_TEAM_001/bridges',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: 'CODEx_TEST_M2_BRIDGE_001', status: 'ONLINE' }],
    });
  });

  it('creates a pairing code for a team administrator with idempotency', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/teams/CODEx_TEST_M2_TEAM_001/bridge-pairings',
      headers: { 'idempotency-key': 'CODEx_TEST_M2_PAIRING_KEY_001' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      replayed: false,
      pairingCode: expect.stringMatching(/^CODEx_TEST_M2_SECRET_/),
    });
  });

  it('exchanges the one-time code without a browser session', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/bridge/v1/pairings/exchange',
      payload: {
        pairingCode: 'CODEx_TEST_M2_PAIRING_CODE_LONG_ENOUGH',
        bridgeVersion: '0.1.0',
        nodeVersion: '24.20.0',
        codexVersion: '0.148.0',
        zedVersion: null,
        workspaces: [
          {
            workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
            repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
            allowedRelativePath: 'docs/requirements',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      teamId: 'CODEx_TEST_M2_TEAM_001',
      credential: expect.stringMatching(/^CODEx_TEST_M2_SECRET_/),
    });
  });
});
