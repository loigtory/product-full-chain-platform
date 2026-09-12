import type { ActorContext } from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type { AgentAuditRepositoryPort } from './repository-port.ts';

export class AgentAuditApplicationService {
  private readonly now: () => string;

  constructor(
    private readonly input: {
      repository: AgentAuditRepositoryPort;
      authorization: RequirementAuthorizationService;
      now?: () => string;
    },
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
  }

  async list(actor: ActorContext, runId: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Audit limit is invalid.',
      );
    }
    const run = await this.input.repository.findRun(runId);
    if (!run) throw new DomainRuleViolation('NOT_FOUND', 'AgentRun not found.');
    const sensitivity = await this.input.repository.findRunSensitivity(runId);
    const authorization = await this.input.authorization.authorize(actor, {
      requirementId: run.requirementId,
      action: 'VIEW_AGENT_AUDIT',
      sensitivity: sensitivity ?? 'UNKNOWN',
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (authorization.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        authorization.code ?? 'PERMISSION_DENIED',
        'Agent audit access denied.',
      );
    }
    return {
      runId,
      items: await this.input.repository.listRunAudit(runId, limit),
    };
  }
}
