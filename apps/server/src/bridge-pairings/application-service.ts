import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  ActorContext,
  BridgeListResponse,
  BridgeRegistrationDto,
  CreateBridgePairingResponse,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';

import { createMutationEvidence } from '../mutation-evidence.ts';
import type {
  BridgePairingRepositoryPort,
  BridgeWorkspaceExchange,
} from './repository-port.ts';

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function identifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(value)) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${field} is invalid.`);
  }
  return value;
}

function version(value: string | null, field: string): string | null {
  if (value === null) return null;
  const result = value.trim();
  if (!result || result.length > 120) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${field} is invalid.`);
  }
  return result;
}

function workspaces(
  values: readonly BridgeWorkspaceExchange[],
): readonly BridgeWorkspaceExchange[] {
  if (!values.length || values.length > 20) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Bridge workspace bindings are invalid.',
    );
  }
  const seen = new Set<string>();
  return values.map((item) => {
    const workspaceId = identifier(item.workspaceId, 'workspaceId');
    const allowedRelativePath = item.allowedRelativePath.trim();
    if (
      !allowedRelativePath ||
      allowedRelativePath.length > 500 ||
      path.win32.isAbsolute(allowedRelativePath) ||
      allowedRelativePath.split(/[\\/]/).includes('..')
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'allowedRelativePath is invalid.',
      );
    }
    if (!/^sha256:[a-f\d]{64}$/i.test(item.repositoryFingerprint)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'repositoryFingerprint is invalid.',
      );
    }
    if (seen.has(workspaceId)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge workspace binding is duplicated.',
      );
    }
    seen.add(workspaceId);
    return {
      workspaceId,
      repositoryFingerprint: item.repositoryFingerprint.toLowerCase(),
      allowedRelativePath,
    };
  });
}

export class BridgePairingApplicationService {
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;
  private readonly secretFactory: () => string;

  constructor(
    private readonly input: {
      repository: BridgePairingRepositoryPort;
      now?: () => string;
      idFactory?: (prefix: string) => string;
      secretFactory?: () => string;
    },
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory =
      input.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.secretFactory =
      input.secretFactory ?? (() => randomBytes(32).toString('base64url'));
  }

  private async assertMembership(
    actor: ActorContext,
    teamId: string,
    adminRequired: boolean,
  ) {
    if (actor.authenticationStatus !== 'AUTHENTICATED') {
      throw new DomainRuleViolation(
        'AUTHENTICATION_REQUIRED',
        'Session required.',
      );
    }
    const membership = await this.input.repository.findMembership({
      teamId,
      accountId: actor.actorId,
    });
    if (
      membership?.status !== 'ACTIVE' ||
      (adminRequired && membership.role !== 'TEAM_ADMIN')
    ) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        adminRequired
          ? 'Bridge pairing requires team administration.'
          : 'Bridge status requires active team membership.',
      );
    }
  }

  async list(
    actor: ActorContext,
    rawTeamId: string,
  ): Promise<BridgeListResponse> {
    const teamId = identifier(rawTeamId, 'teamId');
    await this.assertMembership(actor, teamId, false);
    const now = Date.parse(this.now());
    const items = (await this.input.repository.listBridgesForTeam(teamId)).map(
      (bridge): BridgeRegistrationDto => ({
        ...bridge,
        status:
          bridge.status !== 'REVOKED' &&
          (!bridge.lastHeartbeatAt ||
            Date.parse(bridge.lastHeartbeatAt) < now - 90_000)
            ? 'OFFLINE'
            : bridge.status,
      }),
    );
    return { items };
  }

  async create(input: {
    actor: ActorContext;
    teamId: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<CreateBridgePairingResponse> {
    const teamId = identifier(input.teamId, 'teamId');
    await this.assertMembership(input.actor, teamId, true);
    const pairingId = this.idFactory('bridge-pairing');
    const pairingCode = this.secretFactory();
    const createdAt = this.now();
    const expiresAt = new Date(
      Date.parse(createdAt) + 5 * 60_000,
    ).toISOString();
    const result = await this.input.repository.createPairing({
      id: pairingId,
      teamId,
      pairingCodeDigest: digest(pairingCode),
      expiresAt,
      createdBy: input.actor.actorId,
      createdAt,
      mutation: createMutationEvidence({
        actorId: input.actor.actorId,
        route: `/api/v1/teams/${teamId}/bridge-pairings`,
        idempotencyKey: input.idempotencyKey,
        request: { teamId },
        requestId: input.requestId,
        eventType: 'bridge-pairing.created',
        aggregateType: 'bridge-pairing',
        aggregateId: pairingId,
        aggregateVersion: 0,
        occurredAt: createdAt,
        idFactory: this.idFactory,
      }),
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Bridge pairing idempotency conflict.',
      );
    }
    if (!result.pairingId || !result.expiresAt) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Bridge pairing result is unknown.',
      );
    }
    return {
      replayed: result.status === 'REPLAYED',
      pairingId: result.pairingId,
      pairingCode: result.status === 'CREATED' ? pairingCode : null,
      expiresAt: result.expiresAt,
    };
  }

  async exchange(input: {
    pairingCode: string;
    bridgeVersion: string;
    nodeVersion: string;
    codexVersion: string | null;
    zedVersion: string | null;
    workspaces: readonly BridgeWorkspaceExchange[];
  }) {
    if (input.pairingCode.length < 20 || input.pairingCode.length > 400) {
      throw new DomainRuleViolation(
        'AUTHENTICATION_FAILED',
        'Bridge pairing code is invalid.',
      );
    }
    const bridgeId = this.idFactory('bridge');
    const credential = this.secretFactory();
    const result = await this.input.repository.exchangePairing({
      pairingCodeDigest: digest(input.pairingCode),
      bridgeId,
      credentialDigest: digest(credential),
      protocolVersion: 'pfc-bridge/1',
      bridgeVersion: version(input.bridgeVersion, 'bridgeVersion')!,
      nodeVersion: version(input.nodeVersion, 'nodeVersion')!,
      codexVersion: version(input.codexVersion, 'codexVersion'),
      zedVersion: version(input.zedVersion, 'zedVersion'),
      workspaces: workspaces(input.workspaces),
      exchangedAt: this.now(),
    });
    if (result.status !== 'EXCHANGED') {
      throw new DomainRuleViolation(
        'AUTHENTICATION_FAILED',
        'Bridge pairing code is invalid or expired.',
      );
    }
    return {
      bridgeId: result.bridgeId,
      teamId: result.teamId,
      credential,
    };
  }
}
