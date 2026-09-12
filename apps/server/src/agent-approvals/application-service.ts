import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  AgentApprovalDecisionRequest,
  MutationEvidence,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type {
  AgentApprovalRepositoryPort,
  AgentApprovalRunRepositoryPort,
} from './repository-port.ts';

function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class AgentApprovalApplicationService {
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(
    private readonly input: {
      repository: AgentApprovalRepositoryPort;
      runRepository: AgentApprovalRunRepositoryPort;
      authorization: RequirementAuthorizationService;
      now?: () => string;
      idFactory?: (prefix: string) => string;
    },
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory =
      input.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  private async authorize(
    actor: ActorContext,
    runId: string,
  ): Promise<
    NonNullable<Awaited<ReturnType<AgentApprovalRunRepositoryPort['findRun']>>>
  > {
    const run = await this.input.runRepository.findRun(runId);
    if (!run) throw new DomainRuleViolation('NOT_FOUND', 'AgentRun not found.');
    const sensitivity =
      await this.input.runRepository.findRunSensitivity(runId);
    const decision = await this.input.authorization.authorize(actor, {
      requirementId: run.requirementId,
      action: 'APPROVE_AGENT_ACTION',
      sensitivity: sensitivity ?? 'UNKNOWN',
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'Agent approval access denied.',
      );
    }
    return run;
  }

  async list(actor: ActorContext, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Approval list limit is invalid.',
      );
    }
    const candidates = await this.input.repository.listPendingForActor({
      actorId: actor.actorId,
      limit,
    });
    const allowed = [];
    for (const approval of candidates) {
      try {
        await this.authorize(actor, approval.runId);
        allowed.push(approval);
      } catch {
        // Do not disclose approvals outside the actor's current scope.
      }
    }
    return { items: allowed };
  }

  async get(actor: ActorContext, runId: string, approvalId: string) {
    const approval = await this.input.repository.findApproval(approvalId);
    if (!approval || approval.runId !== runId) {
      throw new DomainRuleViolation('NOT_FOUND', 'Approval not found.');
    }
    await this.authorize(actor, runId);
    return approval;
  }

  async decide(input: {
    actor: ActorContext;
    approvalId: string;
    expectedRowVersion: number;
    request: AgentApprovalDecisionRequest;
    idempotencyKey: string;
    requestId: string;
  }) {
    const approval = await this.input.repository.findApproval(input.approvalId);
    if (!approval) {
      throw new DomainRuleViolation('NOT_FOUND', 'Approval not found.');
    }
    const run = await this.authorize(input.actor, approval.runId);
    if (approval.requestedBy === input.actor.actorId) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Four-eyes approval is required.',
      );
    }
    if (
      approval.kind === 'COMMAND_EXECUTION' &&
      !input.actor.roles.some((role) =>
        ['ENGINEERING_OWNER', 'TEAM_ADMIN'].includes(role),
      )
    ) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Command approval requires an engineering owner.',
      );
    }
    if (
      input.request.decision === 'APPROVED' &&
      (approval.outsideCapsule ||
        approval.requestedScope.networkAccess ||
        !input.request.approvedScope)
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Approval cannot grant network or outside-capsule access.',
      );
    }
    const occurredAt = this.now();
    const route = `/api/v1/agent-approvals/${approval.id}/decision`;
    const mutation: MutationEvidence = {
      actorId: input.actor.actorId,
      eventId: this.idFactory('timeline'),
      outboxId: this.idFactory('outbox'),
      auditId: this.idFactory('audit'),
      requestId: input.requestId,
      eventType: 'agent-approval.resolved',
      aggregateType: 'agent-approval',
      aggregateId: approval.id,
      aggregateVersion: input.expectedRowVersion + 1,
      requirementId: run.requirementId,
      occurredAt,
      route,
      idempotencyKey: input.idempotencyKey,
      requestHash: hashRequest(input.request),
      idempotencyId: this.idFactory('idempotency'),
    };
    let result;
    try {
      result = await this.input.repository.decideApproval({
        approvalId: approval.id,
        expectedRowVersion: input.expectedRowVersion,
        decision: {
          decision: input.request.decision,
          approvedScope: input.request.approvedScope,
          decidedBy: input.actor.actorId,
          decidedAt: occurredAt,
          reasonCode: input.request.reasonCode,
        },
        eventId: this.idFactory('agent-event'),
        command: {
          id: this.idFactory('bridge-command'),
          idempotencyKey: `${approval.id}:decision:${input.expectedRowVersion}`,
          payload: {},
          runQueuedEventId: this.idFactory('agent-event'),
        },
        mutation,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (
        code === 'AGENT_APPROVAL_FOUR_EYES_REQUIRED' ||
        code === 'AGENT_APPROVAL_OUTSIDE_CAPSULE'
      ) {
        throw new DomainRuleViolation('PERMISSION_DENIED', code);
      }
      if (
        code === 'AGENT_APPROVAL_TERMINAL' ||
        code === 'AGENT_APPROVAL_EXPIRED' ||
        code === 'AGENT_RUN_START_CONTEXT_STALE'
      ) {
        throw new DomainRuleViolation('VERSION_CONFLICT', code);
      }
      if (code.startsWith('AGENT_APPROVAL_')) {
        throw new DomainRuleViolation('VALIDATION_FAILED', code);
      }
      throw error;
    }
    if (result.status === 'CONFLICT' || !result.approval) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Approval has changed.',
        { currentVersion: result.approval?.rowVersion },
      );
    }
    return result.approval;
  }
}
