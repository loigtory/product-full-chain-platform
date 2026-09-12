import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  AgentRunEventsResponse,
  AgentRunMutationResponse,
  CreateAgentRunRequest,
  MutationEvidence,
} from '@pfc/contracts';
import {
  createAgentApproval,
  createAgentRun,
  DomainRuleViolation,
} from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type { AgentRunRepositoryPort } from './repository-port.ts';

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class AgentRunApplicationService {
  private readonly repository: AgentRunRepositoryPort;
  private readonly authorization: RequirementAuthorizationService;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(input: {
    repository: AgentRunRepositoryPort;
    authorization: RequirementAuthorizationService;
    now?: () => string;
    idFactory?: (prefix: string) => string;
  }) {
    this.repository = input.repository;
    this.authorization = input.authorization;
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory =
      input.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  private async assertAccess(
    actor: ActorContext,
    requirementId: string,
    action: 'RUN_AGENT' | 'RUN_AGENT_WRITE' | 'VIEW_AGENT_RUN',
    sensitivity: 'INTERNAL' | 'RESTRICTED' | 'PUBLIC' | 'UNKNOWN',
  ): Promise<void> {
    const decision = await this.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity,
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'AgentRun access denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  async create(input: {
    actor: ActorContext;
    requirementId: string;
    request: CreateAgentRunRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AgentRunMutationResponse> {
    const occurredAt = this.now();
    const workspaceWrite = input.request.accessMode === 'WORKSPACE_WRITE';
    const context = await this.repository.resolveCreationContext({
      requirementId: input.requirementId,
      baselineId: input.request.baselineId,
      workspaceId: input.request.workspaceId,
      skillKey: input.request.skillKey,
      skillVersion: input.request.skillVersion,
      operation: input.request.operation,
      activeAfter: new Date(Date.parse(occurredAt) - 90_000).toISOString(),
      checkedAt: occurredAt,
    });
    await this.assertAccess(
      input.actor,
      input.requirementId,
      workspaceWrite ? 'RUN_AGENT_WRITE' : 'RUN_AGENT',
      context?.sensitivity ?? 'UNKNOWN',
    );
    if (
      (workspaceWrite &&
        input.request.operation !== 'CONTROLLED_ARTIFACT_EDIT') ||
      (!workspaceWrite && input.request.operation !== 'ARTIFACT_CHECK')
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'AgentRun operation does not match access mode.',
      );
    }
    if (!context) {
      throw new DomainRuleViolation('NOT_FOUND', 'AgentRun context not found.');
    }
    if (context.currentBaselineId !== input.request.baselineId) {
      throw new DomainRuleViolation(
        'STALE_BASELINE_RESULT',
        'AgentRun baseline is stale.',
      );
    }
    if (
      context.workspaceId !== input.request.workspaceId ||
      context.workspaceVerificationStatus !== 'VERIFIED' ||
      (workspaceWrite
        ? context.workspaceAccessLevel !== 'WRITE'
        : !['READ', 'WRITE'].includes(context.workspaceAccessLevel))
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'AgentRun workspace is not verified.',
      );
    }
    if (!context.skillEnabled || context.skillEvaluationStatus !== 'PASSED') {
      throw new DomainRuleViolation(
        'DEPENDENCY_UNAVAILABLE',
        'SkillRelease is not enabled.',
      );
    }
    if (
      workspaceWrite &&
      (!input.request.writeScope ||
        input.request.writeScope.allowedRelativePaths.length !== 1 ||
        input.request.writeScope.allowedRelativePaths[0] !==
          context.artifactSourceRef)
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'AgentRun write scope must match the registered artifact.',
      );
    }
    const runScope = workspaceWrite
      ? {
          ...input.request.writeScope!,
          networkAccess: false as const,
          expiresAt: new Date(
            Date.parse(occurredAt) + 10 * 60_000,
          ).toISOString(),
        }
      : null;
    const runScopeHash = runScope
      ? `sha256:${createHash('sha256')
          .update(
            JSON.stringify({
              allowedRelativePaths: [...runScope.allowedRelativePaths].sort(),
              allowedActions: [...runScope.allowedActions].sort(),
              networkAccess: false,
              maxChangedFiles: runScope.maxChangedFiles,
              maxChangedBytes: runScope.maxChangedBytes,
              expiresAt: runScope.expiresAt,
            }),
          )
          .digest('hex')}`
      : null;
    const executionInstanceId = workspaceWrite
      ? this.idFactory('agent-execution')
      : null;
    const run = createAgentRun({
      id: this.idFactory('agent-run'),
      requirementId: input.requirementId,
      baselineId: input.request.baselineId,
      workspaceId: input.request.workspaceId,
      gitBaseline: context.currentGitBaseline,
      skillReleaseId: context.skillReleaseId,
      operation: input.request.operation,
      accessMode: input.request.accessMode,
      createdBy: input.actor.actorId,
      createdAt: occurredAt,
      executionInstanceId,
      runScope,
      runScopeHash,
    });
    const startApproval = workspaceWrite
      ? createAgentApproval({
          id: this.idFactory('agent-approval'),
          runId: run.id,
          executionInstanceId: run.executionInstanceId!,
          appServerRequestId: null,
          threadId: null,
          turnId: null,
          itemId: null,
          callbackId: null,
          kind: 'RUN_START',
          requestedScope: {
            allowedRelativePaths: run.runScope!.allowedRelativePaths,
            allowedActions: run.runScope!.allowedActions,
            networkAccess: false,
            maxChangedFiles: run.runScope!.maxChangedFiles,
            maxChangedBytes: run.runScope!.maxChangedBytes,
          },
          scopeHash: run.runScopeHash!,
          requestedBy: input.actor.actorId,
          requestedAt: occurredAt,
          expiresAt: run.runScope!.expiresAt,
        })
      : null;
    const route = `/api/v1/requirements/${input.requirementId}/agent-runs`;
    const evidence: MutationEvidence = {
      actorId: input.actor.actorId,
      eventId: this.idFactory('timeline'),
      outboxId: this.idFactory('outbox'),
      auditId: this.idFactory('audit'),
      requestId: input.requestId,
      eventType: 'agent-run.created',
      aggregateType: 'agent-run',
      aggregateId: run.id,
      aggregateVersion: 0,
      requirementId: input.requirementId,
      occurredAt,
      route,
      idempotencyKey: input.idempotencyKey,
      requestHash: requestHash(input.request),
      idempotencyId: this.idFactory('idempotency'),
    };
    const result = await this.repository.createRun({
      run,
      event: {
        id: this.idFactory('agent-event'),
        eventType: workspaceWrite ? 'APPROVAL_REQUESTED' : 'RUN_QUEUED',
        summary: {
          operation: run.operation,
          accessMode: run.accessMode,
          status: run.status,
          ...(startApproval
            ? {
                approvalId: startApproval.id,
                approvalKind: startApproval.kind,
                scopeHash: startApproval.scopeHash,
              }
            : {}),
        },
        sourceEventId: null,
        occurredAt,
        receivedAt: occurredAt,
      },
      command: workspaceWrite
        ? null
        : {
            id: this.idFactory('bridge-command'),
            commandType: 'START_READ_ONLY_RUN',
            idempotencyKey: `${run.id}:start`,
            payload: {
              runId: run.id,
              requirementId: run.requirementId,
              baselineId: run.baselineId,
              workspaceId: run.workspaceId,
              gitBaseline: run.gitBaseline,
              skillReleaseId: run.skillReleaseId,
              skillContentHash: context.skillContentHash,
              artifactVersionId: context.artifactVersionId,
              artifactSourceRef: context.artifactSourceRef,
              artifactContentHash: context.artifactContentHash,
              objectiveKey: 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK',
              accessMode: run.accessMode,
            },
            createdAt: occurredAt,
          },
      startApproval,
      approvalEvidence: startApproval
        ? {
            actorId: input.actor.actorId,
            eventId: this.idFactory('timeline'),
            outboxId: this.idFactory('outbox'),
            auditId: this.idFactory('audit'),
            requestId: input.requestId,
            eventType: 'agent-approval.requested',
            aggregateType: 'agent-approval',
            aggregateId: startApproval.id,
            aggregateVersion: 0,
            requirementId: input.requirementId,
            occurredAt,
          }
        : null,
      mutation: evidence,
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'AgentRun idempotency conflict.',
      );
    }
    if (!result.run) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'AgentRun result unknown.',
      );
    }
    return { replayed: result.status === 'REPLAYED', run: result.run };
  }

  async get(actor: ActorContext, runId: string) {
    const run = await this.repository.findRun(runId);
    if (!run) throw new DomainRuleViolation('NOT_FOUND', 'AgentRun not found.');
    const sensitivity = await this.repository.findRunSensitivity(runId);
    await this.assertAccess(
      actor,
      run.requirementId,
      'VIEW_AGENT_RUN',
      sensitivity ?? 'UNKNOWN',
    );
    return run;
  }

  async launchOptions(actor: ActorContext, requirementId: string) {
    const checkedAt = this.now();
    const context = await this.repository.resolveLaunchOptions({
      requirementId,
      activeAfter: new Date(Date.parse(checkedAt) - 90_000).toISOString(),
      checkedAt,
    });
    await this.assertAccess(
      actor,
      requirementId,
      'RUN_AGENT',
      context?.sensitivity ?? 'UNKNOWN',
    );
    if (!context) {
      throw new DomainRuleViolation(
        'DEPENDENCY_UNAVAILABLE',
        'No current AgentRun launch context is available.',
      );
    }
    return {
      requirementId: context.requirementId,
      baselineId: context.baselineId,
      artifactSourceRef: context.artifactSourceRef,
      workspaces: context.workspaces,
      skills: context.skills,
    };
  }

  async list(
    actor: ActorContext,
    limit: number,
  ): Promise<{ items: readonly import('@pfc/contracts').AgentRunDto[] }> {
    if (actor.authenticationStatus !== 'AUTHENTICATED') {
      throw new DomainRuleViolation(
        'AUTHENTICATION_REQUIRED',
        'Authentication required.',
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'AgentRun list limit is invalid.',
      );
    }
    return {
      items: await this.repository.listRunsForActor(actor.actorId, limit),
    };
  }

  async events(
    actor: ActorContext,
    runId: string,
    afterSequence: number,
    limit: number,
  ): Promise<AgentRunEventsResponse> {
    await this.get(actor, runId);
    const items = await this.repository.listEvents(runId, afterSequence, limit);
    return {
      runId,
      afterSequence,
      nextSequence: items.at(-1)?.sequence ?? null,
      items,
    };
  }
}
