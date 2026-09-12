import { createHash } from 'node:crypto';

import type { MutationEvidence, OperationEvidence } from '@pfc/contracts';

export function hashMutationRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createOperationEvidence(input: {
  actorId: string;
  requestId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  requirementId?: string;
  occurredAt: string;
  idFactory: (prefix: string) => string;
}): OperationEvidence {
  return {
    actorId: input.actorId,
    eventId: input.idFactory('timeline'),
    outboxId: input.idFactory('outbox'),
    auditId: input.idFactory('audit'),
    requestId: input.requestId,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    ...(input.requirementId ? { requirementId: input.requirementId } : {}),
    occurredAt: input.occurredAt,
  };
}

export function createMutationEvidence(input: {
  actorId: string;
  route: string;
  idempotencyKey: string;
  request: unknown;
  requestId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  requirementId?: string;
  occurredAt: string;
  idFactory: (prefix: string) => string;
}): MutationEvidence {
  return {
    ...createOperationEvidence(input),
    route: input.route,
    idempotencyKey: input.idempotencyKey,
    requestHash: hashMutationRequest(input.request),
    idempotencyId: input.idFactory('idempotency'),
  };
}
