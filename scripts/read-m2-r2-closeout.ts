import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createDatabase } from '@pfc/persistence';
import { sql } from 'kysely';

import { asRecord } from './m2-r2-local-acceptance/http-client.ts';
import { m2R2AcceptancePaths } from './m2-r2-local-acceptance/local-files.ts';

const targetMigration = '202609060005_create_m2_approval_control';
const projectRoot = path.resolve(import.meta.dirname, '..');
const paths = m2R2AcceptancePaths(projectRoot);
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('M2_R2_READBACK_DATABASE_TARGET_INVALID');
}
const accounts = asRecord(
  JSON.parse(await readFile(paths.accountsFile, 'utf8')),
);
const apiResult = asRecord(
  JSON.parse(await readFile(paths.apiResultFile, 'utf8')),
);
const requester = asRecord(accounts.requester);
const approver = asRecord(accounts.approver);
const runIds = ['approved', 'rejected', 'cancelled', 'unknown'].map((key) => {
  const run = asRecord(apiResult[key]);
  if (typeof run.runId !== 'string') {
    throw new Error(`M2_R2_READBACK_RUN_ID_INVALID key=${key}`);
  }
  return run.runId;
});
for (const [field, value] of [
  ['requirementId', accounts.requirementId],
  ['baselineId', accounts.baselineId],
  ['workspaceId', accounts.workspaceId],
  ['requester.accountId', requester.accountId],
  ['approver.accountId', approver.accountId],
] as const) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`M2_R2_READBACK_INPUT_INVALID field=${field}`);
  }
}

const database = createDatabase({ connectionString, maxConnections: 1 });
try {
  const db = database.withSchema('pfc');
  const [
    migration,
    accountRows,
    memberships,
    requirement,
    workspace,
    binding,
    skill,
    runs,
    approvals,
    commands,
    events,
    capsules,
    auditCount,
    timelineCount,
    outboxCount,
  ] = await Promise.all([
    sql<{
      name: string;
    }>`select name from public.kysely_migration where name = ${targetMigration}`.execute(
      database,
    ),
    db
      .selectFrom('accounts')
      .select(['id', 'status'])
      .where('id', 'in', [
        String(requester.accountId),
        String(approver.accountId),
      ])
      .orderBy('id')
      .execute(),
    db
      .selectFrom('team_memberships')
      .select(['account_id', 'role', 'status'])
      .where('account_id', 'in', [
        String(requester.accountId),
        String(approver.accountId),
      ])
      .orderBy('account_id')
      .execute(),
    db
      .selectFrom('requirements')
      .select(['id', 'current_stage', 'current_baseline_id'])
      .where('id', '=', String(accounts.requirementId))
      .executeTakeFirst(),
    db
      .selectFrom('workspaces')
      .select(['id', 'status', 'verification_status'])
      .where('id', '=', String(accounts.workspaceId))
      .executeTakeFirst(),
    db
      .selectFrom('bridge_workspace_bindings')
      .innerJoin(
        'bridge_registrations',
        'bridge_registrations.id',
        'bridge_workspace_bindings.bridge_id',
      )
      .select([
        'bridge_workspace_bindings.bridge_id',
        'bridge_workspace_bindings.verification_status',
        'bridge_workspace_bindings.current_git_baseline',
        'bridge_registrations.status as bridge_status',
      ])
      .where(
        'bridge_workspace_bindings.workspace_id',
        '=',
        String(accounts.workspaceId),
      )
      .executeTakeFirst(),
    db
      .selectFrom('skill_releases')
      .select(['id', 'status', 'evaluation_status'])
      .where('skill_key', '=', 'pfc-controlled-artifact-edit')
      .where('version', '=', '2026.09.07-r2')
      .executeTakeFirst(),
    db
      .selectFrom('agent_runs')
      .select([
        'id',
        'status',
        'result_outcome',
        'failure_reason',
        'row_version',
      ])
      .where('id', 'in', runIds)
      .orderBy('created_at')
      .execute(),
    db
      .selectFrom('approval_requests')
      .select(['id', 'run_id', 'kind', 'decision', 'decided_by'])
      .where('run_id', 'in', runIds)
      .orderBy('requested_at')
      .execute(),
    db
      .selectFrom('agent_run_commands')
      .select(['id', 'run_id', 'command_type', 'status', 'attempt'])
      .where('run_id', 'in', runIds)
      .orderBy('created_at')
      .execute(),
    db
      .selectFrom('agent_run_events')
      .select(['run_id', 'sequence', 'event_type'])
      .where('run_id', 'in', runIds)
      .orderBy('run_id')
      .orderBy('sequence')
      .execute(),
    db
      .selectFrom('agent_run_capsules')
      .select(['run_id', 'lifecycle'])
      .where('run_id', 'in', runIds)
      .execute(),
    db
      .selectFrom('audit_events')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('target_id', 'in', [...runIds, String(accounts.requirementId)])
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('timeline_events')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('requirement_id', '=', String(accounts.requirementId))
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('outbox_events')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('aggregate_id', 'in', [...runIds, String(accounts.requirementId)])
      .executeTakeFirstOrThrow(),
  ]);

  const expectedStatuses = new Map(
    ['approved', 'rejected', 'cancelled', 'unknown'].map((key) => {
      const item = asRecord(apiResult[key]);
      return [String(item.runId), String(item.status)] as const;
    }),
  );
  const sequencesContinuous = runIds.every((runId) => {
    const runEvents = events.filter((event) => event.run_id === runId);
    return runEvents.every((event, index) => event.sequence === index + 1);
  });
  const assertions = {
    migrationApplied: migration.rows.length === 1,
    accountsActive:
      accountRows.length === 2 &&
      accountRows.every((row) => row.status === 'ACTIVE'),
    rolesCorrect:
      memberships.length === 2 &&
      memberships.some((row) => row.role === 'PRODUCT_MANAGER') &&
      memberships.some((row) => row.role === 'TEAM_ADMIN'),
    requirementBound:
      requirement?.current_baseline_id === accounts.baselineId &&
      requirement?.id === accounts.requirementId,
    bridgeVerified:
      binding?.verification_status === 'VERIFIED' &&
      typeof binding.current_git_baseline === 'string',
    skillActive:
      skill?.status === 'ACTIVE' && skill.evaluation_status === 'PASSED',
    runStatesMatch:
      runs.length === runIds.length &&
      runs.every((run) => expectedStatuses.get(run.id) === run.status),
    fourEyesRecorded:
      approvals.some(
        (approval) =>
          approval.decision === 'APPROVED' &&
          approval.decided_by === approver.accountId,
      ) && approvals.some((approval) => approval.decision === 'REJECTED'),
    commandsRecorded: commands.length > 0,
    eventsRecorded: events.length > 0 && sequencesContinuous,
    capsuleRecorded: capsules.some((capsule) => capsule.run_id === runIds[0]),
    auditRecorded: Number(auditCount.count) > 0,
    timelineRecorded: Number(timelineCount.count) > 0,
    outboxRecorded: Number(outboxCount.count) > 0,
  };
  if (Object.values(assertions).some((passed) => !passed)) {
    throw new Error(
      `M2_R2_READBACK_ASSERTION_FAILED ${JSON.stringify(assertions)}`,
    );
  }
  const readback = {
    status: 'PASS',
    target: { environment: 'local', database: 'pfc_local', schema: 'pfc' },
    migration: targetMigration,
    createdIds: {
      accountIds: accountRows.map((row) => row.id),
      requirementId: requirement?.id,
      workspaceId: workspace?.id,
      bridgeId: binding?.bridge_id,
      skillReleaseId: skill?.id,
      runIds,
      approvalIds: approvals.map((row) => row.id),
      commandIds: commands.map((row) => row.id),
    },
    roles: memberships.map((row) => ({
      accountId: row.account_id,
      role: row.role,
    })),
    workspace: {
      status: workspace?.status,
      registryVerification: workspace?.verification_status,
      bridgeVerification: binding?.verification_status,
      bridgeStatusAtReadback: binding?.bridge_status,
      gitBaselineRecorded: Boolean(binding?.current_git_baseline),
    },
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      resultOutcome: run.result_outcome,
      reasonCode: run.failure_reason,
      rowVersion: run.row_version,
    })),
    approvals: approvals.map((approval) => ({
      id: approval.id,
      runId: approval.run_id,
      kind: approval.kind,
      decision: approval.decision,
      decidedByDistinct: approval.decided_by
        ? approval.decided_by !== requester.accountId
        : null,
    })),
    commands: commands.map((command) => ({
      id: command.id,
      runId: command.run_id,
      type: command.command_type,
      status: command.status,
      attempt: command.attempt,
    })),
    counts: {
      events: events.length,
      capsules: capsules.length,
      audit: Number(auditCount.count),
      timeline: Number(timelineCount.count),
      outbox: Number(outboxCount.count),
    },
    assertions,
    retained: true,
    sensitiveData: 'NONE; credentials and connection string excluded',
  } as const;
  await writeFile(
    paths.readbackFile,
    `${JSON.stringify(readback, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(readback));
} finally {
  await database.destroy();
}
