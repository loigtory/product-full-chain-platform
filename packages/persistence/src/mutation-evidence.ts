import type { MutationEvidence, OperationEvidence } from '@pfc/contracts';
import type { Transaction } from 'kysely';

import type { LifecycleDatabase } from './database.ts';

type ScopedTransaction = Transaction<LifecycleDatabase>;

export async function claimMutation(
  transaction: ScopedTransaction,
  evidence: MutationEvidence,
): Promise<{
  status: 'NEW' | 'REPLAYED' | 'CONFLICT';
  resultReference: string | null;
}> {
  const inserted = await transaction
    .insertInto('idempotency_records')
    .values({
      id: evidence.idempotencyId,
      actor_id: evidence.actorId,
      route: evidence.route,
      idempotency_key: evidence.idempotencyKey,
      request_hash: evidence.requestHash,
      result_reference: evidence.aggregateId,
      response_summary: {
        status: 'CREATED',
        aggregateVersion: evidence.aggregateVersion,
      },
    })
    .onConflict((conflict) =>
      conflict.columns(['actor_id', 'route', 'idempotency_key']).doNothing(),
    )
    .returning('id')
    .executeTakeFirst();
  if (inserted) {
    return { status: 'NEW', resultReference: evidence.aggregateId };
  }

  const existing = await transaction
    .selectFrom('idempotency_records')
    .select(['request_hash', 'result_reference'])
    .where('actor_id', '=', evidence.actorId)
    .where('route', '=', evidence.route)
    .where('idempotency_key', '=', evidence.idempotencyKey)
    .executeTakeFirst();
  if (existing?.request_hash === evidence.requestHash) {
    return { status: 'REPLAYED', resultReference: existing.result_reference };
  }
  return {
    status: 'CONFLICT',
    resultReference: existing?.result_reference ?? null,
  };
}

export async function appendMutationEvidence(
  transaction: ScopedTransaction,
  evidence: OperationEvidence,
): Promise<void> {
  const summary = {
    aggregateId: evidence.aggregateId,
    aggregateVersion: evidence.aggregateVersion,
    ...(evidence.requirementId
      ? { requirementId: evidence.requirementId }
      : {}),
  };
  if (evidence.requirementId) {
    await transaction
      .insertInto('timeline_events')
      .values({
        id: evidence.eventId,
        requirement_id: evidence.requirementId,
        aggregate_type: evidence.aggregateType,
        aggregate_id: evidence.aggregateId,
        event_type: evidence.eventType,
        actor_id: evidence.actorId,
        before_summary: null,
        after_summary: summary,
        aggregate_version: evidence.aggregateVersion,
        occurred_at: evidence.occurredAt,
      })
      .execute();
  }
  await transaction
    .insertInto('outbox_events')
    .values({
      id: evidence.outboxId,
      event_type: evidence.eventType,
      aggregate_type: evidence.aggregateType,
      aggregate_id: evidence.aggregateId,
      aggregate_version: evidence.aggregateVersion,
      payload_summary: summary,
      status: 'PENDING',
      occurred_at: evidence.occurredAt,
      published_at: null,
    })
    .execute();
  await transaction
    .insertInto('audit_events')
    .values({
      id: evidence.auditId,
      actor_id: evidence.actorId,
      action: evidence.eventType,
      target_type: evidence.aggregateType,
      target_id: evidence.aggregateId,
      decision: 'ALLOW',
      reason: null,
      scope_summary: summary,
      request_id: evidence.requestId,
      occurred_at: evidence.occurredAt,
    })
    .execute();
}
