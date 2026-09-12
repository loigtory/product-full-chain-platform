import { createHash, randomUUID } from 'node:crypto';

import { DomainRuleViolation } from '@pfc/domain';
import type { McpReadEvent } from '@pfc/protocol';

import type { BridgeRequestContext } from '../bridges/repository-port.ts';
import type { ProductWorkTurnBridgeAuthPort } from '../work-sessions/bridge-repository-port.ts';
import type { McpReadRepositoryPort } from './repository-port.ts';

export class McpReadBridgeApplicationService {
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(
    private readonly input: {
      auth: ProductWorkTurnBridgeAuthPort;
      repository: McpReadRepositoryPort;
      now?: () => string;
      idFactory?: (prefix: string) => string;
    },
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory =
      input.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  private async authenticate(context: BridgeRequestContext): Promise<void> {
    const receivedAt = this.now();
    const skew = Math.abs(Date.parse(receivedAt) - Date.parse(context.sentAt));
    if (!Number.isFinite(skew) || skew > 120_000) {
      throw new DomainRuleViolation(
        'AUTHENTICATION_FAILED',
        'Bridge timestamp is invalid.',
      );
    }
    const credentialDigest = `sha256:${createHash('sha256')
      .update(context.credential)
      .digest('hex')}`;
    const authenticated = await this.input.auth.authenticateMessage({
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
    return this.input.repository.leaseNextCommand({
      bridgeId: context.bridgeId,
      leasedAt,
      leaseUntil: new Date(Date.parse(leasedAt) + 30_000).toISOString(),
    });
  }

  async context(context: BridgeRequestContext, commandId: string) {
    await this.authenticate(context);
    const result = await this.input.repository.readLeasedContext({
      bridgeId: context.bridgeId,
      commandId,
      readAt: this.now(),
    });
    if (!result)
      throw new DomainRuleViolation(
        'CONTEXT_STALE',
        'MCP read context is stale.',
      );
    return result;
  }

  async submitEvent(
    context: BridgeRequestContext,
    commandId: string,
    event: McpReadEvent,
  ) {
    await this.authenticate(context);
    const receivedAt = this.now();
    const skew = Math.abs(
      Date.parse(receivedAt) - Date.parse(event.occurredAt),
    );
    if (!Number.isFinite(skew) || skew > 5 * 60_000) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'MCP event timestamp is invalid.',
      );
    }
    const result = await this.input.repository.appendEvent({
      bridgeId: context.bridgeId,
      commandId,
      event,
      receivedAt,
      sessionEventId: this.idFactory('mcp-session-event'),
      evidenceId: this.idFactory('mcp-execution-evidence'),
      operation: {
        actorId: this.idFactory('bridge-actor'),
        eventId: this.idFactory('mcp-result-timeline'),
        outboxId: this.idFactory('mcp-result-outbox'),
        auditId: this.idFactory('mcp-result-audit'),
        requestId: context.messageId,
        eventType: `mcp.read.${event.eventType.toLowerCase()}`,
        aggregateType: 'mcp-read-request',
        requirementId: undefined,
        route: '/bridge/v1/mcp-read-requests/events',
        idempotencyKey: event.sourceEventId,
        requestHash: `sha256:${createHash('sha256').update(JSON.stringify(event)).digest('hex')}`,
        idempotencyId: this.idFactory('mcp-result-idempotency'),
      },
    });
    if (result === 'COMMAND_INVALID') {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Bridge command does not own this MCP request.',
      );
    }
    return { status: result };
  }
}
