import { describe, expect, it } from 'vitest';

import type {
  AuthorizationPort,
  CapabilityResult,
  RequirementAuthorizationSnapshot,
} from '../../packages/contracts/src/index.ts';
import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { createT2AccessFixture } from '../../packages/test-data/src/index.ts';

const fixture = createT2AccessFixture('T2_AUTH_SERVICE');

function available(
  data: RequirementAuthorizationSnapshot,
): CapabilityResult<RequirementAuthorizationSnapshot> {
  return {
    status: 'AVAILABLE',
    source: 'FIXTURE',
    capabilityVersion: 'fixture/t2/v1',
    checkedAt: '2026-09-05T01:00:00.000Z',
    data,
  };
}

describe('T2 requirement authorization service', () => {
  it.each(['UNAVAILABLE', 'UNKNOWN'] as const)(
    'denies when AuthorizationPort is %s',
    async (status) => {
      const port: AuthorizationPort = {
        lookupRequirementAuthorization: async () => ({
          status,
          source: status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'FIXTURE',
          capabilityVersion: 'unconfigured/v1',
          checkedAt: '2026-09-05T01:00:00.000Z',
          reasonCode: `AUTHORIZATION_${status}`,
        }),
      };

      const service = new RequirementAuthorizationService(port);
      await expect(
        service.authorize(
          fixture.actors.productManager,
          fixture.requests.internalView,
        ),
      ).resolves.toMatchObject({
        decision: 'DENY',
        code: 'PERMISSION_DENIED',
        reasonCode: `AUTHORIZATION_CAPABILITY_${status}`,
      });
    },
  );

  it('does not call AuthorizationPort for an unknown identity', async () => {
    let lookupCount = 0;
    const port: AuthorizationPort = {
      lookupRequirementAuthorization: async () => {
        lookupCount += 1;
        return available(fixture.snapshots.allowed);
      },
    };

    const service = new RequirementAuthorizationService(port);
    await expect(
      service.authorize(fixture.actors.unknown, fixture.requests.internalView),
    ).resolves.toMatchObject({
      decision: 'DENY',
      code: 'PERMISSION_DENIED',
      reasonCode: 'IDENTITY_UNKNOWN',
    });
    expect(lookupCount).toBe(0);
  });

  it('converts a thrown port failure into a redacted fail-closed decision', async () => {
    const port: AuthorizationPort = {
      lookupRequirementAuthorization: async () => {
        throw new Error('originalIdea=must-not-leak');
      },
    };

    const service = new RequirementAuthorizationService(port);
    const decision = await service.authorize(
      fixture.actors.productManager,
      fixture.requests.internalView,
    );

    expect(decision).toMatchObject({
      decision: 'DENY',
      code: 'PERMISSION_DENIED',
      reasonCode: 'AUTHORIZATION_CAPABILITY_ERROR',
    });
    expect(JSON.stringify(decision)).not.toContain('must-not-leak');
  });

  it('reads the port for every decision so a revocation is effective immediately', async () => {
    let lookupCount = 0;
    const port: AuthorizationPort = {
      lookupRequirementAuthorization: async () => {
        lookupCount += 1;
        return available(
          lookupCount === 1
            ? fixture.snapshots.allowed
            : fixture.snapshots.outsider,
        );
      },
    };

    const service = new RequirementAuthorizationService(port);
    await expect(
      service.authorize(
        fixture.actors.productManager,
        fixture.requests.internalView,
      ),
    ).resolves.toMatchObject({ decision: 'ALLOW' });
    await expect(
      service.authorize(
        fixture.actors.productManager,
        fixture.requests.internalView,
      ),
    ).resolves.toMatchObject({
      decision: 'DENY',
      code: 'PERMISSION_DENIED',
    });
    expect(lookupCount).toBe(2);
  });
});
