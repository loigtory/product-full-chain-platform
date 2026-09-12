import { describe, expect, it, vi } from 'vitest';

import type { ActorContext } from '@pfc/contracts';

import { BridgePairingApplicationService } from '../../apps/server/src/bridge-pairings/application-service.ts';

const actor: ActorContext = {
  actorId: 'CODEx_TEST_M2_TEAM_ADMIN_001',
  roles: ['TEAM_ADMIN'],
  teamIds: ['CODEx_TEST_M2_TEAM_001'],
  authenticationStatus: 'AUTHENTICATED',
};

describe('M2 Bridge pairing', () => {
  it('lists only active-team Bridge capability evidence for a team member', async () => {
    const repository = {
      findMembership: vi.fn(async () => ({
        role: 'PRODUCT_MANAGER' as const,
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
      createPairing: vi.fn(),
      exchangePairing: vi.fn(),
    };
    const service = new BridgePairingApplicationService({
      repository,
      now: () => '2026-09-06T06:00:30.000Z',
    });

    await expect(
      service.list(actor, 'CODEx_TEST_M2_TEAM_001'),
    ).resolves.toMatchObject({
      items: [{ id: 'CODEx_TEST_M2_BRIDGE_001', status: 'ONLINE' }],
    });
    expect(repository.listBridgesForTeam).toHaveBeenCalledWith(
      'CODEx_TEST_M2_TEAM_001',
    );
  });

  it('stores only a short-lived pairing digest and returns the code once', async () => {
    const repository = {
      findMembership: vi.fn(async () => ({
        role: 'TEAM_ADMIN' as const,
        status: 'ACTIVE' as const,
      })),
      listBridgesForTeam: vi.fn(),
      createPairing: vi.fn(async () => ({
        status: 'CREATED' as const,
        pairingId: 'CODEx_TEST_M2_PAIRING_001',
        expiresAt: '2026-09-06T06:05:00.000Z',
      })),
      exchangePairing: vi.fn(),
    };
    const service = new BridgePairingApplicationService({
      repository,
      now: () => '2026-09-06T06:00:00.000Z',
      idFactory: () => 'CODEx_TEST_M2_PAIRING_001',
      secretFactory: () => 'CODEx_TEST_M2_PAIRING_SECRET_001',
    });

    const result = await service.create({
      actor,
      teamId: 'CODEx_TEST_M2_TEAM_001',
      idempotencyKey: 'CODEx_TEST_M2_PAIRING_KEY_001',
      requestId: 'CODEx_TEST_M2_PAIRING_REQUEST_001',
    });

    expect(result).toEqual({
      replayed: false,
      pairingId: 'CODEx_TEST_M2_PAIRING_001',
      pairingCode: 'CODEx_TEST_M2_PAIRING_SECRET_001',
      expiresAt: '2026-09-06T06:05:00.000Z',
    });
    expect(repository.createPairing).toHaveBeenCalledWith(
      expect.objectContaining({
        pairingCodeDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(repository.createPairing.mock.calls)).not.toContain(
      'CODEx_TEST_M2_PAIRING_SECRET_001',
    );
  });

  it('exchanges a valid code for a credential without persisting plaintext', async () => {
    const repository = {
      findMembership: vi.fn(),
      listBridgesForTeam: vi.fn(),
      createPairing: vi.fn(),
      exchangePairing: vi.fn(async () => ({
        status: 'EXCHANGED' as const,
        bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
        teamId: 'CODEx_TEST_M2_TEAM_001',
      })),
    };
    const service = new BridgePairingApplicationService({
      repository,
      now: () => '2026-09-06T06:01:00.000Z',
      idFactory: () => 'CODEx_TEST_M2_BRIDGE_001',
      secretFactory: () => 'CODEx_TEST_M2_BRIDGE_SECRET_001',
    });

    const result = await service.exchange({
      pairingCode: 'CODEx_TEST_M2_PAIRING_SECRET_001',
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
    });

    expect(result).toEqual({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      teamId: 'CODEx_TEST_M2_TEAM_001',
      credential: 'CODEx_TEST_M2_BRIDGE_SECRET_001',
    });
    expect(repository.exchangePairing).toHaveBeenCalledWith(
      expect.objectContaining({
        pairingCodeDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        credentialDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(repository.exchangePairing.mock.calls)).not.toContain(
      'CODEx_TEST_M2_PAIRING_SECRET_001',
    );
    expect(JSON.stringify(repository.exchangePairing.mock.calls)).not.toContain(
      'CODEx_TEST_M2_BRIDGE_SECRET_001',
    );
  });
});
