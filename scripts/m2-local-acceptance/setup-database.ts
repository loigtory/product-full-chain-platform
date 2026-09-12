import type { PasswordDerivation } from '../../apps/server/src/identity/security.ts';
import type { createM2LocalAcceptanceData } from '../../packages/test-data/src/index.ts';
import type { LifecycleKysely } from '../../packages/persistence/src/index.ts';

type AcceptanceData = ReturnType<typeof createM2LocalAcceptanceData>;

export async function seedM2LocalAcceptanceDatabase(input: {
  database: LifecycleKysely;
  data: AcceptanceData;
  password: PasswordDerivation;
  skillReleaseId: string;
}) {
  const { database, data } = input;
  const db = database.withSchema('pfc');

  await database.transaction().execute(async (transaction) => {
    const scoped = transaction.withSchema('pfc');
    const collisions = await Promise.all([
      scoped
        .selectFrom('accounts')
        .select('id')
        .where((expression) =>
          expression.or([
            expression('id', '=', data.account.id),
            expression('login_name', '=', data.account.loginName),
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
      throw new Error('M2_ACCEPTANCE_DATA_EXISTS');
    }

    await scoped
      .insertInto('accounts')
      .values({
        id: data.account.id,
        login_name: data.account.loginName,
        display_name: data.account.displayName,
        password_hash: input.password.hash,
        password_salt: input.password.salt,
        status: 'ACTIVE',
        row_version: 0,
        created_at: data.now,
        updated_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('teams')
      .values({
        id: data.team.id,
        name: data.team.name,
        status: 'ACTIVE',
        owner_account_id: data.account.id,
        row_version: 0,
        created_at: data.now,
        updated_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('team_memberships')
      .values({
        team_id: data.team.id,
        account_id: data.account.id,
        role: 'TEAM_ADMIN',
        status: 'ACTIVE',
        joined_at: data.now,
        created_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('requirements')
      .values({
        id: data.requirement.id,
        name: data.requirement.name,
        original_idea: data.requirement.originalIdea,
        initiator_id: data.account.id,
        business_owner_id: data.account.id,
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
        confirmed_by: data.account.id,
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
      .insertInto('requirement_assignments')
      .values({
        requirement_id: data.requirement.id,
        team_id: data.team.id,
        account_id: data.account.id,
        responsibility: data.assignment.responsibility,
        status: data.assignment.status,
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
        allowed_relative_path: data.requirementWorkspace.allowedRelativePath,
        access_level: data.requirementWorkspace.accessLevel,
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
        id: data.artifactVersion.id,
        artifact_id: data.artifact.id,
        version_label: data.artifactVersion.versionLabel,
        source_type: data.artifactVersion.sourceType,
        source_ref: data.artifactVersion.sourceRef,
        content_hash: data.artifactVersion.contentHash,
        sensitivity: data.artifactVersion.sensitivity,
        created_by: data.account.id,
        created_at: data.now,
      })
      .execute();
    await scoped
      .updateTable('artifacts')
      .set({ current_version_id: data.artifactVersion.id })
      .where('id', '=', data.artifact.id)
      .executeTakeFirstOrThrow();
    await scoped
      .insertInto('timeline_events')
      .values({
        id: data.evidence.timelineId,
        requirement_id: data.requirement.id,
        aggregate_type: 'requirement',
        aggregate_id: data.requirement.id,
        event_type: 'm2-local-acceptance.prepared',
        actor_id: data.account.id,
        before_summary: null,
        after_summary: {
          baselineId: data.baseline.id,
          workspaceId: data.workspace.id,
          skillReleaseId: input.skillReleaseId,
        },
        aggregate_version: 0,
        occurred_at: data.now,
      })
      .execute();
    await scoped
      .insertInto('outbox_events')
      .values({
        id: data.evidence.outboxId,
        event_type: 'm2-local-acceptance.prepared',
        aggregate_type: 'requirement',
        aggregate_id: data.requirement.id,
        aggregate_version: 0,
        payload_summary: { runId: data.runId },
        status: 'PENDING',
        occurred_at: data.now,
        published_at: null,
      })
      .execute();
    await scoped
      .insertInto('audit_events')
      .values({
        id: data.evidence.auditId,
        actor_id: data.account.id,
        action: 'm2-local-acceptance.prepared',
        target_type: 'requirement',
        target_id: data.requirement.id,
        decision: 'ALLOW',
        reason: 'User-confirmed local M2-R1 acceptance package.',
        scope_summary: {
          database: 'pfc_local',
          schema: 'pfc',
          accessMode: 'READ_ONLY',
        },
        request_id: data.evidence.requestId,
        occurred_at: data.now,
      })
      .execute();
  });

  const readback = await db
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
    .executeTakeFirstOrThrow();
  if (
    readback.baseline_id !== data.baseline.id ||
    readback.workspace_id !== data.workspace.id ||
    readback.verification_status !== 'UNVERIFIED' ||
    readback.current_version_id !== data.artifactVersion.id
  ) {
    throw new Error('M2_ACCEPTANCE_READBACK_MISMATCH');
  }
  return readback;
}
