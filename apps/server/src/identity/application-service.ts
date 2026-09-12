import { randomUUID, timingSafeEqual } from 'node:crypto';

import type {
  ActorContext,
  ActorRole,
  CreateInvitationResponse,
  CreateSessionRequest,
  CurrentActorDto,
  SessionStateDto,
} from '@pfc/contracts';
import { DomainRuleViolation, normalizeLoginName } from '@pfc/domain';

import type { IdentityRepositoryPort } from './repository-port.ts';
import {
  createMutationEvidence,
  createOperationEvidence,
} from '../mutation-evidence.ts';
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from './security.ts';

const sessionCookieName = 'pfc_session';
const csrfCookieName = 'pfc_csrf';
const dummyDerivation = {
  hash: Buffer.alloc(64).toString('base64url'),
  salt: Buffer.alloc(16).toString('base64url'),
};

type Clock = () => string;
type IdFactory = (prefix: string) => string;

function parseCookies(
  header: string | undefined,
): Readonly<Record<string, string>> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator < 1) return [];
      return [
        [part.slice(0, separator).trim(), part.slice(separator + 1).trim()],
      ];
    }),
  );
}

function sameHash(first: string, second: string): boolean {
  const left = Buffer.from(first, 'utf8');
  const right = Buffer.from(second, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export class IdentityApplicationService {
  private readonly failures = new Map<
    string,
    { count: number; startedAt: number }
  >();
  private readonly now: Clock;
  private readonly idFactory: IdFactory;
  private readonly sessionTtlMs: number;
  private readonly invitationTtlMs: number;

  constructor(
    private readonly repository: IdentityRepositoryPort,
    options: Readonly<{
      now?: Clock;
      idFactory?: IdFactory;
      sessionTtlMs?: number;
      invitationTtlMs?: number;
    }> = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory =
      options.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1_000;
    this.invitationTtlMs = options.invitationTtlMs ?? 24 * 60 * 60 * 1_000;
  }

  private toActor(
    record: Awaited<
      ReturnType<IdentityRepositoryPort['findActorBySession']>
    > & {},
    csrfToken: string,
  ): CurrentActorDto {
    const roles = [...new Set(record.teams.map((team) => team.role))];
    return {
      actorId: record.actorId,
      loginName: record.loginName,
      displayName: record.displayName,
      roles,
      teams: record.teams,
      currentTeamId: record.teams[0]?.id ?? null,
      csrfToken,
    };
  }

  private async sessionFromCookies(cookieHeader: string | undefined) {
    const cookies = parseCookies(cookieHeader);
    const token = cookies[sessionCookieName];
    if (!token) return null;
    const now = this.now();
    const record = await this.repository.findActorBySession({
      tokenHash: hashToken(token),
      now,
    });
    return record
      ? { token, csrfToken: cookies[csrfCookieName] ?? '', record, now }
      : null;
  }

  async login(
    input: CreateSessionRequest,
    clientKey: string,
    requestId: string,
  ) {
    const now = this.now();
    const nowMs = Date.parse(now);
    const limiter = this.failures.get(clientKey);
    if (
      limiter &&
      nowMs - limiter.startedAt < 5 * 60 * 1_000 &&
      limiter.count >= 5
    ) {
      throw new DomainRuleViolation(
        'RATE_LIMITED',
        'Login rate limit reached.',
      );
    }
    const loginName = normalizeLoginName(input.loginName);
    const account = await this.repository.findAccountByLoginName(loginName);
    const valid = await verifyPassword(
      input.password,
      account
        ? { hash: account.passwordHash, salt: account.passwordSalt }
        : dummyDerivation,
    ).catch(() => false);
    if (!account || account.status !== 'ACTIVE' || !valid) {
      const next =
        limiter && nowMs - limiter.startedAt < 5 * 60 * 1_000
          ? { count: limiter.count + 1, startedAt: limiter.startedAt }
          : { count: 1, startedAt: nowMs };
      this.failures.set(clientKey, next);
      throw new DomainRuleViolation('AUTHENTICATION_FAILED', 'Login failed.');
    }
    this.failures.delete(clientKey);
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const sessionId = this.idFactory('session');
    const expiresAt = new Date(nowMs + this.sessionTtlMs).toISOString();
    await this.repository.createSession({
      id: sessionId,
      accountId: account.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      createdAt: now,
      expiresAt,
      evidence: createOperationEvidence({
        actorId: account.id,
        requestId,
        eventType: 'session.created',
        aggregateType: 'session',
        aggregateId: sessionId,
        aggregateVersion: 0,
        occurredAt: now,
        idFactory: this.idFactory,
      }),
    });
    const record = await this.repository.findActorBySession({
      tokenHash: hashToken(sessionToken),
      now,
    });
    if (!record) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Session result is unknown.',
      );
    }
    return {
      actor: this.toActor(record, csrfToken),
      sessionToken,
      csrfToken,
      expiresAt,
    };
  }

  async resolveActor(cookieHeader: string | undefined): Promise<ActorContext> {
    const session = await this.sessionFromCookies(cookieHeader);
    if (!session) {
      return {
        actorId: 'UNKNOWN_SESSION',
        roles: [],
        teamIds: [],
        authenticationStatus: 'UNKNOWN',
      };
    }
    void this.repository
      .touchSession(hashToken(session.token), session.now)
      .catch(() => undefined);
    return {
      actorId: session.record.actorId,
      roles: [...new Set(session.record.teams.map((team) => team.role))],
      teamIds: session.record.teams.map((team) => team.id),
      authenticationStatus: 'AUTHENTICATED',
    };
  }

  async getCurrentActor(
    cookieHeader: string | undefined,
  ): Promise<CurrentActorDto> {
    const session = await this.sessionFromCookies(cookieHeader);
    if (!session) {
      throw new DomainRuleViolation(
        'AUTHENTICATION_REQUIRED',
        'Session required.',
      );
    }
    if (
      !session.csrfToken ||
      !sameHash(hashToken(session.csrfToken), session.record.csrfTokenHash)
    ) {
      throw new DomainRuleViolation('CSRF_INVALID', 'CSRF token is invalid.');
    }
    return this.toActor(session.record, session.csrfToken);
  }

  async getSessionState(
    cookieHeader: string | undefined,
  ): Promise<SessionStateDto> {
    const session = await this.sessionFromCookies(cookieHeader);
    if (
      !session ||
      !session.csrfToken ||
      !sameHash(hashToken(session.csrfToken), session.record.csrfTokenHash)
    ) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      actor: this.toActor(session.record, session.csrfToken),
    };
  }

  async assertCsrf(
    cookieHeader: string | undefined,
    csrfHeader: string | string[] | undefined,
  ): Promise<void> {
    const session = await this.sessionFromCookies(cookieHeader);
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    if (
      !session ||
      !csrfToken ||
      csrfToken !== session.csrfToken ||
      !sameHash(hashToken(csrfToken), session.record.csrfTokenHash)
    ) {
      throw new DomainRuleViolation('CSRF_INVALID', 'CSRF token is invalid.');
    }
  }

  async logout(
    cookieHeader: string | undefined,
    requestId: string,
  ): Promise<void> {
    const session = await this.sessionFromCookies(cookieHeader);
    if (!session) return;
    const now = this.now();
    await this.repository.revokeSession({
      tokenHash: hashToken(session.token),
      now,
      evidence: createOperationEvidence({
        actorId: session.record.actorId,
        requestId,
        eventType: 'session.revoked',
        aggregateType: 'session',
        aggregateId: hashToken(session.token).slice(0, 32),
        aggregateVersion: 1,
        occurredAt: now,
        idFactory: this.idFactory,
      }),
    });
  }

  async createInvitation(input: {
    actor: ActorContext;
    teamId: string;
    loginName: string;
    role: ActorRole;
    idempotencyKey: string;
    requestId: string;
  }): Promise<CreateInvitationResponse> {
    const token = createOpaqueToken();
    const createdAt = this.now();
    const expiresAt = new Date(
      Date.parse(createdAt) + this.invitationTtlMs,
    ).toISOString();
    const invitationId = this.idFactory('invitation');
    const result = await this.repository.createInvitationAudited({
      id: invitationId,
      teamId: input.teamId,
      loginName: normalizeLoginName(input.loginName),
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt,
      invitedBy: input.actor.actorId,
      createdAt,
      mutation: createMutationEvidence({
        actorId: input.actor.actorId,
        route: `/api/v1/teams/${input.teamId}/members`,
        idempotencyKey: input.idempotencyKey,
        request: { loginName: input.loginName, role: input.role },
        requestId: input.requestId,
        eventType: 'invitation.created',
        aggregateType: 'account-invitation',
        aggregateId: invitationId,
        aggregateVersion: 0,
        occurredAt: createdAt,
        idFactory: this.idFactory,
      }),
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency conflict.',
      );
    }
    if (result.status === 'REPLAYED' || !result.value) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Invitation exists but its one-time token cannot be replayed.',
        { existingResourceId: result.value?.id },
      );
    }
    return { invitationId, invitationToken: token, expiresAt };
  }

  async acceptInvitation(input: {
    token: string;
    displayName: string;
    password: string;
    requestId: string;
  }): Promise<void> {
    const invitation = await this.repository.findInvitationByTokenHash(
      hashToken(input.token),
    );
    const now = this.now();
    if (
      !invitation ||
      invitation.acceptedAt ||
      Date.parse(invitation.expiresAt) <= Date.parse(now)
    ) {
      throw new DomainRuleViolation('NOT_FOUND', 'Invitation is not active.');
    }
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Display name is invalid.',
      );
    }
    const password = await hashPassword(input.password);
    const accountId = this.idFactory('account');
    await this.repository.acceptInvitation({
      invitationId: invitation.id,
      accountId,
      loginName: invitation.loginName,
      displayName,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      teamId: invitation.teamId,
      role: invitation.role,
      now,
      evidence: createOperationEvidence({
        actorId: accountId,
        requestId: input.requestId,
        eventType: 'invitation.accepted',
        aggregateType: 'account',
        aggregateId: accountId,
        aggregateVersion: 0,
        occurredAt: now,
        idFactory: this.idFactory,
      }),
    });
  }
}

export const identityCookieNames = {
  session: sessionCookieName,
  csrf: csrfCookieName,
} as const;
