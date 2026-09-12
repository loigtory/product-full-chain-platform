import { describe, expect, it } from 'vitest';

import {
  createScopedActionAuthorization,
  evaluateRequirementAccess,
  revokeScopedActionAuthorization,
} from '../../packages/domain/src/index.ts';
import { resolveRequirementActionsForRoles } from '../../packages/persistence/src/index.ts';
import { createT2AccessFixture } from '../../packages/test-data/src/index.ts';

const id = (suffix: string) => `CODEx_TEST_AIUX_SECURITY_${suffix}`;

describe('AI-UX-R1 work-session security', () => {
  it('maps the six work-session actions to only the confirmed roles', () => {
    const actions = (
      role: Parameters<typeof resolveRequirementActionsForRoles>[0][number],
    ) => resolveRequirementActionsForRoles([role]);

    for (const role of [
      'PRODUCT_MANAGER',
      'PRODUCT_OWNER',
      'ENGINEERING_OWNER',
    ] as const) {
      expect(actions(role)).toEqual(
        expect.arrayContaining([
          'VIEW_WORK_SESSION',
          'CREATE_WORK_SESSION',
          'SUBMIT_WORK_TURN',
          'DECIDE_ACTION_PROPOSAL',
          'CONTROL_WORK_SESSION',
          'TRANSMIT_MATERIAL',
        ]),
      );
    }
    expect(actions('BUSINESS_OWNER')).toEqual(
      expect.arrayContaining([
        'VIEW_WORK_SESSION',
        'SUBMIT_WORK_TURN',
        'TRANSMIT_MATERIAL',
      ]),
    );
    expect(actions('BUSINESS_OWNER')).not.toContain('DECIDE_ACTION_PROPOSAL');
    expect(actions('TEST_OWNER')).toContain('VIEW_WORK_SESSION');
    expect(actions('RELEASE_OWNER')).toContain('VIEW_WORK_SESSION');
    expect(actions('TEAM_ADMIN')).toEqual(
      expect.arrayContaining([
        'VIEW_WORK_SESSION',
        'CONTROL_WORK_SESSION',
        'GRANT_MATERIAL_TRANSMISSION',
      ]),
    );
    expect(actions('TEAM_ADMIN')).not.toContain('DECIDE_ACTION_PROPOSAL');
    expect(actions('PRODUCT_OWNER')).toContain('GRANT_MATERIAL_TRANSMISSION');
    expect(actions('PRODUCT_MANAGER')).not.toContain(
      'GRANT_MATERIAL_TRANSMISSION',
    );
  });

  it('creates a deterministic, exact, maximum-30-minute transmission grant', () => {
    const input = {
      authorizationId: id('AUTH_1'),
      actorId: id('ACTOR_PM'),
      requirementId: id('REQ_1'),
      target: 'APPROVED_AI' as const,
      purpose: 'requirements-analysis',
      materialRefIds: [id('MATERIAL_2'), id('MATERIAL_1')],
      grantedBy: id('ACTOR_PO'),
      grantorRoles: ['PRODUCT_OWNER'] as const,
      grantedAt: '2026-09-07T02:00:00.000Z',
      validUntil: '2026-09-07T02:30:00.000Z',
    };
    const first = createScopedActionAuthorization(input);
    const second = createScopedActionAuthorization({
      ...input,
      authorizationId: id('AUTH_2'),
      materialRefIds: [...input.materialRefIds].reverse(),
    });

    expect(first).toMatchObject({
      action: 'TRANSMIT_MATERIAL',
      status: 'GRANTED',
      rowVersion: 0,
      revokedBy: null,
      revokedAt: null,
    });
    expect(first.scopeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.scopeHash).toBe(first.scopeHash);
    expect(() =>
      createScopedActionAuthorization({
        ...input,
        validUntil: '2026-09-07T02:30:00.001Z',
      }),
    ).toThrowError('TRANSMISSION_GRANT_DURATION_EXCEEDED');
    expect(() =>
      createScopedActionAuthorization({ ...input, target: 'MODEL' }),
    ).toThrowError('TRANSMISSION_TARGET_NOT_APPROVED');
    expect(() =>
      createScopedActionAuthorization({
        ...input,
        grantorRoles: ['PRODUCT_MANAGER'],
      }),
    ).toThrowError('MATERIAL_TRANSMISSION_GRANT_FORBIDDEN');
  });

  it('rejects a tampered scope hash and a revoked grant', () => {
    const fixture = createT2AccessFixture('AIUX_SECURITY_POLICY');
    const valid = fixture.snapshots.allowed.actionAuthorizations[0];
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.restrictedTransmission,
        authorization: {
          ...fixture.snapshots.allowed,
          actionAuthorizations: [
            { ...valid, scopeHash: `sha256:${'f'.repeat(64)}` },
          ],
        },
      }),
    ).toMatchObject({
      decision: 'DENY',
      reasonCode: 'ACTION_AUTHORIZATION_REQUIRED',
    });

    const revoked = revokeScopedActionAuthorization(valid, {
      revokedBy: id('ACTOR_PO'),
      revokedAt: '2026-09-05T01:00:00.000Z',
    });
    expect(revoked).toMatchObject({ status: 'REVOKED', rowVersion: 1 });
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.restrictedTransmission,
        authorization: {
          ...fixture.snapshots.allowed,
          actionAuthorizations: [revoked],
        },
      }),
    ).toMatchObject({
      decision: 'DENY',
      reasonCode: 'ACTION_AUTHORIZATION_REQUIRED',
    });
  });
});
