import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  AgentControlAction,
  MutationEvidence,
  RequirementAction,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type { AgentControlRepositoryPort } from './repository-port.ts';

function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function actionPermission(action: AgentControlAction): RequirementAction {
  return action === 'CANCEL'
    ? 'CANCEL_AGENT_RUN'
    : action === 'VERIFY_UNKNOWN'
      ? 'VERIFY_AGENT_RUN'
      : 'RUN_AGENT_WRITE';
}

export class AgentControlApplicationService {
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(
    private readonly input: {
      repository: AgentControlRepositoryPort;
      authorization: RequirementAuthorizationService;
      now?: () => string;
      idFactory?: (prefix: string) => string;
    },
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory =
      input.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  async control(input: {
    actor: ActorContext;
    runId: string;
    expectedRowVersion: number;
    action: AgentControlAction;
    reasonCode: string;
    idempotencyKey: string;
    requestId: string;
  }) {
    const run = await this.input.repository.findRun(input.runId);
    if (!run) throw new DomainRuleViolation('NOT_FOUND', 'AgentRun not found.');
    const sensitivity = await this.input.repository.findRunSensitivity(run.id);
    const authorization = await this.input.authorization.authorize(
      input.actor,
      {
        requirementId: run.requirementId,
        action: actionPermission(input.action),
        sensitivity: sensitivity ?? 'UNKNOWN',
        materialRefIds: [],
        requestedAt: this.now(),
      },
    );
    if (authorization.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        authorization.code ?? 'PERMISSION_DENIED',
        'Agent control access denied.',
      );
    }
    const occurredAt = this.now();
    const route = `/api/v1/agent-runs/${run.id}/controls`;
    const childRunId = this.idFactory('agent-run');
    const mutation: MutationEvidence = {
      actorId: input.actor.actorId,
      eventId: this.idFactory('timeline'),
      outboxId: this.idFactory('outbox'),
      auditId: this.idFactory('audit'),
      requestId: input.requestId,
      eventType: `agent-run.${input.action.toLowerCase()}`,
      aggregateType: 'agent-run',
      aggregateId: run.id,
      aggregateVersion: run.rowVersion + 1,
      requirementId: run.requirementId,
      occurredAt,
      route,
      idempotencyKey: input.idempotencyKey,
      requestHash: hashRequest({
        action: input.action,
        reasonCode: input.reasonCode,
        expectedRowVersion: input.expectedRowVersion,
      }),
      idempotencyId: this.idFactory('idempotency'),
    };
    const result = await this.input.repository.controlRun({
      action: input.action,
      runId: run.id,
      expectedRowVersion: input.expectedRowVersion,
      reasonCode: input.reasonCode,
      actorId: input.actor.actorId,
      occurredAt,
      commandId: this.idFactory('bridge-command'),
      eventIdPrefix: this.idFactory('agent-event'),
      childRunId,
      childExecutionInstanceId: this.idFactory('execution'),
      childScopeExpiresAt: new Date(
        Date.parse(occurredAt) + 10 * 60_000,
      ).toISOString(),
      mutation,
    });
    if (result.status === 'CONFLICT' || !result.run) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'AgentRun has changed.',
        {
          currentVersion: result.run?.rowVersion,
        },
      );
    }
    return {
      replayed: result.status === 'REPLAYED',
      run: result.run,
      childRun: result.childRun,
    };
  }

  async revokeBridge(input: {
    actor: ActorContext;
    bridgeId: string;
    reasonCode: string;
    expectedActiveRunCount: number;
    idempotencyKey: string;
    requestId: string;
  }) {
    const bridge = await this.input.repository.findBridge(input.bridgeId);
    if (!bridge)
      throw new DomainRuleViolation('NOT_FOUND', 'Bridge not found.');
    if (
      input.actor.authenticationStatus !== 'AUTHENTICATED' ||
      !input.actor.roles.includes('TEAM_ADMIN') ||
      !input.actor.teamIds.includes(bridge.teamId)
    ) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Bridge revocation requires its team administrator.',
      );
    }
    if (bridge.activeRunCount !== input.expectedActiveRunCount) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Bridge active run count has changed.',
      );
    }
    const occurredAt = this.now();
    const route = `/api/v1/bridges/${bridge.id}/revocations`;
    const mutation: MutationEvidence = {
      actorId: input.actor.actorId,
      eventId: this.idFactory('timeline'),
      outboxId: this.idFactory('outbox'),
      auditId: this.idFactory('audit'),
      requestId: input.requestId,
      eventType: 'bridge.revoked',
      aggregateType: 'bridge',
      aggregateId: bridge.id,
      aggregateVersion: 1,
      occurredAt,
      route,
      idempotencyKey: input.idempotencyKey,
      requestHash: hashRequest({
        reasonCode: input.reasonCode,
        expectedActiveRunCount: input.expectedActiveRunCount,
      }),
      idempotencyId: this.idFactory('idempotency'),
    };
    const result = await this.input.repository.revokeBridge({
      bridgeId: bridge.id,
      actorId: input.actor.actorId,
      reasonCode: input.reasonCode,
      expectedActiveRunCount: input.expectedActiveRunCount,
      occurredAt,
      commandIdPrefix: this.idFactory('bridge-command'),
      eventIdPrefix: this.idFactory('agent-event'),
      mutation,
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Bridge state has changed.',
      );
    }
    return {
      replayed: result.status === 'REPLAYED',
      status: 'REVOKED' as const,
      affectedRunCount: result.affectedRunCount,
    };
  }
}
