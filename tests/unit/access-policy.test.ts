import { describe, expect, it } from 'vitest';

import { evaluateRequirementAccess } from '../../packages/domain/src/index.ts';
import { createT2AccessFixture } from '../../packages/test-data/src/index.ts';

const fixture = createT2AccessFixture('T2_POLICY');

describe('T2 requirement access policy', () => {
  it('allows scoped members to view internal and public content', () => {
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.internalView,
        authorization: fixture.snapshots.allowed,
      }),
    ).toMatchObject({ decision: 'ALLOW', code: null, reasonCode: 'ALLOWED' });

    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.publicView,
        authorization: fixture.snapshots.allowed,
      }),
    ).toMatchObject({ decision: 'ALLOW', code: null, reasonCode: 'ALLOWED' });
  });

  it('still denies public content when requirement scope is absent', () => {
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.outsider,
        request: fixture.requests.publicView,
        authorization: fixture.snapshots.outsider,
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'PERMISSION_DENIED',
      reasonCode: 'REQUIREMENT_SCOPE_REQUIRED',
    });
  });

  it('fails closed for unknown identity or membership', () => {
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.unknown,
        request: fixture.requests.internalView,
        authorization: fixture.snapshots.allowed,
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'PERMISSION_DENIED',
      reasonCode: 'IDENTITY_UNKNOWN',
    });

    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.internalView,
        authorization: fixture.snapshots.unknownMembership,
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'PERMISSION_DENIED',
      reasonCode: 'MEMBERSHIP_UNKNOWN',
    });
  });

  it('requires explicit membership for restricted material', () => {
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.restrictedView,
        authorization: {
          ...fixture.snapshots.allowed,
          membership: {
            ...fixture.snapshots.allowed.membership,
            restricted: 'NO',
          },
        },
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'PERMISSION_DENIED',
      reasonCode: 'RESTRICTED_MEMBERSHIP_REQUIRED',
    });

    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.restrictedView,
        authorization: fixture.snapshots.allowed,
      }),
    ).toMatchObject({ decision: 'ALLOW' });
  });

  it('allows ordinary material transmission only to approved AI or Skill targets', () => {
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: {
          ...fixture.requests.internalTransmission,
          transmission: {
            target: 'TERMINAL',
            purpose: 'requirements-analysis',
          },
        },
        authorization: fixture.snapshots.allowed,
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'SENSITIVE_ACTION_AUTH_REQUIRED',
      reasonCode: 'TRANSMISSION_TARGET_NOT_APPROVED',
    });

    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.internalTransmission,
        authorization: fixture.snapshots.allowed,
      }),
    ).toMatchObject({ decision: 'ALLOW' });
  });

  it('requires a current action authorization matching target, purpose, and material scope', () => {
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.productManager,
        request: fixture.requests.restrictedTransmission,
        authorization: fixture.snapshots.allowed,
      }),
    ).toMatchObject({ decision: 'ALLOW' });

    for (const request of [
      {
        ...fixture.requests.restrictedTransmission,
        materialRefIds: ['CODEx_TEST_T2_POLICY_MATERIAL_OUT_OF_SCOPE'],
      },
      {
        ...fixture.requests.restrictedTransmission,
        transmission: {
          target: 'APPROVED_AI' as const,
          purpose: 'different-purpose',
        },
      },
    ]) {
      expect(
        evaluateRequirementAccess({
          actor: fixture.actors.productManager,
          request,
          authorization: fixture.snapshots.allowed,
        }),
      ).toMatchObject({
        decision: 'DENY',
        code: 'SENSITIVE_ACTION_AUTH_REQUIRED',
        reasonCode: 'ACTION_AUTHORIZATION_REQUIRED',
      });
    }
  });

  it('does not reuse an action authorization for another action or after expiry', () => {
    for (const actionAuthorization of [
      {
        ...fixture.snapshots.allowed.actionAuthorizations[0],
        action: 'RUN_GATE' as const,
      },
      {
        ...fixture.snapshots.allowed.actionAuthorizations[0],
        validUntil: '2026-09-05T00:59:59.999Z',
      },
    ]) {
      expect(
        evaluateRequirementAccess({
          actor: fixture.actors.productManager,
          request: fixture.requests.restrictedTransmission,
          authorization: {
            ...fixture.snapshots.allowed,
            actionAuthorizations: [actionAuthorization],
          },
        }),
      ).toMatchObject({
        decision: 'DENY',
        code: 'SENSITIVE_ACTION_AUTH_REQUIRED',
        reasonCode: 'ACTION_AUTHORIZATION_REQUIRED',
      });
    }
  });

  it('denies an action omitted from the current authorization snapshot', () => {
    expect(
      evaluateRequirementAccess({
        actor: fixture.actors.outsider,
        request: fixture.requests.confirmQuestion,
        authorization: {
          ...fixture.snapshots.allowed,
          actorId: fixture.actors.outsider.actorId,
          allowedActions: ['VIEW_REQUIREMENT'],
        },
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'PERMISSION_DENIED',
      reasonCode: 'ACTION_NOT_ALLOWED',
    });
  });

  it('returns only a bounded audit summary without material identifiers or content', () => {
    const decision = evaluateRequirementAccess({
      actor: fixture.actors.outsider,
      request: fixture.requests.restrictedTransmission,
      authorization: fixture.snapshots.outsider,
    });

    expect(decision.auditSummary).toEqual({
      actorId: fixture.actors.outsider.actorId,
      action: 'TRANSMIT_MATERIAL',
      requirementId: fixture.requirementId,
      sensitivity: 'RESTRICTED',
      decision: 'DENY',
      reasonCode: 'REQUIREMENT_SCOPE_REQUIRED',
      materialCount: 1,
      transmissionTarget: 'APPROVED_AI',
    });
    expect(JSON.stringify(decision.auditSummary)).not.toContain(
      fixture.materialRefId,
    );
    expect(JSON.stringify(decision)).not.toContain('originalIdea');
  });
});
