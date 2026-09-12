import { createHash, randomUUID } from 'node:crypto';

import type { ActionProposalDto } from '@pfc/contracts';
import { createActionProposal, DomainRuleViolation } from '@pfc/domain';
import type { ProductWorkTurnEvent } from '@pfc/protocol';

import type { BridgeRequestContext } from '../bridges/repository-port.ts';
import type {
  ProductWorkTurnBridgeAuthPort,
  ProductWorkTurnBridgeRepositoryPort,
} from './bridge-repository-port.ts';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class ProductWorkTurnBridgeApplicationService {
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(
    private readonly input: {
      auth: ProductWorkTurnBridgeAuthPort;
      repository: ProductWorkTurnBridgeRepositoryPort;
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
    return this.input.repository.leaseNextProductWorkTurnCommand({
      bridgeId: context.bridgeId,
      leasedAt,
      leaseUntil: new Date(Date.parse(leasedAt) + 30_000).toISOString(),
    });
  }

  async context(context: BridgeRequestContext, commandId: string) {
    await this.authenticate(context);
    const result = await this.input.repository.readLeasedProductWorkTurnContext(
      {
        bridgeId: context.bridgeId,
        commandId,
        readAt: this.now(),
      },
    );
    if (!result) {
      throw new DomainRuleViolation(
        'CONTEXT_STALE',
        'Product work turn context is unavailable or stale.',
      );
    }
    return result;
  }

  private proposal(
    event: ProductWorkTurnEvent,
    sessionId: string,
    turnId: string,
  ): ActionProposalDto | undefined {
    if (event.eventType !== 'TURN_PROPOSAL_AVAILABLE') return undefined;
    const candidate = event.payload.proposal;
    if (
      !record(candidate) ||
      Object.keys(candidate).sort().join(',') !==
        'changeSet,confirmationRequirement,displayDiff,kind,target' ||
      !record(candidate.target) ||
      !record(candidate.changeSet) ||
      !Array.isArray(candidate.displayDiff) ||
      typeof candidate.kind !== 'string' ||
      typeof candidate.confirmationRequirement !== 'string'
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Product work turn proposal is invalid.',
      );
    }
    try {
      return createActionProposal({
        id: this.idFactory('product-action-proposal'),
        sessionId,
        turnId,
        kind: candidate.kind as ActionProposalDto['kind'],
        target: candidate.target as ActionProposalDto['target'],
        changeSet: candidate.changeSet as ActionProposalDto['changeSet'],
        displayDiff: candidate.displayDiff as ActionProposalDto['displayDiff'],
        confirmationRequirement:
          candidate.confirmationRequirement as ActionProposalDto['confirmationRequirement'],
        createdAt: event.occurredAt,
      });
    } catch {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Product work turn proposal is invalid.',
      );
    }
  }

  async submitEvent(
    context: BridgeRequestContext,
    input: {
      commandId: string;
      sessionId: string;
      turnId: string;
      event: ProductWorkTurnEvent;
    },
  ) {
    await this.authenticate(context);
    const receivedAt = this.now();
    const clockSkew = Math.abs(
      Date.parse(receivedAt) - Date.parse(input.event.occurredAt),
    );
    if (!Number.isFinite(clockSkew) || clockSkew > 5 * 60_000) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Product work turn event timestamp is outside the allowed window.',
      );
    }
    const proposal = this.proposal(input.event, input.sessionId, input.turnId);
    const result = await this.input.repository.appendProductWorkTurnBridgeEvent(
      {
        bridgeId: context.bridgeId,
        ...input,
        receivedAt,
        ...(proposal ? { proposal } : {}),
      },
    );
    if (result.status === 'COMMAND_INVALID') {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Bridge command does not own this product work turn.',
      );
    }
    return result;
  }

  async acknowledge(
    context: BridgeRequestContext,
    input: {
      commandId: string;
      sessionId: string;
      turnId: string;
      status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
      reasonCode?: string;
      threadId?: string;
      externalTurnId?: string;
    },
  ) {
    await this.authenticate(context);
    return this.input.repository.acknowledgeProductWorkTurnCommand({
      bridgeId: context.bridgeId,
      ...input,
      acknowledgedAt: this.now(),
    });
  }
}
