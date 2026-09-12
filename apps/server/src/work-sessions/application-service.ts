import { createHash, randomUUID } from 'node:crypto';

import type {
  ActionProposalDecisionRequest,
  ActorContext,
  CreateProductWorkTransmissionAuthorizationRequest,
  CreateProductWorkSessionRequest,
  CreateProductWorkTurnRequest,
  ProductWorkSessionEventDto,
  ProductWorkSessionEventType,
  RequirementAction,
  SensitivityLevel,
  WorkSessionControlAction,
  WorkTurnControlAction,
} from '@pfc/contracts';
import {
  createProductWorkSession,
  createProductWorkTurn,
  decideActionProposal,
  DomainRuleViolation,
  transitionProductWorkSession,
  transitionProductWorkTurn,
} from '@pfc/domain';

import type { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type {
  WorkSessionRepositoryPort,
  WorkSessionScopedAuthorizationPort,
} from './repository-port.ts';
import { WorkSessionReadinessApplicationService } from './readiness-application-service.ts';

function sensitivityFor(values: readonly SensitivityLevel[]): SensitivityLevel {
  if (values.includes('RESTRICTED')) return 'RESTRICTED';
  if (values.includes('INTERNAL')) return 'INTERNAL';
  return 'PUBLIC';
}

export class WorkSessionApplicationService {
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;
  private readonly readinessApplication: WorkSessionReadinessApplicationService;

  constructor(
    private readonly input: Readonly<{
      repository: WorkSessionRepositoryPort;
      scopedAuthorizations?: WorkSessionScopedAuthorizationPort;
      authorization: RequirementAuthorizationService;
      now?: () => string;
      idFactory?: (prefix: string) => string;
    }>,
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory =
      input.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.readinessApplication = new WorkSessionReadinessApplicationService(
      input,
    );
  }

  private async assertAccess(
    actor: ActorContext,
    requirementId: string,
    action: RequirementAction,
    sensitivity: SensitivityLevel,
    transmission?: Readonly<{ target: 'APPROVED_AI'; purpose: string }>,
    materialRefIds: readonly string[] = [],
  ): Promise<void> {
    const decision = await this.input.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity,
      materialRefIds,
      requestedAt: this.now(),
      transmission,
    });
    if (decision.decision === 'DENY') {
      const transmissionDenied = action === 'TRANSMIT_MATERIAL';
      throw new DomainRuleViolation(
        transmissionDenied
          ? 'TRANSMISSION_AUTH_REQUIRED'
          : (decision.code ?? 'PERMISSION_DENIED'),
        transmissionDenied
          ? 'TRANSMISSION_AUTH_REQUIRED'
          : 'Work-session access denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  private event(
    sessionId: string,
    sequence: number,
    type: ProductWorkSessionEventType,
    aggregateType: string,
    aggregateId: string,
    occurredAt: string,
    safeSummary: ProductWorkSessionEventDto['safeSummary'],
  ): ProductWorkSessionEventDto {
    return {
      schemaVersion: 'product-work-session-event/1',
      eventId: this.idFactory('work-session-event'),
      sessionId,
      sequence,
      type,
      aggregateRef: { type: aggregateType, id: aggregateId },
      safeSummary,
      occurredAt,
      receivedAt: occurredAt,
    };
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

  async create(input: {
    actor: ActorContext;
    requirementId: string;
    request: CreateProductWorkSessionRequest;
  }) {
    const anchor = await this.input.repository.resolveSessionAnchor({
      actorId: input.actor.actorId,
      requirementId: input.requirementId,
      teamId: input.request.teamId,
    });
    if (!anchor) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'No unambiguous active team assignment is available.',
      );
    }
    await this.assertAccess(
      input.actor,
      input.requirementId,
      'CREATE_WORK_SESSION',
      anchor.sensitivity,
    );
    const existing = (
      await this.input.repository.listSessions(
        input.requirementId,
        input.actor.actorId,
        20,
      )
    ).find(
      (item) => item.controlSurface === 'WEB' && item.status !== 'ARCHIVED',
    );
    if (existing) return { replayed: true, session: existing };
    const occurredAt = this.now();
    const session = createProductWorkSession({
      id: this.idFactory('work-session'),
      teamId: anchor.teamId,
      requirementId: anchor.requirementId,
      openedRequirementVersion: anchor.requirementVersion,
      currentRequirementVersion: anchor.requirementVersion,
      openedBaselineId: anchor.baselineId,
      openedStage: anchor.stage,
      ownerId: input.actor.actorId,
      createdBy: input.actor.actorId,
      title: input.request.title,
      createdAt: occurredAt,
    });
    const created = await this.input.repository.createSession({
      session,
      event: this.event(
        session.id,
        1,
        'SESSION_CREATED',
        'product-work-session',
        session.id,
        occurredAt,
        {
          status: session.status,
          requirementVersion: anchor.requirementVersion,
        },
      ),
    });
    return { replayed: false, session: created };
  }

  async list(actor: ActorContext, requirementId: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Session limit is invalid.',
      );
    }
    const anchor = await this.input.repository.resolveSessionAnchor({
      actorId: actor.actorId,
      requirementId,
    });
    if (!anchor) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Requirement unavailable.',
      );
    }
    await this.assertAccess(
      actor,
      requirementId,
      'VIEW_WORK_SESSION',
      anchor.sensitivity,
    );
    return {
      items: await this.input.repository.listSessions(
        requirementId,
        actor.actorId,
        limit,
      ),
      nextCursor: null,
    };
  }

  async snapshot(actor: ActorContext, sessionId: string) {
    const { session, anchor } = await this.requireSession(actor, sessionId);
    await this.assertAccess(
      actor,
      session.requirementId,
      'VIEW_WORK_SESSION',
      anchor.sensitivity,
    );
    const [turns, contextItems, pendingProposal, linkedAgentRunIds] =
      await Promise.all([
        this.input.repository.listTurns(session.id, 50),
        this.input.repository.listContexts(session.id),
        this.input.repository.findPendingProposal(session.id),
        this.input.repository.listLinkedAgentRunIds(session.id),
      ]);
    const latestTurn = turns.reduce<(typeof turns)[number] | null>(
      (latest, turn) =>
        !latest || turn.sequence > latest.sequence ? turn : latest,
      null,
    );
    const workspaceEvidence =
      await this.input.repository.resolveWorkspaceEvidence({
        teamId: session.teamId,
        requirementId: session.requirementId,
        bridgeId: latestTurn?.bridgeId ?? null,
        at: this.now(),
      });
    return {
      schemaVersion: 'product-work-session-snapshot/1' as const,
      session,
      requirement: {
        id: anchor.requirementId,
        name: anchor.requirementName,
        currentStage: anchor.stage,
        currentBaselineId: anchor.baselineId,
        rowVersion: anchor.requirementVersion,
        businessOwnerId: anchor.businessOwnerId,
      },
      contextItems,
      turns: { items: turns, nextCursor: null },
      pendingProposal,
      linkedAgentRunIds,
      workspaceEvidence,
      recoveryAction:
        anchor.requirementVersion !== session.currentRequirementVersion
          ? 'RELOAD_CURRENT'
          : session.status === 'BLOCKED'
            ? 'RESUME_SESSION'
            : null,
    };
  }

  async readiness(actor: ActorContext, sessionId: string) {
    return this.readinessApplication.readiness(actor, sessionId);
  }

  async grantTransmissionAuthorization(input: {
    actor: ActorContext;
    sessionId: string;
    request: CreateProductWorkTransmissionAuthorizationRequest;
    idempotencyKey: string;
  }) {
    return this.readinessApplication.grantTransmissionAuthorization(input);
  }

  async revokeTransmissionAuthorization(input: {
    actor: ActorContext;
    authorizationId: string;
    expectedRowVersion: number;
    idempotencyKey: string;
  }) {
    return this.readinessApplication.revokeTransmissionAuthorization(input);
  }

  async turns(actor: ActorContext, sessionId: string, limit: number) {
    const { session, anchor } = await this.requireSession(actor, sessionId);
    await this.assertAccess(
      actor,
      session.requirementId,
      'VIEW_WORK_SESSION',
      anchor.sensitivity,
    );
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Turn limit is invalid.',
      );
    }
    return {
      items: await this.input.repository.listTurns(sessionId, limit),
      nextCursor: null,
    };
  }

  async submitTurn(input: {
    actor: ActorContext;
    sessionId: string;
    request: CreateProductWorkTurnRequest;
    expectedSessionVersion: number;
    idempotencyKey: string;
  }) {
    const { session, anchor } = await this.requireSession(
      input.actor,
      input.sessionId,
    );
    await this.assertAccess(
      input.actor,
      session.requirementId,
      'SUBMIT_WORK_TURN',
      anchor.sensitivity,
    );
    const replay = await this.input.repository.findTurnByIdempotencyKey(
      session.id,
      input.idempotencyKey,
    );
    if (replay) return { replayed: true, turn: replay };
    if (
      input.expectedSessionVersion !== session.rowVersion ||
      anchor.requirementVersion !== session.currentRequirementVersion ||
      anchor.baselineId !== session.openedBaselineId
    ) {
      throw new DomainRuleViolation('CONTEXT_STALE', 'CONTEXT_STALE', {
        currentVersion: session.rowVersion,
      });
    }
    if (session.status !== 'ACTIVE') {
      throw new DomainRuleViolation(
        'WORK_SESSION_BLOCKED',
        'WORK_SESSION_BLOCKED',
      );
    }
    if (session.activeTurnId) {
      throw new DomainRuleViolation(
        'WORK_TURN_ALREADY_ACTIVE',
        'WORK_TURN_ALREADY_ACTIVE',
      );
    }
    if (
      input.request.contextBindingIds.length === 0 ||
      input.request.contextBindingIds.length > 50 ||
      new Set(input.request.contextBindingIds).size !==
        input.request.contextBindingIds.length
    ) {
      throw new DomainRuleViolation(
        'TRANSMISSION_AUTH_REQUIRED',
        'TRANSMISSION_AUTH_REQUIRED',
      );
    }
    const candidates = await this.input.repository.resolveContextCandidates({
      requirementId: session.requirementId,
      baselineId: anchor.baselineId,
      targetIds: input.request.contextBindingIds,
    });
    if (candidates.length !== input.request.contextBindingIds.length) {
      throw new DomainRuleViolation('CONTEXT_STALE', 'CONTEXT_STALE');
    }
    await this.assertAccess(
      input.actor,
      session.requirementId,
      'TRANSMIT_MATERIAL',
      sensitivityFor(candidates.map((item) => item.sensitivity)),
      { target: 'APPROVED_AI', purpose: 'product-work-session' },
      candidates.map((item) => item.targetId),
    );
    const skillReleaseId = input.request.skillReleaseId;
    if (!skillReleaseId) {
      throw new DomainRuleViolation(
        'BRIDGE_CAPABILITY_UNAVAILABLE',
        'Skill release is required.',
      );
    }
    const capability = await this.input.repository.resolveProductWorkCapability(
      {
        teamId: session.teamId,
        skillReleaseId,
        at: this.now(),
      },
    );
    if (!capability) {
      throw new DomainRuleViolation(
        'BRIDGE_CAPABILITY_UNAVAILABLE',
        'BRIDGE_CAPABILITY_UNAVAILABLE',
      );
    }
    const occurredAt = this.now();
    const received = createProductWorkTurn({
      id: this.idFactory('work-turn'),
      sessionId: session.id,
      sequence:
        (await this.input.repository.listTurns(session.id, 100)).length + 1,
      intentKind: input.request.intentKind,
      inputText: input.request.message,
      skillReleaseId: capability.skillReleaseId,
      createdBy: input.actor.actorId,
      createdAt: occurredAt,
      contentRetentionUntil: new Date(
        Date.parse(occurredAt) + 30 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
    });
    const turn = transitionProductWorkTurn(received, 'QUEUED', {
      occurredAt,
      bridgeId: capability.bridgeId,
    });
    const contexts = candidates.map((candidate) => ({
      schemaVersion: 'product-work-context-binding/1' as const,
      id: this.idFactory('work-context'),
      sessionId: session.id,
      turnId: turn.id,
      ...candidate,
      bindingRole: 'SOURCE' as const,
      invalidatedAt: null,
      reasonCode: null,
      createdAt: occurredAt,
    }));
    const contextHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify(
          contexts.map((item) => ({
            id: item.id,
            targetId: item.targetId,
            targetVersion: item.targetVersion,
            contentHash: item.contentHash,
          })),
        ),
      )
      .digest('hex')}`;
    await this.input.repository.createTurn({
      turn,
      expectedSessionVersion: input.expectedSessionVersion,
      contexts,
      command: {
        id: this.idFactory('work-turn-command'),
        turnId: turn.id,
        commandType: 'START_PRODUCT_WORK_TURN',
        payloadSummary: {
          sessionId: session.id,
          turnId: turn.id,
          contextBindingIds: contexts.map((item) => item.id),
          contextHash,
        },
        requiredCapability: 'product-work-turn/1',
        idempotencyKey: input.idempotencyKey,
        createdAt: occurredAt,
      },
      event: this.event(
        session.id,
        session.lastSequence + 1,
        'TURN_QUEUED',
        'product-work-turn',
        turn.id,
        occurredAt,
        { turnId: turn.id, status: turn.status, contextCount: contexts.length },
      ),
    });
    return { replayed: false, turn };
  }

  async controlSession(input: {
    actor: ActorContext;
    sessionId: string;
    action: WorkSessionControlAction;
    expectedRowVersion: number;
  }) {
    const { session, anchor } = await this.requireSession(
      input.actor,
      input.sessionId,
    );
    await this.assertAccess(
      input.actor,
      session.requirementId,
      'CONTROL_WORK_SESSION',
      anchor.sensitivity,
    );
    if (session.rowVersion !== input.expectedRowVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Session version conflict.',
        {
          currentVersion: session.rowVersion,
        },
      );
    }
    const occurredAt = this.now();
    const nextStatus =
      input.action === 'ARCHIVE'
        ? 'ARCHIVED'
        : input.action === 'COMPLETE'
          ? 'COMPLETED'
          : 'ACTIVE';
    const updated = transitionProductWorkSession(session, nextStatus, {
      occurredAt,
      controlAction: input.action,
      accessRevalidated: input.action === 'RESUME',
      currentRequirementVersion: anchor.requirementVersion,
    });
    const eventType =
      input.action === 'ARCHIVE'
        ? 'SESSION_ARCHIVED'
        : input.action === 'COMPLETE'
          ? 'SESSION_COMPLETED'
          : 'SESSION_RESUMED';
    return this.input.repository.updateSession({
      session: updated,
      expectedRowVersion: input.expectedRowVersion,
      event: this.event(
        session.id,
        session.lastSequence + 1,
        eventType,
        'product-work-session',
        session.id,
        occurredAt,
        { status: updated.status },
      ),
    });
  }

  async controlTurn(input: {
    actor: ActorContext;
    turnId: string;
    action: WorkTurnControlAction;
    expectedTurnVersion: number;
    idempotencyKey: string;
  }) {
    const turn = await this.input.repository.findTurn(input.turnId);
    if (!turn)
      throw new DomainRuleViolation('NOT_FOUND', 'Work turn not found.');
    const { session, anchor } = await this.requireSession(
      input.actor,
      turn.sessionId,
    );
    await this.assertAccess(
      input.actor,
      session.requirementId,
      'CONTROL_WORK_SESSION',
      anchor.sensitivity,
    );
    if (turn.rowVersion !== input.expectedTurnVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Turn version conflict.',
        {
          currentVersion: turn.rowVersion,
        },
      );
    }
    const occurredAt = this.now();
    if (input.action === 'VERIFY' && turn.status !== 'UNKNOWN') {
      throw new DomainRuleViolation(
        'INVALID_STATE_TRANSITION',
        'Only UNKNOWN turns can be verified.',
      );
    }
    const updated = transitionProductWorkTurn(
      turn,
      input.action === 'VERIFY' ? 'UNKNOWN' : 'CANCELLING',
      {
        occurredAt,
        verificationOnly: input.action === 'VERIFY',
        failureReason:
          input.action === 'VERIFY'
            ? (turn.failureReason ?? 'RUN_STATE_UNAVAILABLE')
            : undefined,
      },
    );
    return this.input.repository.updateTurn({
      turn: updated,
      expectedTurnVersion: input.expectedTurnVersion,
      expectedSessionVersion: session.rowVersion,
      command: {
        id: this.idFactory('work-turn-command'),
        turnId: turn.id,
        commandType:
          input.action === 'VERIFY'
            ? 'VERIFY_PRODUCT_WORK_TURN'
            : 'INTERRUPT_PRODUCT_WORK_TURN',
        payloadSummary: { sessionId: session.id, turnId: turn.id },
        requiredCapability: 'product-work-turn/1',
        idempotencyKey: input.idempotencyKey,
        createdAt: occurredAt,
      },
      event: this.event(
        session.id,
        session.lastSequence + 1,
        input.action === 'VERIFY' ? 'TURN_UNKNOWN' : 'TURN_CANCEL_REQUESTED',
        'product-work-turn',
        turn.id,
        occurredAt,
        { turnId: turn.id, status: updated.status },
      ),
    });
  }

  async decideProposal(input: {
    actor: ActorContext;
    proposalId: string;
    request: ActionProposalDecisionRequest;
    expectedProposalVersion: number;
  }) {
    const proposal = await this.input.repository.findProposal(input.proposalId);
    if (!proposal) {
      throw new DomainRuleViolation('NOT_FOUND', 'Action proposal not found.');
    }
    const { session, anchor } = await this.requireSession(
      input.actor,
      proposal.sessionId,
    );
    await this.assertAccess(
      input.actor,
      session.requirementId,
      'DECIDE_ACTION_PROPOSAL',
      anchor.sensitivity,
    );
    if (!input.actor.roles.includes(proposal.confirmationRequirement)) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Proposal confirmation role is required.',
      );
    }
    const currentTargetVersion =
      await this.input.repository.resolveTargetVersion(proposal.target);
    if (currentTargetVersion === null) {
      throw new DomainRuleViolation('NOT_FOUND', 'Proposal target not found.');
    }
    const decided = decideActionProposal(proposal, {
      decision: input.request.decision,
      actorId: input.actor.actorId,
      decidedAt: this.now(),
      expectedRowVersion: input.expectedProposalVersion,
      currentTargetVersion,
      scopeHash: input.request.scopeHash,
      reasonCode: input.request.reasonCode,
    });
    const updated = await this.input.repository.updateProposal({
      proposal: decided,
      expectedProposalVersion: input.expectedProposalVersion,
      expectedSessionVersion: session.rowVersion,
      event: this.event(
        session.id,
        session.lastSequence + 1,
        decided.status === 'STALE' ? 'PROPOSAL_STALE' : 'PROPOSAL_DECIDED',
        'product-action-proposal',
        proposal.id,
        decided.updatedAt,
        {
          proposalId: proposal.id,
          kind: proposal.kind,
          status: decided.status,
        },
      ),
    });
    if (updated.status === 'STALE') {
      throw new DomainRuleViolation('PROPOSAL_STALE', 'PROPOSAL_STALE');
    }
    return updated;
  }

  async events(actor: ActorContext, sessionId: string, afterSequence: number) {
    const { session, anchor } = await this.requireSession(actor, sessionId);
    await this.assertAccess(
      actor,
      session.requirementId,
      'VIEW_WORK_SESSION',
      anchor.sensitivity,
    );
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Event cursor is invalid.',
      );
    }
    const result = await this.input.repository.listEvents(
      session.id,
      afterSequence,
      200,
    );
    return {
      sessionId: session.id,
      afterSequence,
      nextSequence: result.items.at(-1)?.sequence ?? null,
      reloadRequired: result.reloadRequired,
      items: result.items,
    };
  }
}
