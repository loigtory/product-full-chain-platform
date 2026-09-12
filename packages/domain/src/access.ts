import { createHash } from 'node:crypto';

import type {
  AccessDecision,
  ActorContext,
  ActorRole,
  RequirementAccessRequest,
  RequirementAuthorizationSnapshot,
  ScopedActionAuthorization,
} from '@pfc/contracts';

import { assertSafeEventSummary } from './outbox.ts';

function accessIdentifier(value: string, code: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/.test(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

export function createTransmissionAuthorizationScopeHash(input: {
  actorId: string;
  requirementId: string;
  target: ScopedActionAuthorization['target'];
  purpose: string;
  materialRefIds: readonly string[];
}): string {
  const canonical = JSON.stringify({
    actorId: input.actorId.trim(),
    requirementId: input.requirementId.trim(),
    action: 'TRANSMIT_MATERIAL',
    target: input.target,
    purpose: input.purpose.trim(),
    materialRefIds: [...input.materialRefIds].map((item) => item.trim()).sort(),
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function createScopedActionAuthorization(input: {
  authorizationId: string;
  actorId: string;
  requirementId: string;
  target: ScopedActionAuthorization['target'];
  purpose: string;
  materialRefIds: readonly string[];
  grantedBy: string;
  grantorRoles: readonly ActorRole[];
  grantedAt: string;
  validUntil: string;
}): ScopedActionAuthorization {
  if (
    !input.grantorRoles.some((role) =>
      ['PRODUCT_OWNER', 'TEAM_ADMIN'].includes(role),
    )
  ) {
    throw new Error('MATERIAL_TRANSMISSION_GRANT_FORBIDDEN');
  }
  if (!['APPROVED_AI', 'APPROVED_SKILL', 'MCP'].includes(input.target)) {
    throw new Error('TRANSMISSION_TARGET_NOT_APPROVED');
  }
  const grantedAt = Date.parse(input.grantedAt);
  const validUntil = Date.parse(input.validUntil);
  if (!Number.isFinite(grantedAt) || !Number.isFinite(validUntil)) {
    throw new Error('INVALID_TRANSMISSION_GRANT_TIMESTAMP');
  }
  if (validUntil <= grantedAt) {
    throw new Error('INVALID_TRANSMISSION_GRANT_EXPIRY');
  }
  if (validUntil - grantedAt > 30 * 60 * 1_000) {
    throw new Error('TRANSMISSION_GRANT_DURATION_EXCEEDED');
  }
  const materialRefIds = input.materialRefIds.map((item) =>
    accessIdentifier(item, 'INVALID_TRANSMISSION_MATERIAL_REF'),
  );
  if (
    materialRefIds.length === 0 ||
    materialRefIds.length > 50 ||
    new Set(materialRefIds).size !== materialRefIds.length
  ) {
    throw new Error('INVALID_TRANSMISSION_MATERIAL_SCOPE');
  }
  const actorId = accessIdentifier(
    input.actorId,
    'INVALID_TRANSMISSION_ACTOR_ID',
  );
  const requirementId = accessIdentifier(
    input.requirementId,
    'INVALID_TRANSMISSION_REQUIREMENT_ID',
  );
  const purpose = input.purpose.trim();
  if (!purpose || purpose.length > 160) {
    throw new Error('INVALID_TRANSMISSION_PURPOSE');
  }
  return {
    authorizationId: accessIdentifier(
      input.authorizationId,
      'INVALID_TRANSMISSION_AUTHORIZATION_ID',
    ),
    actorId,
    requirementId,
    action: 'TRANSMIT_MATERIAL',
    target: input.target,
    purpose,
    materialRefIds: [...materialRefIds].sort(),
    scopeHash: createTransmissionAuthorizationScopeHash({
      actorId,
      requirementId,
      target: input.target,
      purpose,
      materialRefIds,
    }),
    status: 'GRANTED',
    validFrom: input.grantedAt,
    validUntil: input.validUntil,
    grantedBy: accessIdentifier(
      input.grantedBy,
      'INVALID_TRANSMISSION_GRANTOR_ID',
    ),
    grantedAt: input.grantedAt,
    revokedBy: null,
    revokedAt: null,
    rowVersion: 0,
  };
}

export function revokeScopedActionAuthorization(
  authorization: ScopedActionAuthorization,
  input: { revokedBy: string; revokedAt: string },
): ScopedActionAuthorization {
  if (authorization.status !== 'GRANTED') {
    throw new Error('TRANSMISSION_AUTHORIZATION_NOT_ACTIVE');
  }
  if (
    Number.isNaN(Date.parse(input.revokedAt)) ||
    Date.parse(input.revokedAt) < Date.parse(authorization.grantedAt)
  ) {
    throw new Error('INVALID_TRANSMISSION_REVOCATION_TIMESTAMP');
  }
  return {
    ...authorization,
    status: 'REVOKED',
    revokedBy: accessIdentifier(
      input.revokedBy,
      'INVALID_TRANSMISSION_REVOKER_ID',
    ),
    revokedAt: input.revokedAt,
    rowVersion: authorization.rowVersion + 1,
  };
}

function auditSummary(
  actor: ActorContext,
  request: RequirementAccessRequest,
  decision: 'ALLOW' | 'DENY',
  reasonCode: string,
) {
  const summary = {
    actorId: actor.actorId,
    action: request.action,
    requirementId: request.requirementId,
    sensitivity: request.sensitivity,
    decision,
    reasonCode,
    materialCount: request.materialRefIds.length,
    transmissionTarget: request.transmission?.target ?? null,
  } as const;
  assertSafeEventSummary(summary);
  return summary;
}

export function createRequirementAccessDenial(
  actor: ActorContext,
  request: RequirementAccessRequest,
  reasonCode: string,
  code:
    | 'PERMISSION_DENIED'
    | 'SENSITIVE_ACTION_AUTH_REQUIRED' = 'PERMISSION_DENIED',
): AccessDecision {
  return {
    decision: 'DENY',
    code,
    reasonCode,
    auditSummary: auditSummary(actor, request, 'DENY', reasonCode),
  };
}

function allow(
  actor: ActorContext,
  request: RequirementAccessRequest,
): AccessDecision {
  return {
    decision: 'ALLOW',
    code: null,
    reasonCode: 'ALLOWED',
    auditSummary: auditSummary(actor, request, 'ALLOW', 'ALLOWED'),
  };
}

function isCurrentAuthorization(
  authorization: ScopedActionAuthorization,
  actor: ActorContext,
  request: RequirementAccessRequest,
): boolean {
  const requestedAt = Date.parse(request.requestedAt);
  const validFrom = Date.parse(authorization.validFrom);
  const validUntil = Date.parse(authorization.validUntil);
  const expectedScopeHash = createTransmissionAuthorizationScopeHash({
    actorId: authorization.actorId,
    requirementId: authorization.requirementId,
    target: authorization.target,
    purpose: authorization.purpose,
    materialRefIds: authorization.materialRefIds,
  });
  return (
    Number.isFinite(requestedAt) &&
    Number.isFinite(validFrom) &&
    Number.isFinite(validUntil) &&
    authorization.status === 'GRANTED' &&
    authorization.scopeHash === expectedScopeHash &&
    authorization.actorId === actor.actorId &&
    authorization.requirementId === request.requirementId &&
    authorization.action === request.action &&
    authorization.target === request.transmission?.target &&
    authorization.purpose === request.transmission?.purpose &&
    request.materialRefIds.length > 0 &&
    request.materialRefIds.every((id) =>
      authorization.materialRefIds.includes(id),
    ) &&
    requestedAt >= validFrom &&
    requestedAt <= validUntil
  );
}

export function evaluateRequirementAccess(input: {
  actor: ActorContext;
  request: RequirementAccessRequest;
  authorization: RequirementAuthorizationSnapshot;
}): AccessDecision {
  const { actor, request, authorization } = input;
  if (actor.authenticationStatus !== 'AUTHENTICATED') {
    return createRequirementAccessDenial(actor, request, 'IDENTITY_UNKNOWN');
  }
  if (
    authorization.actorId !== actor.actorId ||
    authorization.requirementId !== request.requirementId
  ) {
    return createRequirementAccessDenial(
      actor,
      request,
      'AUTHORIZATION_CONTEXT_MISMATCH',
    );
  }

  const hasScope =
    authorization.membership.team === 'YES' ||
    authorization.membership.requirement === 'YES';
  if (!hasScope) {
    const scopeIsUnknown =
      authorization.membership.team === 'UNKNOWN' ||
      authorization.membership.requirement === 'UNKNOWN';
    return createRequirementAccessDenial(
      actor,
      request,
      scopeIsUnknown ? 'MEMBERSHIP_UNKNOWN' : 'REQUIREMENT_SCOPE_REQUIRED',
    );
  }
  if (!authorization.allowedActions.includes(request.action)) {
    return createRequirementAccessDenial(actor, request, 'ACTION_NOT_ALLOWED');
  }
  if (request.sensitivity === 'UNKNOWN') {
    return createRequirementAccessDenial(actor, request, 'SENSITIVITY_UNKNOWN');
  }
  if (
    request.sensitivity === 'RESTRICTED' &&
    authorization.membership.restricted !== 'YES'
  ) {
    return createRequirementAccessDenial(
      actor,
      request,
      authorization.membership.restricted === 'UNKNOWN'
        ? 'RESTRICTED_MEMBERSHIP_UNKNOWN'
        : 'RESTRICTED_MEMBERSHIP_REQUIRED',
    );
  }

  if (request.action !== 'TRANSMIT_MATERIAL') return allow(actor, request);
  if (
    !request.transmission ||
    !request.transmission.purpose.trim() ||
    request.materialRefIds.length === 0
  ) {
    return createRequirementAccessDenial(
      actor,
      request,
      'ACTION_AUTHORIZATION_REQUIRED',
      'SENSITIVE_ACTION_AUTH_REQUIRED',
    );
  }
  if (
    !authorization.approvedTransmissionTargets.includes(
      request.transmission.target,
    )
  ) {
    return createRequirementAccessDenial(
      actor,
      request,
      'TRANSMISSION_TARGET_NOT_APPROVED',
      'SENSITIVE_ACTION_AUTH_REQUIRED',
    );
  }
  if (request.sensitivity !== 'RESTRICTED') return allow(actor, request);

  const hasActionAuthorization = authorization.actionAuthorizations.some(
    (item) => isCurrentAuthorization(item, actor, request),
  );
  if (!hasActionAuthorization) {
    return createRequirementAccessDenial(
      actor,
      request,
      'ACTION_AUTHORIZATION_REQUIRED',
      'SENSITIVE_ACTION_AUTH_REQUIRED',
    );
  }
  return allow(actor, request);
}
