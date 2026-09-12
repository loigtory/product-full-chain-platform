import type { PasswordDerivation } from '../../apps/server/src/identity/security.ts';
import type { LifecycleKysely } from '../../packages/persistence/src/index.ts';
import type { createM2R2TestData } from '../../packages/test-data/src/index.ts';

type AcceptanceData = ReturnType<typeof createM2R2TestData>;

export async function seedM2R2LocalAcceptanceDatabase(input: {
  database: LifecycleKysely;
  data: AcceptanceData;
  requesterPassword: PasswordDerivation;
  approverPassword: PasswordDerivation;
  skillReleaseId: string;
}) {
  const { data, database } = input;
  const db = database.withSchema('pfc');

  await database.transaction().execute(async (transaction) => {
    const scoped = transaction.withSchema('pfc');
    const collisions = await Promise.all([
      scoped
        .selectFrom('accounts')
        .select('id')
        .where((expression) =>
          expression.or([
            expression('id', 'in', [data.requester.id, data.approver.id]),
            expression('login_name', 'in', [
              data.requester.loginName,
              data.approver.loginName,
            ]),
          ]),
        )
        .executeTakeFirst(),
      scoped
        .selectFrom('teams')
        .select('id')
        .where((expression) =>
          expression.or([
            expression('id', '=', data.team.id),
            expression('name', '=', data.team.name),
          ]),
        )
        .executeTakeFirst(),
      scoped
        .selectFrom('requirements')
        .select('id')
        .where('id', '=', data.requirement.id)
        .executeTakeFirst(),
      scoped
        .selectFrom('workspaces')
        .select('id')
        .where('id', '=', data.workspace.id)
        .executeTakeFirst(),
      scoped
        .selectFrom('artifacts')
        .select('id')
        .where('id', '=', data.artifact.id)
        .executeTakeFirst(),
    ]);
    if (collisions.some(Boolean)) {
      throw new Error('M2_R2_ACCEPTANCE_DATA_EXISTS');
    }

    await scoped
      .insertInto('accounts')
      .values([
        {
          id: data.requester.id,
          login_name: data.requester.loginName,
          display_name: data.requester.displayName,
          password_hash: input.requesterPassword.hash,
          password_salt: input.requesterPassword.salt,
          status: 'ACTIVE',
          row_version: 0,
          created_at: data.now,
          updated_at: data.now,
        },
        {
          id: data.approver.id,
          login_name: data.approver.loginName,
          display_name: data.approver.displayName,
          password_hash: input.approverPassword.hash,
          password_salt: input.approverPassword.salt,
          status: 'ACTIVE',
          row_version: 0,
          created_at: data.now,
          updated_at: data.now,
        },
      ])
      .execute();
    await scoped
      .insertInto('teams')
      .values({
        id: data.team.id,
        name: data.team.name,
        status: 'ACTIVE',
        owner_account_id: data.approver.id,
        row_version: 0,
        created_at: data.now,
        updated_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('team_memberships')
      .values([
        {
          team_id: data.team.id,
          account_id: data.requester.id,
          role: data.requester.role,
          status: 'ACTIVE',
          joined_at: data.now,
          created_at: data.now,
        },
        {
          team_id: data.team.id,
          account_id: data.approver.id,
          role: data.approver.role,
          status: 'ACTIVE',
          joined_at: data.now,
          created_at: data.now,
        },
      ])
      .execute();
    await scoped
      .insertInto('requirements')
      .values({
        id: data.requirement.id,
        name: data.requirement.name,
        original_idea: data.requirement.originalIdea,
        initiator_id: data.requester.id,
        business_owner_id: data.approver.id,
        current_stage: data.requirement.currentStage,
        current_baseline_id: null,
        row_version: 0,
        draft_source_type: null,
        draft_source_description: null,
        draft_material_purpose: null,
        draft_sensitivity: null,
        created_at: data.now,
        updated_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('material_baselines')
      .values({
        id: data.baseline.id,
        requirement_id: data.requirement.id,
        version_number: data.baseline.versionNumber,
        status: 'CURRENT',
        source_type: data.baseline.sourceType,
        source_description: null,
        material_purpose: data.baseline.materialPurpose,
        sensitivity: data.baseline.sensitivity,
        confirmed_by: data.approver.id,
        confirmed_at: data.now,
        created_at: data.now,
      })
      .execute();
    await scoped
      .updateTable('requirements')
      .set({ current_baseline_id: data.baseline.id })
      .where('id', '=', data.requirement.id)
      .executeTakeFirstOrThrow();
    await scoped
      .insertInto('requirement_assignments')
      .values([
        {
          requirement_id: data.requirement.id,
          team_id: data.team.id,
          account_id: data.requester.id,
          responsibility: data.assignment.responsibility,
          status: data.assignment.status,
          created_at: data.now,
          updated_at: data.now,
        },
        {
          requirement_id: data.requirement.id,
          team_id: data.team.id,
          account_id: data.approver.id,
          responsibility: 'APPROVAL_OWNER',
          status: data.assignment.status,
          created_at: data.now,
          updated_at: data.now,
        },
      ])
      .execute();
    await scoped
      .insertInto('workspaces')
      .values({
        id: data.workspace.id,
        team_id: data.team.id,
        name: data.workspace.name,
        repository_label: data.workspace.repositoryLabel,
        repository_fingerprint: data.workspace.repositoryFingerprint,
        status: data.workspace.status,
        verification_status: data.workspace.verificationStatus,
        row_version: 0,
        created_at: data.now,
        updated_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('requirement_workspaces')
      .values({
        requirement_id: data.requirement.id,
        team_id: data.team.id,
        workspace_id: data.workspace.id,
        allowed_relative_path: data.workspace.allowedRelativePath,
        access_level: data.workspace.accessLevel,
        created_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('artifacts')
      .values({
        id: data.artifact.id,
        requirement_id: data.requirement.id,
        cap_id: data.artifact.capId,
        stage: data.artifact.stage,
        artifact_type: data.artifact.artifactType,
        title: data.artifact.title,
        status: data.artifact.status,
        current_version_id: null,
        row_version: 0,
        created_at: data.now,
        updated_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('artifact_versions')
      .values({
        id: data.artifact.versionId,
        artifact_id: data.artifact.id,
        version_label: data.artifact.versionLabel,
        source_type: data.artifact.sourceType,
        source_ref: data.artifact.sourceRef,
        content_hash: data.artifact.contentHash,
        sensitivity: data.artifact.sensitivity,
        created_by: data.requester.id,
        created_at: data.now,
      })
      .execute();
    await scoped
      .updateTable('artifacts')
      .set({ current_version_id: data.artifact.versionId })
      .where('id', '=', data.artifact.id)
      .executeTakeFirstOrThrow();
    await scoped
      .insertInto('timeline_events')
      .values({
        id: data.evidence.timelineId,
        requirement_id: data.requirement.id,
        aggregate_type: 'requirement',
        aggregate_id: data.requirement.id,
        event_type: 'm2-r2-local-acceptance.prepared',
        actor_id: data.requester.id,
        before_summary: null,
        after_summary: {
          baselineId: data.baseline.id,
          workspaceId: data.workspace.id,
          skillReleaseId: input.skillReleaseId,
          actorCount: 2,
        },
        aggregate_version: 0,
        occurred_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('outbox_events')
      .values({
        id: data.evidence.outboxId,
        event_type: 'm2-r2-local-acceptance.prepared',
        aggregate_type: 'requirement',
        aggregate_id: data.requirement.id,
        aggregate_version: 0,
        payload_summary: { runId: data.runId, actorCount: 2 },
        status: 'PENDING',
        occurred_at: data.now,
        published_at: null,
      })
      .execute();
    await scoped
      .insertInto('audit_events')
      .values({
        id: data.evidence.auditId,
        actor_id: data.requester.id,
        action: 'm2-r2-local-acceptance.prepared',
        target_type: 'requirement',
        target_id: data.requirement.id,
        decision: 'ALLOW',
        reason: 'User-confirmed local M2-R2 acceptance package.',
        scope_summary: {
          database: 'pfc_local',
          schema: 'pfc',
          accessMode: 'WORKSPACE_WRITE',
          fourEyes: true,
        },
        request_id: data.evidence.requestId,
        occurred_at: data.now,
      })
      .execute();
  });

  const [requirement, memberships] = await Promise.all([
    db
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
      .innerJoin('artifacts', 'artifacts.requirement_id', 'requirements.id')
      .select([
        'requirements.id as requirement_id',
        'material_baselines.id as baseline_id',
        'workspaces.id as workspace_id',
        'workspaces.verification_status',
        'artifacts.current_version_id',
      ])
      .where('requirements.id', '=', data.requirement.id)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('team_memberships')
      .select(['account_id', 'role'])
      .where('team_id', '=', data.team.id)
      .where('status', '=', 'ACTIVE')
      .orderBy('account_id')
      .execute(),
  ]);
  if (
    requirement.baseline_id !== data.baseline.id ||
    requirement.workspace_id !== data.workspace.id ||
    requirement.verification_status !== 'UNVERIFIED' ||
    requirement.current_version_id !== data.artifact.versionId ||
    memberships.length !== 2
  ) {
    throw new Error('M2_R2_ACCEPTANCE_READBACK_MISMATCH');
  }
  return { requirement, memberships };
}
