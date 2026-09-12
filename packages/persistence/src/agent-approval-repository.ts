import type {
  AgentApprovalDto,
  AgentApprovalScopeDto,
  MutationEvidence,
} from '@pfc/contracts';
import { decideAgentApproval, expireAgentApproval } from '@pfc/domain';

import type { LifecycleKysely } from './database.ts';
import { buildApprovedRunStartPayload } from './agent-run-start-approval.ts';
import { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';

type ScopedDatabase = ReturnType<LifecycleKysely['withSchema']>;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapScope(value: unknown): AgentApprovalScopeDto {
  return value as AgentApprovalScopeDto;
}

function mapApproval(row: {
  id: string;
  run_id: string;
  execution_instance_id: string;
  app_server_request_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  item_id: string | null;
  callback_id: string | null;
  kind: AgentApprovalDto['kind'];
  requested_scope: unknown;
  approved_scope: unknown | null;
  scope_hash: string;
  outside_capsule: boolean;
  decision: AgentApprovalDto['decision'];
  requested_by: string;
  requested_at: Date | string;
  expires_at: Date | string;
  decided_by: string | null;
  decided_at: Date | string | null;
  reason_code: string | null;
  row_version: number;
}): AgentApprovalDto {
  return {
    id: row.id,
    runId: row.run_id,
    executionInstanceId: row.execution_instance_id,
    appServerRequestId: row.app_server_request_id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    callbackId: row.callback_id,
    kind: row.kind,
    requestedScope: mapScope(row.requested_scope),
    scopeHash: row.scope_hash,
    outsideCapsule: row.outside_capsule,
    approvedScope: row.approved_scope ? mapScope(row.approved_scope) : null,
    decision: row.decision,
    requestedBy: row.requested_by,
    requestedAt: timestamp(row.requested_at),
    expiresAt: timestamp(row.expires_at),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? timestamp(row.decided_at) : null,
    reasonCode: row.reason_code,
    rowVersion: row.row_version,
  };
}

function scopeIsWithinRun(
  approved: AgentApprovalScopeDto,
  runScope: unknown,
): boolean {
  if (!runScope || typeof runScope !== 'object' || Array.isArray(runScope)) {
    return false;
  }
  const scope = runScope as {
    allowedRelativePaths?: unknown;
    allowedActions?: unknown;
    networkAccess?: unknown;
    maxChangedFiles?: unknown;
    maxChangedBytes?: unknown;
  };
  if (
    !Array.isArray(scope.allowedRelativePaths) ||
    !Array.isArray(scope.allowedActions) ||
    scope.networkAccess !== false ||
    typeof scope.maxChangedFiles !== 'number' ||
    typeof scope.maxChangedBytes !== 'number'
  ) {
    return false;
  }
  const allowedRelativePaths = scope.allowedRelativePaths as unknown[];
  const allowedActions = scope.allowedActions as unknown[];
  return (
    !approved.networkAccess &&
    approved.allowedRelativePaths.every((path) =>
      allowedRelativePaths.includes(path),
    ) &&
    approved.allowedActions.every((action) =>
      allowedActions.includes(action),
    ) &&
    approved.maxChangedFiles <= scope.maxChangedFiles &&
    approved.maxChangedBytes <= scope.maxChangedBytes
  );
}

export class PostgresAgentApprovalRepository {
  private readonly db: ScopedDatabase;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async findApproval(approvalId: string): Promise<AgentApprovalDto | null> {
    const row = await this.db
      .selectFrom('approval_requests')
      .selectAll()
      .where('id', '=', approvalId)
      .executeTakeFirst();
    return row ? mapApproval(row) : null;
  }

  async listPendingForActor(input: {
    actorId: string;
    limit: number;
  }): Promise<readonly AgentApprovalDto[]> {
    const rows = await this.db
      .selectFrom('approval_requests')
      .innerJoin('agent_runs', 'agent_runs.id', 'approval_requests.run_id')
      .innerJoin(
        'requirement_assignments',
        'requirement_assignments.requirement_id',
        'agent_runs.requirement_id',
      )
      .innerJoin('team_memberships', (join) =>
        join
          .onRef(
            'team_memberships.team_id',
            '=',
            'requirement_assignments.team_id',
          )
          .on('team_memberships.account_id', '=', input.actorId),
      )
      .selectAll('approval_requests')
      .distinct()
      .where('approval_requests.decision', '=', 'PENDING')
      .where('approval_requests.requested_by', '!=', input.actorId)
      .where('requirement_assignments.status', '=', 'ACTIVE')
      .where('team_memberships.status', '=', 'ACTIVE')
      .orderBy('approval_requests.requested_at')
      .limit(Math.min(Math.max(input.limit, 1), 100))
      .execute();
    return rows.map(mapApproval);
  }

  async createApproval(input: {
    approval: AgentApprovalDto;
    eventId: string;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'CREATED' | 'REPLAYED' | 'CONFLICT';
    approval: AgentApprovalDto | null;
    afterSequence: number | null;
  }> {
    if (input.approval.kind === 'RUN_START') {
      throw new Error('RUN_START_APPROVAL_MUST_BE_CREATED_WITH_RUN');
    }
    return this.db.transaction().execute(async (transaction) => {
      const mutation = await claimMutation(transaction, input.mutation);
      if (mutation.status !== 'NEW') {
        const replayed =
          mutation.status === 'REPLAYED' && mutation.resultReference
            ? await transaction
                .selectFrom('approval_requests')
                .selectAll()
                .where('id', '=', mutation.resultReference)
                .executeTakeFirst()
            : null;
        const sequenceRow = replayed
          ? await transaction
              .selectFrom('agent_run_events')
              .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
              .where('run_id', '=', replayed.run_id)
              .executeTakeFirst()
          : null;
        return {
          status: mutation.status,
          approval: replayed ? mapApproval(replayed) : null,
          afterSequence: sequenceRow ? Number(sequenceRow.sequence ?? 0) : null,
        };
      }
      const run = await transaction
        .selectFrom('agent_runs')
        .select([
          'status',
          'execution_instance_id',
          'created_by',
          'row_version',
        ])
        .where('id', '=', input.approval.runId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !run ||
        run.status !== 'RUNNING' ||
        run.execution_instance_id !== input.approval.executionInstanceId ||
        run.created_by !== input.approval.requestedBy
      ) {
        return { status: 'CONFLICT', approval: null, afterSequence: null };
      }
      const inserted = await transaction
        .insertInto('approval_requests')
        .values({
          id: input.approval.id,
          run_id: input.approval.runId,
          execution_instance_id: input.approval.executionInstanceId,
          app_server_request_id: input.approval.appServerRequestId,
          thread_id: input.approval.threadId,
          turn_id: input.approval.turnId,
          item_id: input.approval.itemId,
          callback_id: input.approval.callbackId,
          kind: input.approval.kind,
          requested_scope: input.approval.requestedScope,
          approved_scope: null,
          scope_hash: input.approval.scopeHash,
          outside_capsule: input.approval.outsideCapsule,
          decision: 'PENDING',
          requested_by: input.approval.requestedBy,
          requested_at: input.approval.requestedAt,
          expires_at: input.approval.expiresAt,
          decided_by: null,
          decided_at: null,
          reason_code: null,
          row_version: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const sequenceRow = await transaction
        .selectFrom('agent_run_events')
        .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
        .where('run_id', '=', input.approval.runId)
        .executeTakeFirstOrThrow();
      const sequence = Number(sequenceRow.sequence ?? 0) + 1;
      await transaction
        .insertInto('agent_run_events')
        .values({
          id: input.eventId,
          run_id: input.approval.runId,
          sequence,
          event_type: 'APPROVAL_REQUESTED',
          summary: {
            approvalId: input.approval.id,
            approvalKind: input.approval.kind,
            scopeHash: input.approval.scopeHash,
          },
          source_bridge_id: null,
          source_event_id: input.approval.appServerRequestId,
          occurred_at: input.approval.requestedAt,
          received_at: input.approval.requestedAt,
        })
        .execute();
      await transaction
        .updateTable('agent_runs')
        .set({
          status: 'WAITING_APPROVAL',
          row_version: run.row_version + 1,
          updated_at: input.approval.requestedAt,
        })
        .where('id', '=', input.approval.runId)
        .where('row_version', '=', run.row_version)
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.mutation);
      return {
        status: 'CREATED',
        approval: mapApproval(inserted),
        afterSequence: sequence,
      };
    });
  }

  async expireDue(input: {
    expiredAt: string;
    limit: number;
    idPrefix: string;
  }): Promise<number> {
    return this.db.transaction().execute(async (transaction) => {
      const rows = await transaction
        .selectFrom('approval_requests')
        .selectAll()
        .where('decision', '=', 'PENDING')
        .where('expires_at', '<=', new Date(input.expiredAt))
        .orderBy('expires_at')
        .limit(Math.min(Math.max(input.limit, 1), 100))
        .forUpdate()
        .skipLocked()
        .execute();
      for (const [index, row] of rows.entries()) {
        const expired = expireAgentApproval(mapApproval(row), input.expiredAt);
        await transaction
          .updateTable('approval_requests')
          .set({
            decision: expired.decision,
            decided_at: expired.decidedAt,
            reason_code: expired.reasonCode,
            row_version: expired.rowVersion,
          })
          .where('id', '=', row.id)
          .where('decision', '=', 'PENDING')
          .executeTakeFirstOrThrow();
        const sequenceRow = await transaction
          .selectFrom('agent_run_events')
          .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
          .where('run_id', '=', row.run_id)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('agent_run_events')
          .values({
            id: `${input.idPrefix}-event-${index}`,
            run_id: row.run_id,
            sequence: Number(sequenceRow.sequence ?? 0) + 1,
            event_type: 'APPROVAL_RESOLVED',
            summary: {
              approvalId: row.id,
              decision: 'EXPIRED',
              reasonCode: 'APPROVAL_EXPIRED',
            },
            source_bridge_id: null,
            source_event_id: null,
            occurred_at: input.expiredAt,
            received_at: input.expiredAt,
          })
          .execute();
        if (row.kind === 'RUN_START') {
          await transaction
            .updateTable('agent_runs')
            .set((expression) => ({
              status: 'FAILED',
              result_outcome: 'BLOCKED',
              failure_reason: 'RUN_START_APPROVAL_EXPIRED',
              terminal_at: input.expiredAt,
              row_version: expression('row_version', '+', 1),
              updated_at: input.expiredAt,
            }))
            .where('id', '=', row.run_id)
            .where('status', '=', 'WAITING_APPROVAL')
            .executeTakeFirstOrThrow();
        } else {
          await transaction
            .insertInto('agent_run_commands')
            .values({
              id: `${input.idPrefix}-command-${index}`,
              run_id: row.run_id,
              command_type: 'RESOLVE_APPROVAL',
              payload: {
                approvalId: row.id,
                executionInstanceId: row.execution_instance_id,
                appServerRequestId: row.app_server_request_id,
                approvalKind: row.kind,
                decision: 'decline',
              },
              status: 'PENDING',
              priority: 0,
              execution_instance_id: row.execution_instance_id,
              lease_owner: null,
              lease_until: null,
              attempt: 0,
              idempotency_key: `${row.id}:expired`,
              result_summary: null,
              created_at: input.expiredAt,
              updated_at: input.expiredAt,
            })
            .execute();
        }
        await appendMutationEvidence(transaction, {
          actorId: row.requested_by,
          eventId: `${input.idPrefix}-timeline-${index}`,
          outboxId: `${input.idPrefix}-outbox-${index}`,
          auditId: `${input.idPrefix}-audit-${index}`,
          requestId: `${input.idPrefix}-expiry-${index}`,
          eventType: 'agent-approval.expired',
          aggregateType: 'agent-approval',
          aggregateId: row.id,
          aggregateVersion: expired.rowVersion,
          requirementId: (
            await transaction
              .selectFrom('agent_runs')
              .select('requirement_id')
              .where('id', '=', row.run_id)
              .executeTakeFirstOrThrow()
          ).requirement_id,
          occurredAt: input.expiredAt,
        });
      }
      return rows.length;
    });
  }

  async decideApproval(input: {
    approvalId: string;
    expectedRowVersion: number;
    decision: Parameters<typeof decideAgentApproval>[1];
    eventId: string;
    command: Readonly<{
      id: string;
      idempotencyKey: string;
      payload: Readonly<Record<string, unknown>>;
      runQueuedEventId?: string;
    }>;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'DECIDED' | 'REPLAYED' | 'CONFLICT';
    approval: AgentApprovalDto | null;
  }> {
    return this.db.transaction().execute(async (transaction) => {
      const mutation = await claimMutation(transaction, input.mutation);
      if (mutation.status !== 'NEW') {
        const replayed =
          mutation.status === 'REPLAYED' && mutation.resultReference
            ? await transaction
                .selectFrom('approval_requests')
                .selectAll()
                .where('id', '=', mutation.resultReference)
                .executeTakeFirst()
            : null;
        return {
          status: mutation.status,
          approval: replayed ? mapApproval(replayed) : null,
        };
      }
      const row = await transaction
        .selectFrom('approval_requests')
        .selectAll()
        .where('id', '=', input.approvalId)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.row_version !== input.expectedRowVersion) {
        return { status: 'CONFLICT', approval: row ? mapApproval(row) : null };
      }
      const current = mapApproval(row);
      let decided: AgentApprovalDto;
      try {
        decided = decideAgentApproval(current, input.decision);
      } catch (error) {
        if (
          error instanceof Error &&
          ['AGENT_APPROVAL_TERMINAL', 'AGENT_APPROVAL_EXPIRED'].includes(
            error.message,
          )
        ) {
          return { status: 'CONFLICT', approval: current };
        }
        throw error;
      }
      const run = await transaction
        .selectFrom('agent_runs')
        .selectAll()
        .where('id', '=', decided.runId)
        .where('execution_instance_id', '=', decided.executionInstanceId)
        .executeTakeFirst();
      if (
        !run ||
        run.status !== 'WAITING_APPROVAL' ||
        (decided.approvedScope &&
          !scopeIsWithinRun(decided.approvedScope, run.run_scope))
      ) {
        return { status: 'CONFLICT', approval: current };
      }
      const updated = await transaction
        .updateTable('approval_requests')
        .set({
          decision: decided.decision,
          approved_scope: decided.approvedScope,
          decided_by: decided.decidedBy,
          decided_at: decided.decidedAt,
          reason_code: decided.reasonCode,
          row_version: decided.rowVersion,
        })
        .where('id', '=', decided.id)
        .where('row_version', '=', input.expectedRowVersion)
        .where('decision', '=', 'PENDING')
        .returningAll()
        .executeTakeFirst();
      if (!updated) return { status: 'CONFLICT', approval: current };
      const sequenceRow = await transaction
        .selectFrom('agent_run_events')
        .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
        .where('run_id', '=', decided.runId)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('agent_run_events')
        .values({
          id: input.eventId,
          run_id: decided.runId,
          sequence: Number(sequenceRow.sequence ?? 0) + 1,
          event_type: 'APPROVAL_RESOLVED',
          summary: {
            approvalId: decided.id,
            decision: decided.decision,
            reasonCode: decided.reasonCode,
          },
          source_bridge_id: null,
          source_event_id: null,
          occurred_at: decided.decidedAt ?? input.mutation.occurredAt,
          received_at: decided.decidedAt ?? input.mutation.occurredAt,
        })
        .execute();
      if (decided.kind === 'RUN_START') {
        let startPayload: Readonly<Record<string, unknown>> | null = null;
        if (decided.decision === 'APPROVED') {
          if (!input.command.runQueuedEventId) {
            throw new Error('AGENT_RUN_QUEUED_EVENT_ID_REQUIRED');
          }
          startPayload = await buildApprovedRunStartPayload({
            transaction,
            run,
            approval: decided,
            decidedAt: decided.decidedAt ?? input.mutation.occurredAt,
          });
        }
        await transaction
          .updateTable('agent_runs')
          .set((expression) => ({
            status: decided.decision === 'APPROVED' ? 'QUEUED' : 'CANCELLED',
            result_outcome: decided.decision === 'APPROVED' ? null : 'BLOCKED',
            failure_reason:
              decided.decision === 'APPROVED'
                ? null
                : `RUN_START_${decided.decision}`,
            terminal_at:
              decided.decision === 'APPROVED'
                ? null
                : (decided.decidedAt ?? input.mutation.occurredAt),
            row_version: expression('row_version', '+', 1),
            updated_at: decided.decidedAt ?? input.mutation.occurredAt,
          }))
          .where('id', '=', decided.runId)
          .where('status', '=', 'WAITING_APPROVAL')
          .executeTakeFirstOrThrow();
        if (startPayload) {
          await transaction
            .insertInto('agent_run_commands')
            .values({
              id: input.command.id,
              run_id: decided.runId,
              command_type: 'START_WORKSPACE_WRITE_RUN',
              payload: startPayload,
              status: 'PENDING',
              priority: 50,
              execution_instance_id: decided.executionInstanceId,
              lease_owner: null,
              lease_until: null,
              attempt: 0,
              idempotency_key: `${decided.runId}:start`,
              result_summary: null,
              created_at: decided.decidedAt ?? input.mutation.occurredAt,
              updated_at: decided.decidedAt ?? input.mutation.occurredAt,
            })
            .execute();
          await transaction
            .insertInto('agent_run_events')
            .values({
              id: input.command.runQueuedEventId!,
              run_id: decided.runId,
              sequence: Number(sequenceRow.sequence ?? 0) + 2,
              event_type: 'RUN_QUEUED',
              summary: {
                approvalId: decided.id,
                status: 'QUEUED',
                scopeHash: decided.scopeHash,
              },
              source_bridge_id: null,
              source_event_id: null,
              occurred_at: decided.decidedAt ?? input.mutation.occurredAt,
              received_at: decided.decidedAt ?? input.mutation.occurredAt,
            })
            .execute();
        }
      } else {
        await transaction
          .insertInto('agent_run_commands')
          .values({
            id: input.command.id,
            run_id: decided.runId,
            command_type: 'RESOLVE_APPROVAL',
            payload: {
              ...input.command.payload,
              approvalId: decided.id,
              executionInstanceId: decided.executionInstanceId,
              appServerRequestId: decided.appServerRequestId,
              approvalKind: decided.kind,
              decision:
                decided.decision === 'APPROVED'
                  ? 'accept'
                  : decided.decision === 'CANCELLED'
                    ? 'cancel'
                    : 'decline',
              ...(decided.approvedScope
                ? { grantedScope: decided.approvedScope }
                : {}),
            },
            status: 'PENDING',
            priority: 0,
            execution_instance_id: decided.executionInstanceId,
            lease_owner: null,
            lease_until: null,
            attempt: 0,
            idempotency_key: input.command.idempotencyKey,
            result_summary: null,
            created_at: decided.decidedAt ?? input.mutation.occurredAt,
            updated_at: decided.decidedAt ?? input.mutation.occurredAt,
          })
          .execute();
      }
      await appendMutationEvidence(transaction, input.mutation);
      return { status: 'DECIDED', approval: mapApproval(updated) };
    });
  }
}
