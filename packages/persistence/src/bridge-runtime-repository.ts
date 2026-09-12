import type { AgentRunEventType } from '@pfc/contracts';
import type { BridgeCapabilitySnapshot } from '../../../packages/protocol/src/index.ts';

import type { LifecycleKysely } from './database.ts';
import { PostgresAgentRunRepository } from './agent-run-repository.ts';
import { PostgresAgentApprovalRepository } from './agent-approval-repository.ts';
import {
  capabilityCoversBindings,
  parseStoredBridgeCapability,
} from './bridge-capability-evidence.ts';

export class PostgresBridgeRuntimeRepository {
  private readonly db;
  private readonly runs: PostgresAgentRunRepository;
  private readonly approvals: PostgresAgentApprovalRepository;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
    this.runs = new PostgresAgentRunRepository(database, schemaName);
    this.approvals = new PostgresAgentApprovalRepository(database, schemaName);
  }

  async authenticateMessage(input: {
    bridgeId: string;
    credentialDigest: string;
    messageId: string;
    nonce: string;
    sentAt: string;
    receivedAt: string;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (transaction) => {
      const bridge = await transaction
        .selectFrom('bridge_registrations')
        .select('id')
        .where('id', '=', input.bridgeId)
        .where('credential_digest', '=', input.credentialDigest)
        .where('status', 'in', ['ONLINE', 'DEGRADED'])
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (!bridge) return false;
      const receipt = await transaction
        .insertInto('bridge_message_receipts')
        .values({
          bridge_id: input.bridgeId,
          message_id: input.messageId,
          nonce: input.nonce,
          sent_at: input.sentAt,
          received_at: input.receivedAt,
        })
        .onConflict((conflict) => conflict.doNothing())
        .returning('message_id')
        .executeTakeFirst();
      return Boolean(receipt);
    });
  }

  async recordCapabilitySnapshot(input: {
    id: string;
    bridgeId: string;
    snapshot: BridgeCapabilitySnapshot;
    receivedAt: string;
    expiresAt: string;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (transaction) => {
      const bindings = await transaction
        .selectFrom('bridge_workspace_bindings')
        .select('workspace_id')
        .where('bridge_id', '=', input.bridgeId)
        .where('verification_status', '=', 'VERIFIED')
        .execute();
      if (
        !capabilityCoversBindings(
          parseStoredBridgeCapability(input.snapshot),
          bindings.map((binding) => binding.workspace_id),
        )
      ) {
        return false;
      }

      const skillIds = input.snapshot.skills.map((skill) => skill.releaseId);
      if (skillIds.length > 0) {
        const releases = await transaction
          .selectFrom('skill_releases')
          .select(['id', 'content_hash'])
          .where('id', 'in', skillIds)
          .where('status', '=', 'ACTIVE')
          .execute();
        if (
          releases.length !== skillIds.length ||
          input.snapshot.skills.some(
            (skill) =>
              releases
                .find((release) => release.id === skill.releaseId)
                ?.content_hash.toLowerCase() !==
              skill.contentHash.toLowerCase(),
          )
        ) {
          return false;
        }
      }

      for (const workspace of input.snapshot.workspaces) {
        await transaction
          .updateTable('bridge_workspace_bindings')
          .set({
            current_git_baseline: workspace.gitBaseline.toLowerCase(),
            verified_at: input.receivedAt,
          })
          .where('bridge_id', '=', input.bridgeId)
          .where('workspace_id', '=', workspace.workspaceId)
          .executeTakeFirstOrThrow();
      }
      await transaction
        .insertInto('bridge_capability_snapshots')
        .values({
          id: input.id,
          bridge_id: input.bridgeId,
          capabilities: input.snapshot,
          captured_at: input.receivedAt,
          expires_at: input.expiresAt,
        })
        .execute();
      await transaction
        .updateTable('bridge_registrations')
        .set({
          status:
            input.snapshot.runtime.codexAppServer === 'AVAILABLE'
              ? 'ONLINE'
              : 'DEGRADED',
          last_heartbeat_at: input.receivedAt,
          updated_at: input.receivedAt,
        })
        .where('id', '=', input.bridgeId)
        .where('revoked_at', 'is', null)
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async leaseNextCommand(input: {
    bridgeId: string;
    leasedAt: string;
    leaseUntil: string;
    eventId: string;
  }) {
    return this.runs.leaseNextCommand(input);
  }

  expireDueApprovals(input: {
    expiredAt: string;
    limit: number;
    idPrefix: string;
  }): Promise<number> {
    return this.approvals.expireDue(input);
  }

  async appendEvent(input: {
    id: string;
    commandId: string;
    runId: string;
    expectedSequence: number;
    bridgeId: string;
    sourceEventId: string;
    eventType: AgentRunEventType;
    summary: Readonly<Record<string, string | number | boolean | null>>;
    occurredAt: string;
    receivedAt: string;
  }) {
    return this.runs.appendEvent(input);
  }

  async acknowledgeCommand(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
    reasonCode?: string;
    threadId?: string;
    turnId?: string;
    acknowledgedAt: string;
  }) {
    return this.runs.acknowledgeCommand(input);
  }

  async findRun(runId: string) {
    return this.runs.findRun(runId);
  }

  async commandOwnsRun(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    executionInstanceId: string;
  }): Promise<boolean> {
    const command = await this.db
      .selectFrom('agent_run_commands')
      .select('id')
      .where('id', '=', input.commandId)
      .where('run_id', '=', input.runId)
      .where('execution_instance_id', '=', input.executionInstanceId)
      .where('command_type', '=', 'START_WORKSPACE_WRITE_RUN')
      .where('lease_owner', '=', input.bridgeId)
      .where('status', '=', 'LEASED')
      .executeTakeFirst();
    return Boolean(command);
  }

  async createApproval(
    input: Parameters<PostgresAgentApprovalRepository['createApproval']>[0],
  ) {
    return this.approvals.createApproval(input);
  }

  async recordCapsule(input: {
    id: string;
    eventId: string;
    bridgeId: string;
    runId: string;
    executionInstanceId: string;
    sourceGitBaseline: string;
    scopeHash: string;
    beforeManifestHash: string;
    afterManifestHash: string | null;
    lifecycle: 'MATERIALIZED' | 'VERIFIED' | 'UNKNOWN';
    diffSummary: Readonly<{
      changedFiles: number;
      changedBytes: number;
      changedPaths: readonly string[];
    }> | null;
    occurredAt: string;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (transaction) => {
      const run = await transaction
        .selectFrom('agent_runs')
        .select([
          'id',
          'bridge_id',
          'execution_instance_id',
          'git_baseline',
          'run_scope_hash',
          'run_scope',
        ])
        .where('id', '=', input.runId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !run ||
        run.bridge_id !== input.bridgeId ||
        run.execution_instance_id !== input.executionInstanceId ||
        run.git_baseline.toLowerCase() !==
          input.sourceGitBaseline.toLowerCase() ||
        run.run_scope_hash?.toLowerCase() !== input.scopeHash.toLowerCase()
      ) {
        return false;
      }
      const scope =
        run.run_scope &&
        typeof run.run_scope === 'object' &&
        !Array.isArray(run.run_scope)
          ? (run.run_scope as {
              allowedRelativePaths?: unknown;
              maxChangedFiles?: unknown;
              maxChangedBytes?: unknown;
            })
          : null;
      if (
        input.diffSummary &&
        (!scope ||
          !Array.isArray(scope.allowedRelativePaths) ||
          typeof scope.maxChangedFiles !== 'number' ||
          typeof scope.maxChangedBytes !== 'number' ||
          input.diffSummary.changedFiles > scope.maxChangedFiles ||
          input.diffSummary.changedBytes > scope.maxChangedBytes ||
          input.diffSummary.changedPaths.some(
            (path) =>
              !(scope.allowedRelativePaths as readonly unknown[]).includes(
                path,
              ),
          ))
      ) {
        return false;
      }
      const existing = await transaction
        .selectFrom('agent_run_capsules')
        .selectAll()
        .where('run_id', '=', input.runId)
        .where('execution_instance_id', '=', input.executionInstanceId)
        .executeTakeFirst();
      if (input.lifecycle === 'MATERIALIZED') {
        if (existing) {
          return (
            existing.source_git_baseline.toLowerCase() ===
              input.sourceGitBaseline.toLowerCase() &&
            existing.scope_hash.toLowerCase() ===
              input.scopeHash.toLowerCase() &&
            existing.before_manifest_hash.toLowerCase() ===
              input.beforeManifestHash.toLowerCase()
          );
        }
        await transaction
          .insertInto('agent_run_capsules')
          .values({
            id: input.id,
            run_id: input.runId,
            execution_instance_id: input.executionInstanceId,
            source_git_baseline: input.sourceGitBaseline,
            scope_hash: input.scopeHash,
            before_manifest_hash: input.beforeManifestHash,
            after_manifest_hash: null,
            diff_summary: null,
            lifecycle: 'MATERIALIZED',
            created_at: input.occurredAt,
            verified_at: null,
            cleaned_at: null,
          })
          .execute();
        return true;
      }
      if (
        !existing ||
        existing.source_git_baseline.toLowerCase() !==
          input.sourceGitBaseline.toLowerCase() ||
        existing.scope_hash.toLowerCase() !== input.scopeHash.toLowerCase() ||
        existing.before_manifest_hash.toLowerCase() !==
          input.beforeManifestHash.toLowerCase()
      ) {
        return false;
      }
      if (
        existing.lifecycle === input.lifecycle &&
        existing.after_manifest_hash === input.afterManifestHash
      ) {
        return true;
      }
      await transaction
        .updateTable('agent_run_capsules')
        .set({
          lifecycle: input.lifecycle,
          after_manifest_hash: input.afterManifestHash,
          diff_summary: input.diffSummary,
          verified_at: input.lifecycle === 'VERIFIED' ? input.occurredAt : null,
        })
        .where('id', '=', existing.id)
        .executeTakeFirstOrThrow();
      if (input.lifecycle === 'VERIFIED') {
        const sequenceRow = await transaction
          .selectFrom('agent_run_events')
          .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
          .where('run_id', '=', input.runId)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('agent_run_events')
          .values({
            id: input.eventId,
            run_id: input.runId,
            sequence: Number(sequenceRow.sequence ?? 0) + 1,
            event_type: 'CAPSULE_VERIFIED',
            summary: {
              changedFiles: input.diffSummary?.changedFiles ?? 0,
              changedBytes: input.diffSummary?.changedBytes ?? 0,
              afterManifestHash: input.afterManifestHash,
            },
            source_bridge_id: input.bridgeId,
            source_event_id: `${input.executionInstanceId}:capsule:verified`,
            occurred_at: input.occurredAt,
            received_at: input.occurredAt,
          })
          .execute();
      }
      return true;
    });
  }
}
