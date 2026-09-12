import { createHash } from 'node:crypto';

import type {
  ActorContext,
  CreateProductWorkTransmissionAuthorizationRequest,
  ProductWorkReadinessBlockerCode,
  ProductWorkTurnDto,
  RequirementAction,
  ScopedActionAuthorization,
  SensitivityLevel,
} from '@pfc/contracts';
import {
  createScopedActionAuthorization,
  deriveProductWorkReadiness,
  DomainRuleViolation,
} from '@pfc/domain';

import type { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type {
  WorkSessionRepositoryPort,
  WorkSessionScopedAuthorizationPort,
} from './repository-port.ts';

const readinessBlockerCopy: Readonly<
  Record<
    ProductWorkReadinessBlockerCode,
    Readonly<{ message: string; recoveryAction: string }>
  >
> = {
  NO_CURRENT_BASELINE: {
    message: '当前需求还没有可用材料基线。',
    recoveryAction: 'COMPLETE_G0_REGISTRATION',
  },
  NO_VALID_CONTEXT: {
    message: '当前材料基线没有可用于本次作业的有效材料。',
    recoveryAction: 'OPEN_MATERIAL_LIBRARY',
  },
  CONTEXT_SELECTION_REQUIRED: {
    message: '可用材料超过 50 项，请缩小本次传输范围。',
    recoveryAction: 'SELECT_CONTEXT',
  },
  BRIDGE_UNAVAILABLE: {
    message: '当前团队没有在线 Bridge。',
    recoveryAction: 'OPEN_BRIDGE_CENTER',
  },
  BRIDGE_UNVERIFIED: {
    message: '在线 Bridge 尚未提供有效的产品作业能力快照。',
    recoveryAction: 'REFRESH_BRIDGE_CAPABILITY',
  },
  NO_COMPATIBLE_SKILL: {
    message: '没有被当前 Bridge 声明的兼容 Skill。',
    recoveryAction: 'OPEN_SKILL_LIBRARY',
  },
  SKILL_SELECTION_REQUIRED: {
    message: '存在多个兼容 Skill，请明确选择本回合使用项。',
    recoveryAction: 'SELECT_SKILL',
  },
  TRANSMISSION_AUTHORIZATION_REQUIRED: {
    message: '所选受限材料需要产品负责人授权后才能传输。',
    recoveryAction: 'REQUEST_TRANSMISSION_AUTHORIZATION',
  },
  TRANSMISSION_DENIED: {
    message: '当前账号无权把所选材料用于本次 AI 作业。',
    recoveryAction: 'RETURN_TO_STRUCTURED_WORKFLOW',
  },
  TRANSMISSION_STATUS_UNKNOWN: {
    message: '材料传输权限暂时无法确认。',
    recoveryAction: 'RETRY_READINESS',
  },
};

function sensitivityFor(values: readonly SensitivityLevel[]): SensitivityLevel {
  if (values.includes('RESTRICTED')) return 'RESTRICTED';
  if (values.includes('INTERNAL')) return 'INTERNAL';
  return 'PUBLIC';
}

function sameTransmissionGrant(
  left: ScopedActionAuthorization,
  right: ScopedActionAuthorization,
): boolean {
  return (
    left.actorId === right.actorId &&
    left.requirementId === right.requirementId &&
    left.target === right.target &&
    left.purpose === right.purpose &&
    left.scopeHash === right.scopeHash &&
    Date.parse(left.validUntil) - Date.parse(left.grantedAt) ===
      Date.parse(right.validUntil) - Date.parse(right.grantedAt)
  );
}

export class WorkSessionReadinessApplicationService {
  private readonly now: () => string;

  constructor(
    private readonly input: Readonly<{
      repository: WorkSessionRepositoryPort;
      scopedAuthorizations?: WorkSessionScopedAuthorizationPort;
      authorization: RequirementAuthorizationService;
      now?: () => string;
    }>,
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
  }

  private async assertAccess(
    actor: ActorContext,
    requirementId: string,
    action: RequirementAction,
    sensitivity: SensitivityLevel,
  ): Promise<void> {
    const decision = await this.input.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity,
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision === 'DENY') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'Work-session access denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  private async requireSession(actor: ActorContext, sessionId: string) {
    const session = await this.input.repository.findSession(sessionId);
    if (!session) {
      throw new DomainRuleViolation('NOT_FOUND', 'Work session not found.');
    }
    const anchor = await this.input.repository.resolveSessionAnchor({
      actorId: actor.actorId,
      requirementId: session.requirementId,
      teamId: session.teamId,
    });
    if (!anchor) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Work session unavailable.',
      );
    }
    return { session, anchor };
  }

  async readiness(actor: ActorContext, sessionId: string) {
    const { session, anchor } = await this.requireSession(actor, sessionId);
    await this.assertAccess(
      actor,
      session.requirementId,
      'VIEW_WORK_SESSION',
      anchor.sensitivity,
    );
    const checkedAt = this.now();
    const [contexts, capability, turns, bindings] = await Promise.all([
      this.input.repository.listReadinessContextCandidates({
        requirementId: session.requirementId,
        baselineId: anchor.baselineId,
        limit: 100,
      }),
      this.input.repository.resolveProductWorkReadinessCapability({
        teamId: session.teamId,
        at: checkedAt,
      }),
      this.input.repository.listTurns(session.id, 100),
      this.input.repository.listContexts(session.id),
    ]);
    const latestTurn = turns.reduce<ProductWorkTurnDto | null>(
      (latest, turn) =>
        !latest || turn.sequence > latest.sequence ? turn : latest,
      null,
    );
    const previousContextIds = latestTurn
      ? bindings
          .filter(
            (binding) =>
              binding.turnId === latestTurn.id && !binding.invalidatedAt,
          )
          .map((binding) => binding.targetId)
      : [];
    const transmissionStatus = await this.resolveTransmissionStatus({
      actor,
      requirementId: session.requirementId,
      contexts,
      checkedAt,
    });
    const decision = deriveProductWorkReadiness({
      baselineId: anchor.baselineId,
      contextIds: contexts.map((context) => context.materialRefId),
      compatibleSkillReleaseIds: capability.skills
        .filter((skill) => skill.availability === 'AVAILABLE')
        .map((skill) => skill.releaseId),
      previousContextIds,
      previousSkillReleaseId: latestTurn?.skillReleaseId ?? null,
      baselineUnchanged: anchor.baselineId === session.openedBaselineId,
      bridgeStatus: capability.bridgeStatus,
      transmissionStatus,
    });
    const currentAuthorizations =
      decision.recommendedContextIds.length > 0 &&
      this.input.scopedAuthorizations
        ? await this.input.scopedAuthorizations.listCurrent({
            actorId: session.ownerId,
            requirementId: session.requirementId,
            at: checkedAt,
          })
        : [];
    const activeAuthorization = currentAuthorizations.find(
      (authorization) =>
        authorization.target === 'APPROVED_AI' &&
        authorization.purpose === 'product-work-session' &&
        decision.recommendedContextIds.every((materialRefId) =>
          authorization.materialRefIds.includes(materialRefId),
        ),
    );
    return {
      schemaVersion: 'product-work-session-readiness/1' as const,
      sessionId: session.id,
      sessionRowVersion: session.rowVersion,
      requirementRowVersion: anchor.requirementVersion,
      baselineId: anchor.baselineId,
      checkedAt,
      contextOptions: contexts.map((context) => ({
        ...context,
        selectedByDefault: decision.recommendedContextIds.includes(
          context.materialRefId,
        ),
        reason: previousContextIds.includes(context.materialRefId)
          ? 'RECENT_TURN_STILL_VALID'
          : 'CURRENT_BASELINE',
      })),
      skillOptions: capability.skills.map((skill) => ({
        ...skill,
        recommended: decision.recommendedSkillReleaseId === skill.releaseId,
      })),
      recommendedContextIds: decision.recommendedContextIds,
      recommendedSkillReleaseId: decision.recommendedSkillReleaseId,
      transmissionStatus,
      bridgeStatus: capability.bridgeStatus,
      activeTransmissionAuthorization: activeAuthorization
        ? {
            authorizationId: activeAuthorization.authorizationId,
            materialRefIds: activeAuthorization.materialRefIds,
            validUntil: activeAuthorization.validUntil,
            rowVersion: activeAuthorization.rowVersion,
          }
        : null,
      blockers: decision.blockers.map((code) => ({
        code,
        ...readinessBlockerCopy[code],
      })),
    };
  }

  private async resolveTransmissionStatus(input: {
    actor: ActorContext;
    requirementId: string;
    contexts: readonly Readonly<{
      materialRefId: string;
      sensitivity: SensitivityLevel;
    }>[];
    checkedAt: string;
  }) {
    if (input.contexts.length === 0) {
      return 'UNKNOWN' as const;
    }
    const result = await this.input.authorization.authorize(input.actor, {
      requirementId: input.requirementId,
      action: 'TRANSMIT_MATERIAL',
      sensitivity: sensitivityFor(
        input.contexts.map((context) => context.sensitivity),
      ),
      materialRefIds: input.contexts.map((context) => context.materialRefId),
      requestedAt: input.checkedAt,
      transmission: {
        target: 'APPROVED_AI',
        purpose: 'product-work-session',
      },
    });
    if (result.decision === 'ALLOW') return 'READY' as const;
    if (result.reasonCode === 'ACTION_AUTHORIZATION_REQUIRED') {
      return 'AUTHORIZATION_REQUIRED' as const;
    }
    if (result.reasonCode.startsWith('AUTHORIZATION_CAPABILITY_')) {
      return 'UNKNOWN' as const;
    }
    return 'DENIED' as const;
  }

  async grantTransmissionAuthorization(input: {
    actor: ActorContext;
    sessionId: string;
    request: CreateProductWorkTransmissionAuthorizationRequest;
    idempotencyKey: string;
  }) {
    const { session, anchor } = await this.requireSession(
      input.actor,
      input.sessionId,
    );
    if (input.request.beneficiaryActorId !== session.ownerId) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Transmission beneficiary must be the session owner.',
      );
    }
    if (
      !Number.isInteger(input.request.validForMinutes) ||
      input.request.validForMinutes < 1 ||
      input.request.validForMinutes > 30
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Transmission grant duration is invalid.',
      );
    }
    const candidates = await this.input.repository.resolveContextCandidates({
      requirementId: session.requirementId,
      baselineId: anchor.baselineId,
      targetIds: input.request.materialRefIds,
    });
    if (
      candidates.length !== input.request.materialRefIds.length ||
      candidates.length === 0 ||
      new Set(input.request.materialRefIds).size !==
        input.request.materialRefIds.length
    ) {
      throw new DomainRuleViolation('CONTEXT_STALE', 'CONTEXT_STALE');
    }
    await this.assertAccess(
      input.actor,
      session.requirementId,
      'GRANT_MATERIAL_TRANSMISSION',
      sensitivityFor(candidates.map((candidate) => candidate.sensitivity)),
    );
    const digest = createHash('sha256')
      .update(`${session.id}:${input.idempotencyKey}`)
      .digest('hex')
      .slice(0, 40);
    const authorizationId = `work-transmission-authorization-${digest}`;
    const scopedAuthorizations = this.requireScopedAuthorizations();
    const existing = await scopedAuthorizations.find(authorizationId);
    const grantedAt = this.now();
    const authorization = createScopedActionAuthorization({
      authorizationId,
      actorId: session.ownerId,
      requirementId: session.requirementId,
      target: 'APPROVED_AI',
      purpose: 'product-work-session',
      materialRefIds: candidates.map((candidate) => candidate.targetId),
      grantedBy: input.actor.actorId,
      grantorRoles: input.actor.roles,
      grantedAt,
      validUntil: new Date(
        Date.parse(grantedAt) + input.request.validForMinutes * 60_000,
      ).toISOString(),
    });
    if (existing) {
      if (!sameTransmissionGrant(existing, authorization)) {
        throw new DomainRuleViolation(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key has already been used for another grant.',
        );
      }
      return { replayed: true, authorization: existing };
    }
    try {
      await scopedAuthorizations.grant(authorization);
      return { replayed: false, authorization };
    } catch (error) {
      const concurrent = await scopedAuthorizations.find(authorizationId);
      if (concurrent && sameTransmissionGrant(concurrent, authorization)) {
        return { replayed: true, authorization: concurrent };
      }
      throw error;
    }
  }

  async revokeTransmissionAuthorization(input: {
    actor: ActorContext;
    authorizationId: string;
    expectedRowVersion: number;
    idempotencyKey: string;
  }) {
    void input.idempotencyKey;
    const scopedAuthorizations = this.requireScopedAuthorizations();
    const authorization = await scopedAuthorizations.find(
      input.authorizationId,
    );
    if (!authorization) {
      throw new DomainRuleViolation(
        'NOT_FOUND',
        'Transmission authorization not found.',
      );
    }
    const anchor = await this.input.repository.resolveSessionAnchor({
      actorId: input.actor.actorId,
      requirementId: authorization.requirementId,
    });
    if (!anchor) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Transmission authorization unavailable.',
      );
    }
    await this.assertAccess(
      input.actor,
      authorization.requirementId,
      'GRANT_MATERIAL_TRANSMISSION',
      anchor.sensitivity,
    );
    if (authorization.status === 'REVOKED') {
      return { replayed: true, authorization };
    }
    if (authorization.rowVersion !== input.expectedRowVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Transmission authorization version is stale.',
        { currentVersion: authorization.rowVersion },
      );
    }
    try {
      const revoked = await scopedAuthorizations.revoke({
        authorizationId: authorization.authorizationId,
        expectedRowVersion: input.expectedRowVersion,
        revokedBy: input.actor.actorId,
        revokedAt: this.now(),
      });
      return { replayed: false, authorization: revoked };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'SCOPED_AUTHORIZATION_VERSION_CONFLICT'
      ) {
        const concurrent = await scopedAuthorizations.find(
          authorization.authorizationId,
        );
        if (concurrent?.status === 'REVOKED') {
          return { replayed: true, authorization: concurrent };
        }
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Transmission authorization version is stale.',
        );
      }
      throw error;
    }
  }

  private requireScopedAuthorizations(): WorkSessionScopedAuthorizationPort {
    if (!this.input.scopedAuthorizations) {
      throw new DomainRuleViolation(
        'DEPENDENCY_UNAVAILABLE',
        'Scoped transmission authorization persistence is unavailable.',
      );
    }
    return this.input.scopedAuthorizations;
  }
}
