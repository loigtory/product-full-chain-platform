import type {
  AgentApprovalDto,
  AgentRunDto,
  AgentRunEventDto,
  AgentRunScopeDto,
  MutationEvidence,
  OperationEvidence,
  SensitivityLevel,
  WorkspaceAccessLevel,
  WorkspaceVerificationStatus,
} from '@pfc/contracts';
import type { Transaction } from 'kysely';

import type { LifecycleDatabase, LifecycleKysely } from './database.ts';
import {
  capabilityAllowsRun,
  codexHarnessCompatible,
  parseStoredBridgeCapability,
  type StoredBridgeCapabilityEvidence,
} from './bridge-capability-evidence.ts';
import { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';
import { PostgresSkillRepository } from './skill-repository.ts';

type ScopedDatabase = ReturnType<LifecycleKysely['withSchema']>;
type ScopedTransaction = Transaction<LifecycleDatabase>;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function eventSummary(value: unknown): AgentRunEventDto['summary'] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AgentRunEventDto['summary'])
    : {};
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function startApprovalMatchesRun(
  approval: AgentApprovalDto,
  run: AgentRunDto,
): boolean {
  const scope = run.runScope;
  return Boolean(
    scope &&
    approval.kind === 'RUN_START' &&
    approval.decision === 'PENDING' &&
    approval.rowVersion === 0 &&
    approval.approvedScope === null &&
    approval.outsideCapsule === false &&
    approval.appServerRequestId === null &&
    approval.threadId === null &&
    approval.turnId === null &&
    approval.itemId === null &&
    approval.callbackId === null &&
    approval.decidedBy === null &&
    approval.decidedAt === null &&
    approval.reasonCode === null &&
    approval.requestedAt === run.createdAt &&
    approval.expiresAt === scope.expiresAt &&
    approval.requestedScope.networkAccess === false &&
    sameStringSet(
      approval.requestedScope.allowedRelativePaths,
      scope.allowedRelativePaths,
    ) &&
    sameStringSet(
      approval.requestedScope.allowedActions,
      scope.allowedActions,
    ) &&
    approval.requestedScope.maxChangedFiles === scope.maxChangedFiles &&
    approval.requestedScope.maxChangedBytes === scope.maxChangedBytes,
  );
}

function workspaceSourceIsWithinScope(
  sourceRef: string,
  allowedRelativePath: string,
): boolean {
  const source = sourceRef.replace(/\/+$/, '');
  const scope = allowedRelativePath.replace(/\/+$/, '');
  if (
    !source ||
    source.startsWith('/') ||
    /^[A-Za-z]:/.test(source) ||
    source.includes('\\') ||
    source.split('/').some((segment) => segment === '..')
  ) {
    return false;
  }
  return scope === '.' || source.startsWith(`${scope}/`);
}

function mapRun(row: {
  id: string;
  requirement_id: string;
  baseline_id: string;
  workspace_id: string;
  git_baseline: string;
  skill_release_id: string;
  operation: AgentRunDto['operation'];
  access_mode: AgentRunDto['accessMode'];
  status: AgentRunDto['status'];
  parent_run_id: string | null;
  bridge_id: string | null;
  execution_instance_id: string | null;
  codex_thread_id: string | null;
  codex_turn_id: string | null;
  result_outcome: AgentRunDto['resultOutcome'];
  run_scope: unknown | null;
  run_scope_hash: string | null;
  execution_started_at: Date | string | null;
  cancel_requested_at: Date | string | null;
  terminal_at: Date | string | null;
  result_summary: string | null;
  failure_reason: string | null;
  row_version: number;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}): AgentRunDto {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    baselineId: row.baseline_id,
    workspaceId: row.workspace_id,
    gitBaseline: row.git_baseline,
    skillReleaseId: row.skill_release_id,
    operation: row.operation,
    accessMode: row.access_mode,
    status: row.status,
    parentRunId: row.parent_run_id,
    bridgeId: row.bridge_id,
    executionInstanceId: row.execution_instance_id,
    externalIds: {
      threadId: row.codex_thread_id,
      turnId: row.codex_turn_id,
    },
    resultOutcome: row.result_outcome,
    runScope: row.run_scope as AgentRunScopeDto | null,
    runScopeHash: row.run_scope_hash,
    executionStartedAt: row.execution_started_at
      ? timestamp(row.execution_started_at)
      : null,
    cancelRequestedAt: row.cancel_requested_at
      ? timestamp(row.cancel_requested_at)
      : null,
    terminalAt: row.terminal_at ? timestamp(row.terminal_at) : null,
    resultSummary: row.result_summary,
    failureReason: row.failure_reason,
    rowVersion: row.row_version,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function mapEvent(row: {
  id: string;
  run_id: string;
  sequence: number;
  event_type: AgentRunEventDto['eventType'];
  summary: unknown;
  source_event_id: string | null;
  occurred_at: Date | string;
  received_at: Date | string;
}): AgentRunEventDto {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    eventType: row.event_type,
    summary: eventSummary(row.summary),
    sourceEventId: row.source_event_id,
    occurredAt: timestamp(row.occurred_at),
    receivedAt: timestamp(row.received_at),
  };
}

export class PostgresAgentRunRepository {
  private readonly db: ScopedDatabase;
  private readonly skills: PostgresSkillRepository;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
    this.skills = new PostgresSkillRepository(database, schemaName);
  }

  private async activeCapabilityUsing(
    database: ScopedDatabase | ScopedTransaction,
    bridgeId: string,
    checkedAt: string,
  ): Promise<StoredBridgeCapabilityEvidence | null> {
    const row = await database
      .selectFrom('bridge_capability_snapshots')
      .select('capabilities')
      .where('bridge_id', '=', bridgeId)
      .where('captured_at', '<=', new Date(checkedAt))
      .where('expires_at', '>', new Date(checkedAt))
      .orderBy('captured_at', 'desc')
      .executeTakeFirst();
    return parseStoredBridgeCapability(row?.capabilities);
  }

  async resolveCreationContext(input: {
    requirementId: string;
    baselineId: string;
    workspaceId: string;
    skillKey: string;
    skillVersion: string;
    operation: AgentRunDto['operation'];
    activeAfter: string;
    checkedAt: string;
  }): Promise<{
    requirementId: string;
    currentBaselineId: string;
    sensitivity: SensitivityLevel;
    workspaceId: string;
    workspaceVerificationStatus: WorkspaceVerificationStatus;
    workspaceAccessLevel: WorkspaceAccessLevel;
    skillReleaseId: string;
    skillContentHash: string;
    skillEvaluationStatus: 'NOT_EVALUATED' | 'PASSED' | 'FAILED';
    skillEnabled: boolean;
    currentGitBaseline: string;
    artifactVersionId: string;
    artifactSourceRef: string;
    artifactContentHash: string;
  } | null> {
    const context = await this.db
      .selectFrom('requirements')
      .innerJoin(
        'material_baselines',
        'material_baselines.id',
        'requirements.current_baseline_id',
      )
      .innerJoin(
        'requirement_workspaces',
        'requirement_workspaces.requirement_id',
        'requirements.id',
      )
      .innerJoin(
        'workspaces',
        'workspaces.id',
        'requirement_workspaces.workspace_id',
      )
      .innerJoin(
        'bridge_workspace_bindings',
        'bridge_workspace_bindings.workspace_id',
        'workspaces.id',
      )
      .innerJoin(
        'bridge_registrations',
        'bridge_registrations.id',
        'bridge_workspace_bindings.bridge_id',
      )
      .select([
        'requirements.id as requirement_id',
        'requirements.current_baseline_id',
        'material_baselines.sensitivity',
        'workspaces.id as workspace_id',
        'workspaces.verification_status',
        'requirement_workspaces.access_level',
        'requirement_workspaces.allowed_relative_path as requirement_allowed_relative_path',
        'bridge_workspace_bindings.bridge_id',
        'bridge_workspace_bindings.allowed_relative_path as bridge_allowed_relative_path',
        'bridge_workspace_bindings.current_git_baseline',
        'bridge_registrations.codex_version',
      ])
      .where('requirements.id', '=', input.requirementId)
      .where('material_baselines.id', '=', input.baselineId)
      .where('material_baselines.status', '=', 'CURRENT')
      .where('workspaces.id', '=', input.workspaceId)
      .where('workspaces.status', '=', 'ACTIVE')
      .where('bridge_workspace_bindings.verification_status', '=', 'VERIFIED')
      .where('bridge_workspace_bindings.current_git_baseline', 'is not', null)
      .where('bridge_registrations.status', '=', 'ONLINE')
      .where('bridge_registrations.revoked_at', 'is', null)
      .where(
        'bridge_registrations.last_heartbeat_at',
        '>=',
        new Date(input.activeAfter),
      )
      .orderBy('bridge_workspace_bindings.verified_at', 'desc')
      .executeTakeFirst();
    if (
      !context?.current_baseline_id ||
      !context.current_git_baseline ||
      context.requirement_allowed_relative_path !==
        context.bridge_allowed_relative_path
    ) {
      return null;
    }
    const artifacts = await this.db
      .selectFrom('artifacts')
      .innerJoin('artifact_versions', (join) =>
        join
          .onRef('artifact_versions.id', '=', 'artifacts.current_version_id')
          .onRef('artifact_versions.artifact_id', '=', 'artifacts.id'),
      )
      .select([
        'artifact_versions.id as artifact_version_id',
        'artifact_versions.source_ref',
        'artifact_versions.content_hash',
      ])
      .where('artifacts.requirement_id', '=', input.requirementId)
      .where('artifacts.status', '=', 'ACTIVE')
      .where('artifact_versions.source_type', '=', 'WORKSPACE_RELATIVE')
      .limit(2)
      .execute();
    const artifact = artifacts[0];
    if (
      artifacts.length !== 1 ||
      !artifact ||
      !workspaceSourceIsWithinScope(
        artifact.source_ref,
        context.requirement_allowed_relative_path,
      )
    ) {
      return null;
    }
    const skill = await this.db
      .selectFrom('skill_releases')
      .select([
        'id',
        'content_hash',
        'evaluation_status',
        'enabled_scopes',
        'compatible_harnesses',
        'status',
      ])
      .where('skill_key', '=', input.skillKey)
      .where('version', '=', input.skillVersion)
      .executeTakeFirst();
    if (!skill) return null;
    const scopes = Array.isArray(skill.enabled_scopes)
      ? skill.enabled_scopes
      : [];
    const capability = await this.activeCapabilityUsing(
      this.db,
      context.bridge_id,
      input.checkedAt,
    );
    return {
      requirementId: context.requirement_id,
      currentBaselineId: context.current_baseline_id,
      sensitivity: context.sensitivity,
      workspaceId: context.workspace_id,
      workspaceVerificationStatus: context.verification_status,
      workspaceAccessLevel: context.access_level,
      skillReleaseId: skill.id,
      skillContentHash: skill.content_hash,
      skillEvaluationStatus: skill.evaluation_status,
      skillEnabled:
        skill.status === 'ACTIVE' &&
        scopes.includes(input.operation) &&
        codexHarnessCompatible(
          stringList(skill.compatible_harnesses),
          context.codex_version,
        ) &&
        capabilityAllowsRun(capability, {
          workspaceId: context.workspace_id,
          gitBaseline: context.current_git_baseline,
          skillReleaseId: skill.id,
          skillContentHash: skill.content_hash,
        }),
      currentGitBaseline: context.current_git_baseline,
      artifactVersionId: artifact.artifact_version_id,
      artifactSourceRef: artifact.source_ref,
      artifactContentHash: artifact.content_hash,
    };
  }

  async resolveLaunchOptions(input: {
    requirementId: string;
    activeAfter: string;
    checkedAt: string;
  }) {
    const requirement = await this.db
      .selectFrom('requirements')
      .innerJoin(
        'material_baselines',
        'material_baselines.id',
        'requirements.current_baseline_id',
      )
      .select([
        'requirements.id as requirement_id',
        'requirements.current_baseline_id',
        'material_baselines.sensitivity',
      ])
      .where('requirements.id', '=', input.requirementId)
      .where('material_baselines.status', '=', 'CURRENT')
      .executeTakeFirst();
    if (!requirement?.current_baseline_id) return null;

    const artifacts = await this.db
      .selectFrom('artifacts')
      .innerJoin('artifact_versions', (join) =>
        join
          .onRef('artifact_versions.id', '=', 'artifacts.current_version_id')
          .onRef('artifact_versions.artifact_id', '=', 'artifacts.id'),
      )
      .select('artifact_versions.source_ref')
      .where('artifacts.requirement_id', '=', input.requirementId)
      .where('artifacts.status', '=', 'ACTIVE')
      .where('artifact_versions.source_type', '=', 'WORKSPACE_RELATIVE')
      .limit(2)
      .execute();
    const artifact = artifacts[0];
    if (artifacts.length !== 1 || !artifact) return null;

    const rows = await this.db
      .selectFrom('requirement_workspaces')
      .innerJoin(
        'workspaces',
        'workspaces.id',
        'requirement_workspaces.workspace_id',
      )
      .innerJoin(
        'bridge_workspace_bindings',
        'bridge_workspace_bindings.workspace_id',
        'workspaces.id',
      )
      .innerJoin(
        'bridge_registrations',
        'bridge_registrations.id',
        'bridge_workspace_bindings.bridge_id',
      )
      .select([
        'workspaces.id',
        'workspaces.name',
        'workspaces.repository_label',
        'bridge_workspace_bindings.current_git_baseline',
        'bridge_workspace_bindings.bridge_id',
        'bridge_workspace_bindings.verified_at',
        'bridge_registrations.codex_version',
        'requirement_workspaces.access_level',
        'requirement_workspaces.allowed_relative_path as requirement_allowed_relative_path',
        'bridge_workspace_bindings.allowed_relative_path as bridge_allowed_relative_path',
      ])
      .where('requirement_workspaces.requirement_id', '=', input.requirementId)
      .where('workspaces.status', '=', 'ACTIVE')
      .where('workspaces.verification_status', '=', 'VERIFIED')
      .where('bridge_workspace_bindings.verification_status', '=', 'VERIFIED')
      .where('bridge_workspace_bindings.current_git_baseline', 'is not', null)
      .where('bridge_registrations.status', '=', 'ONLINE')
      .where('bridge_registrations.revoked_at', 'is', null)
      .where(
        'bridge_registrations.last_heartbeat_at',
        '>=',
        new Date(input.activeAfter),
      )
      .orderBy('bridge_workspace_bindings.verified_at', 'desc')
      .execute();
    const releases = (await this.skills.listActive()).filter(
      (skill) =>
        skill.evaluationStatus === 'PASSED' &&
        skill.enabledScopes.some((scope) =>
          ['ARTIFACT_CHECK', 'CONTROLLED_ARTIFACT_EDIT'].includes(scope),
        ),
    );
    const capabilityEntries = await Promise.all(
      [...new Set(rows.map((row) => row.bridge_id))].map(
        async (bridgeId) =>
          [
            bridgeId,
            await this.activeCapabilityUsing(
              this.db,
              bridgeId,
              input.checkedAt,
            ),
          ] as const,
      ),
    );
    const capabilities = new Map(capabilityEntries);
    const workspaces = rows
      .filter(
        (
          row,
        ): row is typeof row & {
          current_git_baseline: string;
          verified_at: Date | string;
        } =>
          Boolean(
            row.current_git_baseline &&
            row.verified_at &&
            row.requirement_allowed_relative_path ===
              row.bridge_allowed_relative_path &&
            workspaceSourceIsWithinScope(
              artifact.source_ref,
              row.requirement_allowed_relative_path,
            ),
          ),
      )
      .map((row) => {
        const capability = capabilities.get(row.bridge_id) ?? null;
        const skillReleaseIds = releases
          .filter((skill) => {
            const supportsRead = skill.enabledScopes.includes('ARTIFACT_CHECK');
            const supportsWrite =
              row.access_level === 'WRITE' &&
              skill.enabledScopes.includes('CONTROLLED_ARTIFACT_EDIT');
            return Boolean(
              (supportsRead || supportsWrite) &&
              codexHarnessCompatible(
                skill.compatibleHarnesses,
                row.codex_version,
              ) &&
              capabilityAllowsRun(capability, {
                workspaceId: row.id,
                gitBaseline: row.current_git_baseline,
                skillReleaseId: skill.id,
                skillContentHash: skill.contentHash,
              }),
            );
          })
          .map((skill) => skill.id);
        return {
          id: row.id,
          name: row.name,
          repositoryLabel: row.repository_label,
          gitBaseline: row.current_git_baseline,
          bridgeId: row.bridge_id,
          lastVerifiedAt: timestamp(row.verified_at),
          accessLevel: row.access_level,
          skillReleaseIds,
        };
      })
      .filter((workspace) => workspace.skillReleaseIds.length > 0);
    const allowedSkillIds = new Set(
      workspaces.flatMap((workspace) => workspace.skillReleaseIds),
    );
    return {
      requirementId: requirement.requirement_id,
      baselineId: requirement.current_baseline_id,
      artifactSourceRef: artifact.source_ref,
      sensitivity: requirement.sensitivity,
      workspaces,
      skills: releases.filter((skill) => allowedSkillIds.has(skill.id)),
    };
  }

  private async findRunUsing(
    database: ScopedDatabase | ScopedTransaction,
    runId: string,
  ): Promise<AgentRunDto | null> {
    const row = await database
      .selectFrom('agent_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirst();
    return row ? mapRun(row) : null;
  }

  async createRun(input: {
    run: AgentRunDto;
    event: Omit<AgentRunEventDto, 'runId' | 'sequence'>;
    command: Readonly<{
      id: string;
      commandType: 'START_READ_ONLY_RUN' | 'START_WORKSPACE_WRITE_RUN';
      idempotencyKey: string;
      payload: Readonly<Record<string, unknown>>;
      createdAt: string;
    }> | null;
    startApproval: AgentApprovalDto | null;
    approvalEvidence: OperationEvidence | null;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'CREATED' | 'REPLAYED' | 'CONFLICT';
    run: AgentRunDto | null;
  }> {
    const workspaceWrite = input.run.accessMode === 'WORKSPACE_WRITE';
    if (
      (workspaceWrite &&
        (input.run.status !== 'WAITING_APPROVAL' ||
          input.command !== null ||
          !input.startApproval ||
          !startApprovalMatchesRun(input.startApproval, input.run) ||
          input.startApproval.runId !== input.run.id ||
          input.startApproval.executionInstanceId !==
            input.run.executionInstanceId ||
          input.startApproval.scopeHash !== input.run.runScopeHash ||
          input.startApproval.requestedBy !== input.run.createdBy ||
          input.startApproval.expiresAt !== input.run.runScope?.expiresAt ||
          !input.approvalEvidence)) ||
      (!workspaceWrite &&
        (input.run.status !== 'QUEUED' ||
          !input.command ||
          input.command.commandType !== 'START_READ_ONLY_RUN' ||
          input.startApproval !== null ||
          input.approvalEvidence !== null))
    ) {
      throw new Error('INVALID_AGENT_RUN_START_GATE');
    }
    return this.db.transaction().execute(async (transaction) => {
      const mutation = await claimMutation(transaction, input.mutation);
      if (mutation.status !== 'NEW') {
        return {
          status: mutation.status,
          run:
            mutation.status === 'REPLAYED' && mutation.resultReference
              ? await this.findRunUsing(transaction, mutation.resultReference)
              : null,
        };
      }
      const runRow = await transaction
        .insertInto('agent_runs')
        .values({
          id: input.run.id,
          requirement_id: input.run.requirementId,
          baseline_id: input.run.baselineId,
          workspace_id: input.run.workspaceId,
          git_baseline: input.run.gitBaseline,
          skill_release_id: input.run.skillReleaseId,
          operation: input.run.operation,
          access_mode: input.run.accessMode,
          status: input.run.status,
          parent_run_id: input.run.parentRunId,
          bridge_id: input.run.bridgeId,
          execution_instance_id: input.run.executionInstanceId,
          codex_thread_id: input.run.externalIds.threadId,
          codex_turn_id: input.run.externalIds.turnId,
          result_outcome: input.run.resultOutcome,
          run_scope: input.run.runScope,
          run_scope_hash: input.run.runScopeHash,
          execution_started_at: input.run.executionStartedAt,
          cancel_requested_at: input.run.cancelRequestedAt,
          terminal_at: input.run.terminalAt,
          result_summary: input.run.resultSummary,
          failure_reason: input.run.failureReason,
          row_version: input.run.rowVersion,
          created_by: input.run.createdBy,
          created_at: input.run.createdAt,
          updated_at: input.run.updatedAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('agent_run_events')
        .values({
          id: input.event.id,
          run_id: input.run.id,
          sequence: 1,
          event_type: input.event.eventType,
          summary: input.event.summary,
          source_bridge_id: null,
          source_event_id: input.event.sourceEventId,
          occurred_at: input.event.occurredAt,
          received_at: input.event.receivedAt,
        })
        .executeTakeFirstOrThrow();
      if (input.command) {
        await transaction
          .insertInto('agent_run_commands')
          .values({
            id: input.command.id,
            run_id: input.run.id,
            command_type: input.command.commandType,
            payload: input.command.payload,
            status: 'PENDING',
            priority: 100,
            execution_instance_id: input.run.executionInstanceId,
            lease_owner: null,
            lease_until: null,
            attempt: 0,
            idempotency_key: input.command.idempotencyKey,
            result_summary: null,
            created_at: input.command.createdAt,
            updated_at: input.command.createdAt,
          })
          .execute();
      } else {
        const approval = input.startApproval!;
        await transaction
          .insertInto('approval_requests')
          .values({
            id: approval.id,
            run_id: approval.runId,
            execution_instance_id: approval.executionInstanceId,
            app_server_request_id: null,
            thread_id: null,
            turn_id: null,
            item_id: null,
            callback_id: null,
            kind: 'RUN_START',
            requested_scope: approval.requestedScope,
            approved_scope: null,
            scope_hash: approval.scopeHash,
            outside_capsule: false,
            decision: 'PENDING',
            requested_by: approval.requestedBy,
            requested_at: approval.requestedAt,
            expires_at: approval.expiresAt,
            decided_by: null,
            decided_at: null,
            reason_code: null,
            row_version: 0,
          })
          .execute();
      }
      await appendMutationEvidence(transaction, input.mutation);
      if (input.approvalEvidence) {
        await appendMutationEvidence(transaction, input.approvalEvidence);
      }
      return { status: 'CREATED', run: mapRun(runRow) };
    });
  }

  async findRun(runId: string): Promise<AgentRunDto | null> {
    return this.findRunUsing(this.db, runId);
  }

  async findRunSensitivity(runId: string): Promise<SensitivityLevel | null> {
    const row = await this.db
      .selectFrom('agent_runs')
      .innerJoin(
        'material_baselines',
        'material_baselines.id',
        'agent_runs.baseline_id',
      )
      .select('material_baselines.sensitivity')
      .where('agent_runs.id', '=', runId)
      .executeTakeFirst();
    return row?.sensitivity ?? null;
  }

  async listRunsForActor(
    actorId: string,
    limit: number,
  ): Promise<readonly AgentRunDto[]> {
    const rows = await this.db
      .selectFrom('agent_runs')
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
          .on('team_memberships.account_id', '=', actorId),
      )
      .selectAll('agent_runs')
      .distinct()
      .where('requirement_assignments.account_id', '=', actorId)
      .where('requirement_assignments.status', '=', 'ACTIVE')
      .where('team_memberships.status', '=', 'ACTIVE')
      .orderBy('agent_runs.updated_at', 'desc')
      .limit(Math.min(Math.max(limit, 1), 100))
      .execute();
    return rows.map(mapRun);
  }

  async leaseNextCommand(input: {
    bridgeId: string;
    leasedAt: string;
    leaseUntil: string;
    eventId: string;
  }): Promise<{
    commandId: string;
    runId: string;
    commandType:
      | 'START_READ_ONLY_RUN'
      | 'START_WORKSPACE_WRITE_RUN'
      | 'RESOLVE_APPROVAL'
      | 'INTERRUPT_RUN'
      | 'VERIFY_RUN_STATE';
    leaseUntil: string;
    attempt: number;
    afterSequence: number;
    payload: Readonly<Record<string, unknown>>;
  } | null> {
    if (Date.parse(input.leaseUntil) <= Date.parse(input.leasedAt)) {
      throw new Error('BRIDGE_COMMAND_LEASE_INVALID');
    }
    return this.db.transaction().execute(async (transaction) => {
      const bridge = await transaction
        .selectFrom('bridge_registrations')
        .select(['id', 'codex_version'])
        .where('id', '=', input.bridgeId)
        .where('status', '=', 'ONLINE')
        .where('revoked_at', 'is', null)
        .where(
          'last_heartbeat_at',
          '>=',
          new Date(Date.parse(input.leasedAt) - 90_000),
        )
        .executeTakeFirst();
      if (!bridge) return null;

      const active = await transaction
        .selectFrom('agent_run_commands')
        .select(({ fn }) => fn.count<number>('id').as('count'))
        .where('lease_owner', '=', input.bridgeId)
        .where('status', '=', 'LEASED')
        .where('lease_until', '>', new Date(input.leasedAt))
        .where('command_type', 'in', [
          'START_READ_ONLY_RUN',
          'START_WORKSPACE_WRITE_RUN',
        ])
        .executeTakeFirstOrThrow();

      const candidates = await transaction
        .selectFrom('agent_run_commands')
        .innerJoin('agent_runs', 'agent_runs.id', 'agent_run_commands.run_id')
        .innerJoin(
          'bridge_workspace_bindings',
          'bridge_workspace_bindings.workspace_id',
          'agent_runs.workspace_id',
        )
        .innerJoin(
          'skill_releases',
          'skill_releases.id',
          'agent_runs.skill_release_id',
        )
        .select([
          'agent_run_commands.id as command_id',
          'agent_run_commands.run_id',
          'agent_run_commands.command_type',
          'agent_run_commands.payload',
          'agent_run_commands.status as command_status',
          'agent_run_commands.attempt',
          'agent_run_commands.lease_owner',
          'agent_run_commands.lease_until',
          'agent_run_commands.execution_instance_id as command_execution_instance_id',
          'agent_runs.status as run_status',
          'agent_runs.operation as run_operation',
          'agent_runs.access_mode as run_access_mode',
          'agent_runs.bridge_id as run_bridge_id',
          'agent_runs.execution_instance_id as run_execution_instance_id',
          'agent_runs.requirement_id',
          'agent_runs.baseline_id',
          'agent_runs.workspace_id',
          'agent_runs.git_baseline',
          'agent_runs.skill_release_id',
          'skill_releases.content_hash as skill_content_hash',
          'skill_releases.evaluation_status as skill_evaluation_status',
          'skill_releases.enabled_scopes as skill_enabled_scopes',
          'skill_releases.compatible_harnesses as skill_compatible_harnesses',
          'skill_releases.status as skill_status',
        ])
        .where((expression) =>
          expression.or([
            expression('agent_run_commands.status', '=', 'PENDING'),
            expression.and([
              expression('agent_run_commands.status', '=', 'LEASED'),
              expression('agent_run_commands.lease_owner', '=', input.bridgeId),
              expression(
                'agent_run_commands.lease_until',
                '<=',
                new Date(input.leasedAt),
              ),
            ]),
          ]),
        )
        .where((expression) =>
          expression.or([
            expression.and([
              expression('agent_run_commands.command_type', 'in', [
                'START_READ_ONLY_RUN',
                'START_WORKSPACE_WRITE_RUN',
              ]),
              expression.or([
                expression.and([
                  expression('agent_run_commands.status', '=', 'PENDING'),
                  expression('agent_runs.status', 'in', [
                    'QUEUED',
                    'RETRY_QUEUED',
                  ]),
                ]),
                expression.and([
                  expression('agent_run_commands.status', '=', 'LEASED'),
                  expression('agent_runs.status', '=', 'STARTING'),
                  expression('agent_runs.bridge_id', '=', input.bridgeId),
                ]),
              ]),
              expression(
                'bridge_workspace_bindings.bridge_id',
                '=',
                input.bridgeId,
              ),
              expression(
                'bridge_workspace_bindings.verification_status',
                '=',
                'VERIFIED',
              ),
              expression(
                'bridge_workspace_bindings.current_git_baseline',
                '=',
                expression.ref('agent_runs.git_baseline'),
              ),
            ]),
            expression.and([
              expression('agent_run_commands.command_type', 'in', [
                'RESOLVE_APPROVAL',
                'INTERRUPT_RUN',
                'VERIFY_RUN_STATE',
              ]),
              expression('agent_runs.bridge_id', '=', input.bridgeId),
              expression(
                'agent_run_commands.execution_instance_id',
                '=',
                expression.ref('agent_runs.execution_instance_id'),
              ),
            ]),
          ]),
        )
        .orderBy('agent_run_commands.priority')
        .orderBy('agent_run_commands.created_at')
        .limit(25)
        .forUpdate()
        .skipLocked()
        .execute();
      const capability = await this.activeCapabilityUsing(
        transaction,
        input.bridgeId,
        input.leasedAt,
      );
      const candidate = candidates.find((item) => {
        const isStart = [
          'START_READ_ONLY_RUN',
          'START_WORKSPACE_WRITE_RUN',
        ].includes(item.command_type);
        const reclaiming = item.command_status === 'LEASED';
        if (
          reclaiming &&
          (!isStart ||
            item.run_status !== 'STARTING' ||
            item.run_bridge_id !== input.bridgeId ||
            item.lease_owner !== input.bridgeId)
        ) {
          return false;
        }
        if (!isStart) {
          if (item.command_type === 'RESOLVE_APPROVAL') {
            return item.run_status === 'WAITING_APPROVAL';
          }
          if (item.command_type === 'INTERRUPT_RUN') {
            return item.run_status === 'CANCELLING';
          }
          return item.run_status === 'VERIFYING';
        }
        if (!reclaiming && Number(active.count) >= 3) return false;
        if (
          !reclaiming &&
          !['QUEUED', 'RETRY_QUEUED'].includes(item.run_status)
        ) {
          return false;
        }
        if (
          (item.command_type === 'START_READ_ONLY_RUN' &&
            (item.run_access_mode !== 'READ_ONLY' ||
              item.run_operation !== 'ARTIFACT_CHECK')) ||
          (item.command_type === 'START_WORKSPACE_WRITE_RUN' &&
            (item.run_access_mode !== 'WORKSPACE_WRITE' ||
              item.run_operation !== 'CONTROLLED_ARTIFACT_EDIT' ||
              !item.run_execution_instance_id ||
              item.command_execution_instance_id !==
                item.run_execution_instance_id))
        ) {
          return false;
        }
        const enabledScopes = Array.isArray(item.skill_enabled_scopes)
          ? item.skill_enabled_scopes
          : [];
        return (
          item.skill_status === 'ACTIVE' &&
          item.skill_evaluation_status === 'PASSED' &&
          enabledScopes.includes(item.run_operation) &&
          codexHarnessCompatible(
            stringList(item.skill_compatible_harnesses),
            bridge.codex_version,
          ) &&
          capabilityAllowsRun(capability, {
            workspaceId: item.workspace_id,
            gitBaseline: item.git_baseline,
            skillReleaseId: item.skill_release_id,
            skillContentHash: item.skill_content_hash,
          })
        );
      });
      if (!candidate) return null;

      const attempt = candidate.attempt + 1;
      await transaction
        .updateTable('agent_run_commands')
        .set({
          status: 'LEASED',
          lease_owner: input.bridgeId,
          lease_until: input.leaseUntil,
          attempt,
          updated_at: input.leasedAt,
        })
        .where('id', '=', candidate.command_id)
        .where((expression) =>
          candidate.command_status === 'LEASED'
            ? expression.and([
                expression('status', '=', 'LEASED'),
                expression('lease_owner', '=', input.bridgeId),
                expression('lease_until', '<=', new Date(input.leasedAt)),
              ])
            : expression('status', '=', 'PENDING'),
        )
        .executeTakeFirstOrThrow();
      const sequenceRow = await transaction
        .selectFrom('agent_run_events')
        .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
        .where('run_id', '=', candidate.run_id)
        .executeTakeFirstOrThrow();
      let sequence = Number(sequenceRow.sequence ?? 0);
      const isStart = [
        'START_READ_ONLY_RUN',
        'START_WORKSPACE_WRITE_RUN',
      ].includes(candidate.command_type);
      if (isStart && candidate.command_status === 'PENDING') {
        await transaction
          .updateTable('agent_runs')
          .set((expression) => ({
            status: 'STARTING',
            bridge_id: input.bridgeId,
            row_version: expression('row_version', '+', 1),
            updated_at: input.leasedAt,
          }))
          .where('id', '=', candidate.run_id)
          .executeTakeFirstOrThrow();
        sequence += 1;
        await transaction
          .insertInto('agent_run_events')
          .values({
            id: input.eventId,
            run_id: candidate.run_id,
            sequence,
            event_type: 'BRIDGE_ASSIGNED',
            summary: { bridgeAssigned: true },
            source_bridge_id: input.bridgeId,
            source_event_id: `${candidate.command_id}-assigned`,
            occurred_at: input.leasedAt,
            received_at: input.leasedAt,
          })
          .execute();
      }
      const storedPayload =
        candidate.payload &&
        typeof candidate.payload === 'object' &&
        !Array.isArray(candidate.payload)
          ? (candidate.payload as Record<string, unknown>)
          : {};
      const startPayload = { ...storedPayload };
      delete startPayload.runId;
      return {
        commandId: candidate.command_id,
        runId: candidate.run_id,
        commandType: candidate.command_type,
        leaseUntil: input.leaseUntil,
        attempt,
        afterSequence: sequence,
        payload: isStart
          ? {
              ...startPayload,
              requirementId: candidate.requirement_id,
              baselineId: candidate.baseline_id,
              workspaceId: candidate.workspace_id,
              gitBaseline: candidate.git_baseline,
              skillReleaseId: candidate.skill_release_id,
              skillContentHash: candidate.skill_content_hash,
              objectiveKey:
                candidate.command_type === 'START_WORKSPACE_WRITE_RUN'
                  ? 'CONTROLLED_ARTIFACT_EDIT'
                  : 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK',
              accessMode:
                candidate.command_type === 'START_WORKSPACE_WRITE_RUN'
                  ? 'WORKSPACE_WRITE'
                  : 'READ_ONLY',
            }
          : storedPayload,
      };
    });
  }

  async listEvents(
    runId: string,
    afterSequence: number,
    limit: number,
  ): Promise<readonly AgentRunEventDto[]> {
    const rows = await this.db
      .selectFrom('agent_run_events')
      .selectAll()
      .where('run_id', '=', runId)
      .where('sequence', '>', afterSequence)
      .orderBy('sequence')
      .limit(Math.min(Math.max(limit, 1), 200))
      .execute();
    return rows.map(mapEvent);
  }

  async appendEvent(input: {
    id: string;
    commandId: string;
    runId: string;
    expectedSequence: number;
    bridgeId: string;
    sourceEventId: string;
    eventType: AgentRunEventDto['eventType'];
    summary: AgentRunEventDto['summary'];
    occurredAt: string;
    receivedAt: string;
  }): Promise<{
    status: 'APPENDED' | 'DUPLICATE' | 'SEQUENCE_GAP' | 'COMMAND_INVALID';
    event: AgentRunEventDto | null;
  }> {
    return this.db.transaction().execute(async (transaction) => {
      const command = await transaction
        .selectFrom('agent_run_commands')
        .select('id')
        .where('id', '=', input.commandId)
        .where('run_id', '=', input.runId)
        .where('lease_owner', '=', input.bridgeId)
        .where('status', '=', 'LEASED')
        .executeTakeFirst();
      if (!command) return { status: 'COMMAND_INVALID', event: null };

      const duplicate = await transaction
        .selectFrom('agent_run_events')
        .selectAll()
        .where('run_id', '=', input.runId)
        .where('source_bridge_id', '=', input.bridgeId)
        .where('source_event_id', '=', input.sourceEventId)
        .executeTakeFirst();
      if (duplicate) return { status: 'DUPLICATE', event: mapEvent(duplicate) };

      await transaction
        .selectFrom('agent_runs')
        .select('id')
        .where('id', '=', input.runId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const current = await transaction
        .selectFrom('agent_run_events')
        .select(({ fn }) => fn.max<number>('sequence').as('sequence'))
        .where('run_id', '=', input.runId)
        .executeTakeFirstOrThrow();
      if (Number(current.sequence ?? 0) + 1 !== input.expectedSequence) {
        return { status: 'SEQUENCE_GAP', event: null };
      }
      const row = await transaction
        .insertInto('agent_run_events')
        .values({
          id: input.id,
          run_id: input.runId,
          sequence: input.expectedSequence,
          event_type: input.eventType,
          summary: input.summary,
          source_bridge_id: input.bridgeId,
          source_event_id: input.sourceEventId,
          occurred_at: input.occurredAt,
          received_at: input.receivedAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (input.eventType === 'TURN_STARTED') {
        const threadId =
          typeof input.summary.threadId === 'string'
            ? input.summary.threadId
            : null;
        const turnId =
          typeof input.summary.turnId === 'string'
            ? input.summary.turnId
            : null;
        await transaction
          .updateTable('agent_runs')
          .set((expression) => ({
            status: 'RUNNING',
            codex_thread_id: threadId,
            codex_turn_id: turnId,
            execution_started_at: input.receivedAt,
            row_version: expression('row_version', '+', 1),
            updated_at: input.receivedAt,
          }))
          .where('id', '=', input.runId)
          .where('bridge_id', '=', input.bridgeId)
          .where('status', '=', 'STARTING')
          .execute();
      }
      return { status: 'APPENDED', event: mapEvent(row) };
    });
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
  }): Promise<'ACKNOWLEDGED' | 'IGNORED'> {
    return this.db.transaction().execute(async (transaction) => {
      const command = await transaction
        .selectFrom('agent_run_commands')
        .select(['id', 'status', 'command_type'])
        .where('id', '=', input.commandId)
        .where('run_id', '=', input.runId)
        .where('lease_owner', '=', input.bridgeId)
        .forUpdate()
        .executeTakeFirst();
      if (!command || command.status !== 'LEASED') return 'IGNORED';
      const run = await transaction
        .selectFrom('agent_runs')
        .select('status')
        .where('id', '=', input.runId)
        .where('bridge_id', '=', input.bridgeId)
        .forUpdate()
        .executeTakeFirst();
      if (!run) return 'IGNORED';

      const commandStatus =
        input.status === 'SUCCEEDED'
          ? 'ACKNOWLEDGED'
          : input.status === 'CANCELLED'
            ? 'CANCELLED'
            : input.status === 'UNKNOWN'
              ? 'UNKNOWN'
              : 'FAILED';
      const isControl = [
        'RESOLVE_APPROVAL',
        'INTERRUPT_RUN',
        'VERIFY_RUN_STATE',
      ].includes(command.command_type);
      if (isControl) {
        let nextStatus = run.status;
        if (command.command_type === 'RESOLVE_APPROVAL') {
          nextStatus = input.status === 'SUCCEEDED' ? 'RUNNING' : 'UNKNOWN';
        } else if (command.command_type === 'INTERRUPT_RUN') {
          nextStatus =
            input.status === 'SUCCEEDED'
              ? ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status)
                ? run.status
                : 'CANCELLING'
              : 'UNKNOWN';
        } else {
          nextStatus =
            input.status === 'UNKNOWN' &&
            input.reasonCode === 'RUN_STILL_ACTIVE'
              ? 'RUNNING'
              : input.status === 'SUCCEEDED'
                ? 'SUCCEEDED'
                : input.status === 'CANCELLED'
                  ? 'CANCELLED'
                  : input.status === 'FAILED' || input.status === 'REJECTED'
                    ? 'FAILED'
                    : 'UNKNOWN';
        }
        const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(
          nextStatus,
        );
        await transaction
          .updateTable('agent_run_commands')
          .set({
            status: commandStatus,
            result_summary: {
              status: input.status,
              reasonCode: input.reasonCode ?? null,
            },
            updated_at: input.acknowledgedAt,
          })
          .where('id', '=', input.commandId)
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('agent_runs')
          .set((expression) => ({
            status: nextStatus,
            ...(input.threadId ? { codex_thread_id: input.threadId } : {}),
            ...(input.turnId ? { codex_turn_id: input.turnId } : {}),
            result_outcome:
              nextStatus === 'SUCCEEDED'
                ? 'PASS'
                : nextStatus === 'FAILED'
                  ? 'BLOCKED'
                  : nextStatus === 'UNKNOWN'
                    ? 'UNKNOWN'
                    : null,
            failure_reason:
              nextStatus === 'FAILED' || nextStatus === 'UNKNOWN'
                ? (input.reasonCode ?? 'CONTROL_RESULT_UNKNOWN')
                : null,
            terminal_at: terminal ? input.acknowledgedAt : null,
            row_version: expression('row_version', '+', 1),
            updated_at: input.acknowledgedAt,
          }))
          .where('id', '=', input.runId)
          .executeTakeFirstOrThrow();
        return 'ACKNOWLEDGED';
      }

      const missingStartEvidence =
        input.status === 'SUCCEEDED' && run.status !== 'RUNNING';
      const runStatus = missingStartEvidence
        ? 'UNKNOWN'
        : input.status === 'SUCCEEDED'
          ? 'SUCCEEDED'
          : input.status === 'CANCELLED'
            ? 'CANCELLED'
            : input.status === 'FAILED' || input.status === 'REJECTED'
              ? 'FAILED'
              : 'UNKNOWN';
      const failureReason =
        runStatus === 'UNKNOWN'
          ? missingStartEvidence
            ? 'MISSING_TURN_STARTED_EVIDENCE'
            : (input.reasonCode ?? 'EXECUTION_RESULT_UNKNOWN')
          : runStatus === 'FAILED'
            ? (input.reasonCode ?? 'EXECUTION_FAILED')
            : null;
      const resultEvent =
        runStatus === 'SUCCEEDED' || runStatus === 'FAILED'
          ? await transaction
              .selectFrom('agent_run_events')
              .select('summary')
              .where('run_id', '=', input.runId)
              .where('event_type', '=', 'AGENT_MESSAGE')
              .orderBy('sequence', 'desc')
              .executeTakeFirst()
          : null;
      const storedResult = eventSummary(resultEvent?.summary).text;
      const resultSummary: string | null =
        typeof storedResult === 'string' && storedResult.trim()
          ? storedResult.trim().slice(0, 2_000)
          : runStatus === 'SUCCEEDED'
            ? 'Read-only artifact check completed.'
            : null;
      await transaction
        .updateTable('agent_run_commands')
        .set({
          status: commandStatus,
          result_summary: {
            status: input.status,
            reasonCode: input.reasonCode ?? null,
          },
          updated_at: input.acknowledgedAt,
        })
        .where('id', '=', input.commandId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('agent_runs')
        .set((expression) => ({
          status: runStatus,
          ...(input.threadId ? { codex_thread_id: input.threadId } : {}),
          ...(input.turnId ? { codex_turn_id: input.turnId } : {}),
          result_summary: resultSummary,
          failure_reason: failureReason,
          result_outcome:
            runStatus === 'SUCCEEDED'
              ? 'PASS'
              : runStatus === 'FAILED'
                ? 'BLOCKED'
                : runStatus === 'UNKNOWN'
                  ? 'UNKNOWN'
                  : null,
          terminal_at: ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(runStatus)
            ? input.acknowledgedAt
            : null,
          row_version: expression('row_version', '+', 1),
          updated_at: input.acknowledgedAt,
        }))
        .where('id', '=', input.runId)
        .executeTakeFirstOrThrow();
      return 'ACKNOWLEDGED';
    });
  }
}
