import type { AgentApprovalDto, AgentApprovalScopeDto } from '@pfc/contracts';
import type { Transaction } from 'kysely';

import type { LifecycleDatabase } from './database.ts';
import {
  capabilityAllowsRun,
  codexHarnessCompatible,
  parseStoredBridgeCapability,
} from './bridge-capability-evidence.ts';

type PendingRunStart = Readonly<{
  id: string;
  requirement_id: string;
  baseline_id: string;
  workspace_id: string;
  git_baseline: string;
  skill_release_id: string;
  operation: string;
  access_mode: string;
  execution_instance_id: string | null;
  run_scope: unknown | null;
  run_scope_hash: string | null;
  created_by: string;
}>;

export async function buildApprovedRunStartPayload(input: {
  transaction: Transaction<LifecycleDatabase>;
  run: PendingRunStart;
  approval: AgentApprovalDto;
  decidedAt: string;
}): Promise<Readonly<Record<string, unknown>>> {
  const { transaction, run, approval, decidedAt } = input;
  const requirement = await transaction
    .selectFrom('requirements')
    .select('current_baseline_id')
    .where('id', '=', run.requirement_id)
    .executeTakeFirst();
  const binding = await transaction
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
      'requirement_workspaces.allowed_relative_path',
      'requirement_workspaces.access_level',
      'workspaces.verification_status as workspace_verification_status',
      'bridge_workspace_bindings.bridge_id',
      'bridge_workspace_bindings.verification_status as binding_verification_status',
      'bridge_workspace_bindings.current_git_baseline',
      'bridge_registrations.codex_version',
    ])
    .where('requirement_workspaces.requirement_id', '=', run.requirement_id)
    .where('requirement_workspaces.workspace_id', '=', run.workspace_id)
    .where('bridge_registrations.status', '=', 'ONLINE')
    .where('bridge_registrations.revoked_at', 'is', null)
    .where(
      'bridge_registrations.last_heartbeat_at',
      '>=',
      new Date(Date.parse(decidedAt) - 90_000),
    )
    .executeTakeFirst();
  const skill = await transaction
    .selectFrom('skill_releases')
    .select([
      'content_hash',
      'compatible_harnesses',
      'enabled_scopes',
      'evaluation_status',
      'status',
    ])
    .where('id', '=', run.skill_release_id)
    .executeTakeFirst();
  const artifacts = await transaction
    .selectFrom('artifacts')
    .innerJoin('artifact_versions', (join) =>
      join
        .onRef('artifact_versions.id', '=', 'artifacts.current_version_id')
        .onRef('artifact_versions.artifact_id', '=', 'artifacts.id'),
    )
    .select([
      'artifact_versions.id',
      'artifact_versions.source_ref',
      'artifact_versions.content_hash',
    ])
    .where('artifacts.requirement_id', '=', run.requirement_id)
    .where('artifacts.status', '=', 'ACTIVE')
    .where('artifact_versions.source_type', '=', 'WORKSPACE_RELATIVE')
    .limit(2)
    .execute();
  const capabilityRow = binding
    ? await transaction
        .selectFrom('bridge_capability_snapshots')
        .select('capabilities')
        .where('bridge_id', '=', binding.bridge_id)
        .where('captured_at', '<=', new Date(decidedAt))
        .where('expires_at', '>', new Date(decidedAt))
        .orderBy('captured_at', 'desc')
        .executeTakeFirst()
    : null;
  const runScope = run.run_scope as
    (AgentApprovalScopeDto & { expiresAt?: string }) | null;
  const artifact = artifacts[0];
  const harnesses = Array.isArray(skill?.compatible_harnesses)
    ? skill.compatible_harnesses.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const enabledScopes = Array.isArray(skill?.enabled_scopes)
    ? skill.enabled_scopes
    : [];
  const validContext = Boolean(
    requirement?.current_baseline_id === run.baseline_id &&
    run.access_mode === 'WORKSPACE_WRITE' &&
    run.operation === 'CONTROLLED_ARTIFACT_EDIT' &&
    run.execution_instance_id === approval.executionInstanceId &&
    run.run_scope_hash === approval.scopeHash &&
    run.created_by === approval.requestedBy &&
    runScope?.expiresAt &&
    Date.parse(runScope.expiresAt) > Date.parse(decidedAt) &&
    binding?.access_level === 'WRITE' &&
    binding.workspace_verification_status === 'VERIFIED' &&
    binding.binding_verification_status === 'VERIFIED' &&
    binding.current_git_baseline === run.git_baseline &&
    skill?.status === 'ACTIVE' &&
    skill.evaluation_status === 'PASSED' &&
    enabledScopes.includes('CONTROLLED_ARTIFACT_EDIT') &&
    codexHarnessCompatible(harnesses, binding.codex_version) &&
    artifacts.length === 1 &&
    artifact &&
    approval.requestedScope.allowedRelativePaths.length === 1 &&
    artifact.source_ref === approval.requestedScope.allowedRelativePaths[0] &&
    capabilityAllowsRun(
      parseStoredBridgeCapability(capabilityRow?.capabilities),
      {
        workspaceId: run.workspace_id,
        gitBaseline: run.git_baseline,
        skillReleaseId: run.skill_release_id,
        skillContentHash: skill.content_hash,
      },
    ),
  );
  if (!validContext || !artifact || !skill || !binding || !runScope) {
    throw new Error('AGENT_RUN_START_CONTEXT_STALE');
  }
  return {
    requirementId: run.requirement_id,
    baselineId: run.baseline_id,
    workspaceId: run.workspace_id,
    gitBaseline: run.git_baseline,
    skillReleaseId: run.skill_release_id,
    skillContentHash: skill.content_hash,
    artifactVersionId: artifact.id,
    artifactSourceRef: artifact.source_ref,
    artifactContentHash: artifact.content_hash,
    executionInstanceId: run.execution_instance_id,
    runScope,
    runScopeHash: run.run_scope_hash,
    objectiveKey: 'CONTROLLED_ARTIFACT_EDIT',
    accessMode: 'WORKSPACE_WRITE',
  };
}
