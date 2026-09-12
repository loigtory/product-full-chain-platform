import { createHash } from 'node:crypto';

import type {
  AgentControlAction,
  AgentRunDto,
  MutationEvidence,
  SensitivityLevel,
} from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';
import { PostgresAgentRunRepository } from './agent-run-repository.ts';
import { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';

type ScopedDatabase = ReturnType<LifecycleKysely['withSchema']>;

function scopeHash(scope: NonNullable<AgentRunDto['runScope']>): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify({
        allowedRelativePaths: [...scope.allowedRelativePaths].sort(),
        allowedActions: [...scope.allowedActions].sort(),
        networkAccess: scope.networkAccess,
        maxChangedFiles: scope.maxChangedFiles,
        maxChangedBytes: scope.maxChangedBytes,
        expiresAt: scope.expiresAt,
      }),
    )
    .digest('hex')}`;
}

export class PostgresAgentControlRepository {
  private readonly db: ScopedDatabase;
  private readonly runs: PostgresAgentRunRepository;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
    this.runs = new PostgresAgentRunRepository(database, schemaName);
  }

  findRun(runId: string): Promise<AgentRunDto | null> {
    return this.runs.findRun(runId);
  }

  findRunSensitivity(runId: string): Promise<SensitivityLevel | null> {
    return this.runs.findRunSensitivity(runId);
  }

  async controlRun(input: {
    action: AgentControlAction;
    runId: string;
    expectedRowVersion: number;
    reasonCode: string;
    actorId: string;
    occurredAt: string;
    commandId: string;
    eventIdPrefix: string;
    childRunId: string;
    childExecutionInstanceId: string;
    childScopeExpiresAt: string;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'APPLIED' | 'REPLAYED' | 'CONFLICT';
    run: AgentRunDto | null;
    childRun: AgentRunDto | null;
  }> {
    const persisted = await this.db
      .transaction()
      .execute(async (transaction) => {
        const mutation = await claimMutation(transaction, input.mutation);
        if (mutation.status !== 'NEW') {
          return {
            status: mutation.status,
            runId: mutation.resultReference,
            childRunId: null as string | null,
          };
        }
        const run = await transaction
          .selectFrom('agent_runs')
          .selectAll()
          .where('id', '=', input.runId)
          .forUpdate()
          .executeTakeFirst();
        if (!run || run.row_version !== input.expectedRowVersion) {
          return {
            status: 'CONFLICT' as const,
            runId: run?.id ?? null,
            childRunId: null,
          };
        }
        const sequenceRow = await transaction
          .selectFrom('agent_run_events')
          .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
          .where('run_id', '=', run.id)
          .executeTakeFirstOrThrow();
        let sequence = Number(sequenceRow.sequence ?? 0);
        const appendRunEvent = async (
          eventType:
            'CANCEL_REQUESTED' | 'RUN_CANCELLED' | 'VERIFICATION_STARTED',
          summary: Readonly<Record<string, string | number | boolean | null>>,
        ) => {
          sequence += 1;
          await transaction
            .insertInto('agent_run_events')
            .values({
              id: `${input.eventIdPrefix}-${sequence}`,
              run_id: run.id,
              sequence,
              event_type: eventType,
              summary,
              source_bridge_id: null,
              source_event_id: null,
              occurred_at: input.occurredAt,
              received_at: input.occurredAt,
            })
            .execute();
        };

        if (input.action === 'CANCEL') {
          if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status)) {
            await appendMutationEvidence(transaction, input.mutation);
            return {
              status: 'APPLIED' as const,
              runId: run.id,
              childRunId: null,
            };
          }
          if (run.status === 'CANCELLING') {
            await appendMutationEvidence(transaction, input.mutation);
            return {
              status: 'APPLIED' as const,
              runId: run.id,
              childRunId: null,
            };
          }
          await appendRunEvent('CANCEL_REQUESTED', {
            reasonCode: input.reasonCode,
          });
          if (
            ['QUEUED', 'RETRY_QUEUED', 'WAITING_APPROVAL'].includes(
              run.status,
            ) &&
            !run.execution_started_at
          ) {
            await transaction
              .updateTable('agent_run_commands')
              .set({ status: 'CANCELLED', updated_at: input.occurredAt })
              .where('run_id', '=', run.id)
              .where('status', '=', 'PENDING')
              .execute();
            await transaction
              .updateTable('approval_requests')
              .set((expression) => ({
                decision: 'CANCELLED',
                decided_by: input.actorId,
                decided_at: input.occurredAt,
                reason_code: input.reasonCode,
                row_version: expression('row_version', '+', 1),
              }))
              .where('run_id', '=', run.id)
              .where('kind', '=', 'RUN_START')
              .where('decision', '=', 'PENDING')
              .execute();
            await transaction
              .updateTable('agent_runs')
              .set({
                status: 'CANCELLED',
                cancel_requested_at: input.occurredAt,
                terminal_at: input.occurredAt,
                failure_reason: null,
                row_version: run.row_version + 1,
                updated_at: input.occurredAt,
              })
              .where('id', '=', run.id)
              .executeTakeFirstOrThrow();
            await appendRunEvent('RUN_CANCELLED', {
              reasonCode: input.reasonCode,
              executionStarted: false,
            });
          } else if (
            ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'VERIFYING'].includes(
              run.status,
            ) &&
            run.bridge_id &&
            run.execution_instance_id
          ) {
            await transaction
              .updateTable('approval_requests')
              .set((expression) => ({
                decision: 'CANCELLED',
                decided_by: input.actorId,
                decided_at: input.occurredAt,
                reason_code: input.reasonCode,
                row_version: expression('row_version', '+', 1),
              }))
              .where('run_id', '=', run.id)
              .where('decision', '=', 'PENDING')
              .execute();
            await transaction
              .insertInto('agent_run_commands')
              .values({
                id: input.commandId,
                run_id: run.id,
                command_type: 'INTERRUPT_RUN',
                payload: {
                  executionInstanceId: run.execution_instance_id,
                  threadId: run.codex_thread_id,
                  turnId: run.codex_turn_id,
                },
                status: 'PENDING',
                priority: 0,
                execution_instance_id: run.execution_instance_id,
                lease_owner: null,
                lease_until: null,
                attempt: 0,
                idempotency_key: `${run.id}:cancel:${run.row_version}`,
                result_summary: null,
                created_at: input.occurredAt,
                updated_at: input.occurredAt,
              })
              .execute();
            await transaction
              .updateTable('agent_runs')
              .set({
                status: 'CANCELLING',
                cancel_requested_at: input.occurredAt,
                row_version: run.row_version + 1,
                updated_at: input.occurredAt,
              })
              .where('id', '=', run.id)
              .executeTakeFirstOrThrow();
          } else {
            return {
              status: 'CONFLICT' as const,
              runId: run.id,
              childRunId: null,
            };
          }
          await appendMutationEvidence(transaction, input.mutation);
          return {
            status: 'APPLIED' as const,
            runId: run.id,
            childRunId: null,
          };
        }

        if (input.action === 'VERIFY_UNKNOWN') {
          if (
            run.status !== 'UNKNOWN' ||
            !run.bridge_id ||
            !run.execution_instance_id
          ) {
            return {
              status: 'CONFLICT' as const,
              runId: run.id,
              childRunId: null,
            };
          }
          await transaction
            .insertInto('agent_run_commands')
            .values({
              id: input.commandId,
              run_id: run.id,
              command_type: 'VERIFY_RUN_STATE',
              payload: { executionInstanceId: run.execution_instance_id },
              status: 'PENDING',
              priority: 10,
              execution_instance_id: run.execution_instance_id,
              lease_owner: null,
              lease_until: null,
              attempt: 0,
              idempotency_key: `${run.id}:verify:${run.row_version}`,
              result_summary: null,
              created_at: input.occurredAt,
              updated_at: input.occurredAt,
            })
            .execute();
          await transaction
            .updateTable('agent_runs')
            .set({
              status: 'VERIFYING',
              row_version: run.row_version + 1,
              updated_at: input.occurredAt,
            })
            .where('id', '=', run.id)
            .executeTakeFirstOrThrow();
          await appendRunEvent('VERIFICATION_STARTED', {
            reasonCode: input.reasonCode,
          });
          await appendMutationEvidence(transaction, input.mutation);
          return {
            status: 'APPLIED' as const,
            runId: run.id,
            childRunId: null,
          };
        }

        if (
          !['FAILED', 'CANCELLED'].includes(run.status) ||
          run.access_mode !== 'WORKSPACE_WRITE' ||
          !run.run_scope ||
          !run.execution_instance_id
        ) {
          return {
            status: 'CONFLICT' as const,
            runId: run.id,
            childRunId: null,
          };
        }
        const capsule = await transaction
          .selectFrom('agent_run_capsules')
          .select('id')
          .where('run_id', '=', run.id)
          .where('execution_instance_id', '=', run.execution_instance_id)
          .where('lifecycle', '=', 'VERIFIED')
          .executeTakeFirst();
        const binding = await transaction
          .selectFrom('bridge_workspace_bindings')
          .innerJoin(
            'bridge_registrations',
            'bridge_registrations.id',
            'bridge_workspace_bindings.bridge_id',
          )
          .select('bridge_workspace_bindings.bridge_id')
          .where(
            'bridge_workspace_bindings.workspace_id',
            '=',
            run.workspace_id,
          )
          .where(
            'bridge_workspace_bindings.verification_status',
            '=',
            'VERIFIED',
          )
          .where(
            'bridge_workspace_bindings.current_git_baseline',
            '=',
            run.git_baseline,
          )
          .where('bridge_registrations.status', '=', 'ONLINE')
          .where('bridge_registrations.revoked_at', 'is', null)
          .executeTakeFirst();
        const originalCommand = await transaction
          .selectFrom('agent_run_commands')
          .select('payload')
          .where('run_id', '=', run.id)
          .where('command_type', '=', 'START_WORKSPACE_WRITE_RUN')
          .orderBy('created_at')
          .executeTakeFirst();
        if (!capsule || !binding || !originalCommand) {
          return {
            status: 'CONFLICT' as const,
            runId: run.id,
            childRunId: null,
          };
        }
        const originalScope = run.run_scope as NonNullable<
          AgentRunDto['runScope']
        >;
        const childScope = {
          ...originalScope,
          expiresAt: input.childScopeExpiresAt,
        };
        const childScopeHash = scopeHash(childScope);
        const childApprovalId = `${input.childRunId}_START_APPROVAL`;
        await transaction
          .insertInto('agent_runs')
          .values({
            id: input.childRunId,
            requirement_id: run.requirement_id,
            baseline_id: run.baseline_id,
            workspace_id: run.workspace_id,
            git_baseline: run.git_baseline,
            skill_release_id: run.skill_release_id,
            operation: run.operation,
            access_mode: run.access_mode,
            status: 'WAITING_APPROVAL',
            parent_run_id: run.id,
            bridge_id: null,
            execution_instance_id: input.childExecutionInstanceId,
            codex_thread_id: null,
            codex_turn_id: null,
            result_outcome: null,
            run_scope: childScope,
            run_scope_hash: childScopeHash,
            execution_started_at: null,
            cancel_requested_at: null,
            terminal_at: null,
            result_summary: null,
            failure_reason: null,
            row_version: 0,
            created_by: input.actorId,
            created_at: input.occurredAt,
            updated_at: input.occurredAt,
          })
          .execute();
        await transaction
          .insertInto('agent_run_events')
          .values({
            id: `${input.eventIdPrefix}-retry`,
            run_id: input.childRunId,
            sequence: 1,
            event_type: 'APPROVAL_REQUESTED',
            summary: {
              parentRunId: run.id,
              reasonCode: input.reasonCode,
              approvalId: childApprovalId,
              approvalKind: 'RUN_START',
              scopeHash: childScopeHash,
            },
            source_bridge_id: null,
            source_event_id: null,
            occurred_at: input.occurredAt,
            received_at: input.occurredAt,
          })
          .execute();
        await transaction
          .insertInto('approval_requests')
          .values({
            id: childApprovalId,
            run_id: input.childRunId,
            execution_instance_id: input.childExecutionInstanceId,
            app_server_request_id: null,
            thread_id: null,
            turn_id: null,
            item_id: null,
            callback_id: null,
            kind: 'RUN_START',
            requested_scope: {
              allowedRelativePaths: childScope.allowedRelativePaths,
              allowedActions: childScope.allowedActions,
              networkAccess: false,
              maxChangedFiles: childScope.maxChangedFiles,
              maxChangedBytes: childScope.maxChangedBytes,
            },
            approved_scope: null,
            scope_hash: childScopeHash,
            outside_capsule: false,
            decision: 'PENDING',
            requested_by: input.actorId,
            requested_at: input.occurredAt,
            expires_at: childScope.expiresAt,
            decided_by: null,
            decided_at: null,
            reason_code: null,
            row_version: 0,
          })
          .execute();
        await appendMutationEvidence(transaction, input.mutation);
        await appendMutationEvidence(transaction, {
          actorId: input.actorId,
          eventId: `${input.eventIdPrefix}-approval-timeline`,
          outboxId: `${input.eventIdPrefix}-approval-outbox`,
          auditId: `${input.eventIdPrefix}-approval-audit`,
          requestId: input.mutation.requestId,
          eventType: 'agent-approval.requested',
          aggregateType: 'agent-approval',
          aggregateId: childApprovalId,
          aggregateVersion: 0,
          requirementId: run.requirement_id,
          occurredAt: input.occurredAt,
        });
        return {
          status: 'APPLIED' as const,
          runId: run.id,
          childRunId: input.childRunId,
        };
      });
    const run = persisted.runId
      ? await this.runs.findRun(persisted.runId)
      : null;
    const childRun = persisted.childRunId
      ? await this.runs.findRun(persisted.childRunId)
      : null;
    return { status: persisted.status, run, childRun };
  }

  async findBridge(bridgeId: string) {
    const bridge = await this.db
      .selectFrom('bridge_registrations')
      .select(['id', 'team_id', 'status'])
      .where('id', '=', bridgeId)
      .executeTakeFirst();
    if (!bridge) return null;
    const active = await this.db
      .selectFrom('agent_runs')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('bridge_id', '=', bridgeId)
      .where('status', 'in', [
        'STARTING',
        'RUNNING',
        'WAITING_APPROVAL',
        'CANCELLING',
        'VERIFYING',
        'UNKNOWN',
      ])
      .executeTakeFirstOrThrow();
    return {
      id: bridge.id,
      teamId: bridge.team_id,
      status: bridge.status,
      activeRunCount: Number(active.count),
    };
  }

  async revokeBridge(input: {
    bridgeId: string;
    actorId: string;
    reasonCode: string;
    expectedActiveRunCount: number;
    occurredAt: string;
    commandIdPrefix: string;
    eventIdPrefix: string;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'REVOKED' | 'REPLAYED' | 'CONFLICT';
    affectedRunCount: number;
  }> {
    return this.db.transaction().execute(async (transaction) => {
      const mutation = await claimMutation(transaction, input.mutation);
      if (mutation.status !== 'NEW') {
        return {
          status: mutation.status === 'REPLAYED' ? 'REPLAYED' : 'CONFLICT',
          affectedRunCount: input.expectedActiveRunCount,
        };
      }
      const bridge = await transaction
        .selectFrom('bridge_registrations')
        .select(['id', 'status'])
        .where('id', '=', input.bridgeId)
        .forUpdate()
        .executeTakeFirst();
      if (!bridge || bridge.status === 'REVOKED') {
        return { status: 'CONFLICT', affectedRunCount: 0 };
      }
      const activeRuns = await transaction
        .selectFrom('agent_runs')
        .select([
          'id',
          'status',
          'execution_instance_id',
          'codex_thread_id',
          'codex_turn_id',
          'row_version',
        ])
        .where('bridge_id', '=', input.bridgeId)
        .where('status', 'in', [
          'STARTING',
          'RUNNING',
          'WAITING_APPROVAL',
          'CANCELLING',
          'VERIFYING',
          'UNKNOWN',
        ])
        .forUpdate()
        .execute();
      if (activeRuns.length !== input.expectedActiveRunCount) {
        return { status: 'CONFLICT', affectedRunCount: activeRuns.length };
      }
      await transaction
        .updateTable('bridge_registrations')
        .set({
          status: 'REVOKED',
          revoked_at: input.occurredAt,
          updated_at: input.occurredAt,
        })
        .where('id', '=', input.bridgeId)
        .executeTakeFirstOrThrow();
      for (const [index, run] of activeRuns.entries()) {
        const canInterrupt = Boolean(run.execution_instance_id);
        if (canInterrupt) {
          await transaction
            .insertInto('agent_run_commands')
            .values({
              id: `${input.commandIdPrefix}-${index}`,
              run_id: run.id,
              command_type: 'INTERRUPT_RUN',
              payload: {
                executionInstanceId: run.execution_instance_id!,
                threadId: run.codex_thread_id,
                turnId: run.codex_turn_id,
              },
              status: 'PENDING',
              priority: 0,
              execution_instance_id: run.execution_instance_id,
              lease_owner: null,
              lease_until: null,
              attempt: 0,
              idempotency_key: `${run.id}:bridge-revoked`,
              result_summary: null,
              created_at: input.occurredAt,
              updated_at: input.occurredAt,
            })
            .execute();
        }
        const sequenceRow = await transaction
          .selectFrom('agent_run_events')
          .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
          .where('run_id', '=', run.id)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('agent_run_events')
          .values({
            id: `${input.eventIdPrefix}-${index}`,
            run_id: run.id,
            sequence: Number(sequenceRow.sequence ?? 0) + 1,
            event_type: 'BRIDGE_REVOKED',
            summary: { reasonCode: input.reasonCode },
            source_bridge_id: null,
            source_event_id: null,
            occurred_at: input.occurredAt,
            received_at: input.occurredAt,
          })
          .execute();
        await transaction
          .updateTable('agent_runs')
          .set({
            status: canInterrupt ? 'CANCELLING' : 'UNKNOWN',
            cancel_requested_at: input.occurredAt,
            failure_reason: canInterrupt
              ? null
              : 'BRIDGE_REVOKED_STATE_UNKNOWN',
            result_outcome: canInterrupt ? null : 'UNKNOWN',
            row_version: run.row_version + 1,
            updated_at: input.occurredAt,
          })
          .where('id', '=', run.id)
          .executeTakeFirstOrThrow();
      }
      await appendMutationEvidence(transaction, input.mutation);
      return { status: 'REVOKED', affectedRunCount: activeRuns.length };
    });
  }
}
