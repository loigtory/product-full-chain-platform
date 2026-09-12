import { createHash, randomUUID } from 'node:crypto';

import type {
  AgentApprovalKind,
  AgentApprovalScopeDto,
  AgentRunEventType,
  MutationEvidence,
} from '@pfc/contracts';
import { createAgentApproval, DomainRuleViolation } from '@pfc/domain';
import type { BridgeCapabilitySnapshot } from '../../../../packages/protocol/src/index.ts';

import type {
  BridgeRequestContext,
  BridgeRuntimeRepositoryPort,
} from './repository-port.ts';

type NormalizedEvent = Readonly<{
  eventType: AgentRunEventType;
  summary: Readonly<Record<string, string | number | boolean | null>>;
}>;

function approvalScopeHash(scope: AgentApprovalScopeDto): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify({
        allowedRelativePaths: [...scope.allowedRelativePaths].sort(),
        allowedActions: [...scope.allowedActions].sort(),
        networkAccess: scope.networkAccess,
        maxChangedFiles: scope.maxChangedFiles,
        maxChangedBytes: scope.maxChangedBytes,
      }),
    )
    .digest('hex')}`;
}

function approvalRequestHash(input: {
  runId: string;
  executionInstanceId: string;
  appServerRequestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  callbackId: string | null;
  kind: AgentApprovalKind;
  requestedScope: AgentApprovalScopeDto;
  outsideCapsule: boolean;
}): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')}`;
}

export class BridgeApplicationService {
  private readonly now: () => string;
  private readonly eventIdFactory: () => string;

  constructor(
    private readonly input: {
      repository: BridgeRuntimeRepositoryPort;
      now?: () => string;
      eventIdFactory?: () => string;
    },
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.eventIdFactory =
      input.eventIdFactory ?? (() => `bridge-event-${randomUUID()}`);
  }

  private async authenticate(context: BridgeRequestContext): Promise<void> {
    const receivedAt = this.now();
    const clockSkew = Math.abs(
      Date.parse(receivedAt) - Date.parse(context.sentAt),
    );
    if (!Number.isFinite(clockSkew) || clockSkew > 120_000) {
      throw new DomainRuleViolation(
        'AUTHENTICATION_FAILED',
        'Bridge message timestamp is outside the allowed window.',
      );
    }
    const credentialDigest = `sha256:${createHash('sha256')
      .update(context.credential)
      .digest('hex')}`;
    const authenticated = await this.input.repository.authenticateMessage({
      bridgeId: context.bridgeId,
      credentialDigest,
      messageId: context.messageId,
      nonce: context.nonce,
      sentAt: context.sentAt,
      receivedAt,
    });
    if (!authenticated) {
      throw new DomainRuleViolation(
        'AUTHENTICATION_FAILED',
        'Bridge authentication failed.',
      );
    }
  }

  async nextCommand(context: BridgeRequestContext) {
    await this.authenticate(context);
    const leasedAt = this.now();
    await this.input.repository.expireDueApprovals({
      expiredAt: leasedAt,
      limit: 20,
      idPrefix: this.eventIdFactory(),
    });
    const leaseUntil = new Date(Date.parse(leasedAt) + 30_000).toISOString();
    return this.input.repository.leaseNextCommand({
      bridgeId: context.bridgeId,
      leasedAt,
      leaseUntil,
      eventId: this.eventIdFactory(),
    });
  }

  async reportCapabilities(
    context: BridgeRequestContext,
    snapshot: BridgeCapabilitySnapshot,
  ) {
    await this.authenticate(context);
    const receivedAt = this.now();
    const clockSkew = Math.abs(
      Date.parse(receivedAt) - Date.parse(snapshot.capturedAt),
    );
    if (!Number.isFinite(clockSkew) || clockSkew > 5 * 60_000) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge capability timestamp is outside the allowed window.',
      );
    }
    const recorded = await this.input.repository.recordCapabilitySnapshot({
      id: this.eventIdFactory(),
      bridgeId: context.bridgeId,
      snapshot,
      receivedAt,
      expiresAt: new Date(Date.parse(receivedAt) + 90_000).toISOString(),
    });
    if (!recorded) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Bridge capabilities do not match registered bindings.',
      );
    }
    return {
      status: 'RECORDED' as const,
      expiresAt: new Date(Date.parse(receivedAt) + 90_000).toISOString(),
    };
  }

  async submitEvent(
    context: BridgeRequestContext,
    input: {
      commandId: string;
      runId: string;
      sourceEventId: string;
      expectedSequence: number;
      event: NormalizedEvent;
      occurredAt: string;
    },
  ) {
    await this.authenticate(context);
    const receivedAt = this.now();
    const eventClockSkew = Math.abs(
      Date.parse(receivedAt) - Date.parse(input.occurredAt),
    );
    if (!Number.isFinite(eventClockSkew) || eventClockSkew > 5 * 60_000) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge event timestamp is outside the allowed window.',
      );
    }
    const result = await this.input.repository.appendEvent({
      id: this.eventIdFactory(),
      commandId: input.commandId,
      runId: input.runId,
      expectedSequence: input.expectedSequence,
      bridgeId: context.bridgeId,
      sourceEventId: input.sourceEventId,
      eventType: input.event.eventType,
      summary: input.event.summary,
      occurredAt: input.occurredAt,
      receivedAt,
    });
    if (result.status === 'COMMAND_INVALID') {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Bridge command does not own this run.',
      );
    }
    return result;
  }

  async acknowledge(
    context: BridgeRequestContext,
    input: {
      commandId: string;
      runId: string;
      status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
      reasonCode?: string;
      threadId?: string;
      turnId?: string;
      acknowledgedAt: string;
    },
  ) {
    await this.authenticate(context);
    return this.input.repository.acknowledgeCommand({
      bridgeId: context.bridgeId,
      commandId: input.commandId,
      runId: input.runId,
      status: input.status,
      reasonCode: input.reasonCode,
      threadId: input.threadId,
      turnId: input.turnId,
      acknowledgedAt: this.now(),
    });
  }

  async submitApproval(
    context: BridgeRequestContext,
    input: {
      commandId: string;
      runId: string;
      executionInstanceId: string;
      appServerRequestId: string;
      threadId: string;
      turnId: string;
      itemId: string;
      callbackId: string | null;
      kind: AgentApprovalKind;
      requestedScope: AgentApprovalScopeDto;
      outsideCapsule: boolean;
      requestedAt: string;
    },
  ) {
    await this.authenticate(context);
    const receivedAt = this.now();
    const clockSkew = Math.abs(
      Date.parse(receivedAt) - Date.parse(input.requestedAt),
    );
    if (!Number.isFinite(clockSkew) || clockSkew > 5 * 60_000) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge approval timestamp is outside the allowed window.',
      );
    }
    const commandOwnsRun = await this.input.repository.commandOwnsRun({
      bridgeId: context.bridgeId,
      commandId: input.commandId,
      runId: input.runId,
      executionInstanceId: input.executionInstanceId,
    });
    const run = commandOwnsRun
      ? await this.input.repository.findRun(input.runId)
      : null;
    if (
      !run ||
      run.bridgeId !== context.bridgeId ||
      run.executionInstanceId !== input.executionInstanceId ||
      run.accessMode !== 'WORKSPACE_WRITE' ||
      run.status !== 'RUNNING'
    ) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Bridge approval does not match the active run.',
      );
    }
    const scopeHash = approvalScopeHash(input.requestedScope);
    const approval = createAgentApproval({
      id: this.eventIdFactory(),
      runId: run.id,
      executionInstanceId: input.executionInstanceId,
      appServerRequestId: input.appServerRequestId,
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: input.itemId,
      callbackId: input.callbackId,
      kind: input.kind,
      requestedScope: input.requestedScope,
      scopeHash,
      outsideCapsule: input.outsideCapsule,
      requestedBy: run.createdBy,
      requestedAt: input.requestedAt,
      expiresAt: new Date(Date.parse(receivedAt) + 10 * 60_000).toISOString(),
    });
    const mutation: MutationEvidence = {
      actorId: run.createdBy,
      eventId: this.eventIdFactory(),
      outboxId: this.eventIdFactory(),
      auditId: this.eventIdFactory(),
      requestId: context.messageId,
      eventType: 'agent-approval.requested',
      aggregateType: 'agent-approval',
      aggregateId: approval.id,
      aggregateVersion: 0,
      requirementId: run.requirementId,
      occurredAt: receivedAt,
      route: `/bridge/v1/runs/${run.id}/approvals`,
      idempotencyKey: `${run.id}:${input.executionInstanceId}:${input.appServerRequestId}`,
      requestHash: approvalRequestHash({
        runId: run.id,
        executionInstanceId: input.executionInstanceId,
        appServerRequestId: input.appServerRequestId,
        threadId: input.threadId,
        turnId: input.turnId,
        itemId: input.itemId,
        callbackId: input.callbackId,
        kind: input.kind,
        requestedScope: input.requestedScope,
        outsideCapsule: input.outsideCapsule,
      }),
      idempotencyId: this.eventIdFactory(),
    };
    const result = await this.input.repository.createApproval({
      approval,
      eventId: this.eventIdFactory(),
      mutation,
    });
    if (result.status === 'CONFLICT' || result.afterSequence === null) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Approval request conflicts with current run state.',
      );
    }
    return {
      approvalId: result.approval?.id ?? approval.id,
      afterSequence: result.afterSequence,
      replayed: result.status === 'REPLAYED',
    };
  }

  async reportCapsule(
    context: BridgeRequestContext,
    input: Omit<
      Parameters<BridgeRuntimeRepositoryPort['recordCapsule']>[0],
      'id' | 'eventId' | 'bridgeId'
    >,
  ) {
    await this.authenticate(context);
    const receivedAt = this.now();
    const clockSkew = Math.abs(
      Date.parse(receivedAt) - Date.parse(input.occurredAt),
    );
    if (!Number.isFinite(clockSkew) || clockSkew > 5 * 60_000) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge capsule timestamp is outside the allowed window.',
      );
    }
    const recorded = await this.input.repository.recordCapsule({
      ...input,
      id: this.eventIdFactory(),
      eventId: this.eventIdFactory(),
      bridgeId: context.bridgeId,
      occurredAt: receivedAt,
    });
    if (!recorded) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Capsule evidence does not match the active run.',
      );
    }
    return { status: 'RECORDED' as const };
  }
}
