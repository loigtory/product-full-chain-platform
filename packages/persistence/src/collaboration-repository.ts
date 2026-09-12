import type {
  ActorRole,
  MutationEvidence,
  MutationPersistenceResult,
  RequirementAssignmentDto,
  RequirementWorkspaceDto,
  TeamDto,
  TeamMemberDto,
  WorkspaceAccessLevel,
  WorkspaceDto,
} from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';
import { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';

type ScopedDatabase = ReturnType<LifecycleKysely['withSchema']>;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapTeam(row: {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  owner_account_id: string;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}): TeamDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    ownerAccountId: row.owner_account_id,
    rowVersion: row.row_version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function mapWorkspace(row: {
  id: string;
  team_id: string;
  name: string;
  repository_label: string;
  repository_fingerprint: string;
  status: 'ACTIVE' | 'ARCHIVED';
  verification_status: 'UNVERIFIED' | 'VERIFIED' | 'FAILED';
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}): WorkspaceDto {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    repositoryLabel: row.repository_label,
    repositoryFingerprint: row.repository_fingerprint,
    status: row.status,
    verificationStatus: row.verification_status,
    rowVersion: row.row_version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export class PostgresCollaborationRepository {
  private readonly db: ScopedDatabase;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async createTeamWithOwner(input: {
    id: string;
    name: string;
    ownerAccountId: string;
    now: string;
  }): Promise<TeamDto> {
    return this.db.transaction().execute(async (transaction) => {
      const team = await transaction
        .insertInto('teams')
        .values({
          id: input.id,
          name: input.name.trim(),
          status: 'ACTIVE',
          owner_account_id: input.ownerAccountId,
          row_version: 0,
          created_at: input.now,
          updated_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('team_memberships')
        .values({
          team_id: input.id,
          account_id: input.ownerAccountId,
          role: 'TEAM_ADMIN',
          status: 'ACTIVE',
          joined_at: input.now,
          created_at: input.now,
        })
        .execute();
      return mapTeam(team);
    });
  }

  async createTeamWithOwnerAudited(input: {
    id: string;
    name: string;
    ownerAccountId: string;
    now: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<TeamDto>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.mutation);
      if (claim.status !== 'NEW') {
        const existing = claim.resultReference
          ? await transaction
              .selectFrom('teams')
              .selectAll()
              .where('id', '=', claim.resultReference)
              .executeTakeFirst()
          : undefined;
        return {
          status: claim.status,
          value: existing ? mapTeam(existing) : null,
        };
      }
      const team = await transaction
        .insertInto('teams')
        .values({
          id: input.id,
          name: input.name.trim(),
          status: 'ACTIVE',
          owner_account_id: input.ownerAccountId,
          row_version: 0,
          created_at: input.now,
          updated_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('team_memberships')
        .values({
          team_id: input.id,
          account_id: input.ownerAccountId,
          role: 'TEAM_ADMIN',
          status: 'ACTIVE',
          joined_at: input.now,
          created_at: input.now,
        })
        .execute();
      await appendMutationEvidence(transaction, input.mutation);
      return { status: 'CREATED', value: mapTeam(team) };
    });
  }

  async listTeamsForAccount(accountId: string): Promise<readonly TeamDto[]> {
    const rows = await this.db
      .selectFrom('teams')
      .innerJoin('team_memberships', 'team_memberships.team_id', 'teams.id')
      .selectAll('teams')
      .where('team_memberships.account_id', '=', accountId)
      .where('team_memberships.status', '=', 'ACTIVE')
      .orderBy('teams.name')
      .execute();
    return rows.map(mapTeam);
  }

  async findMembership(input: { teamId: string; accountId: string }): Promise<{
    role: ActorRole;
    status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  } | null> {
    return (
      (await this.db
        .selectFrom('team_memberships')
        .select(['role', 'status'])
        .where('team_id', '=', input.teamId)
        .where('account_id', '=', input.accountId)
        .executeTakeFirst()) ?? null
    );
  }

  async listTeamMembers(teamId: string): Promise<readonly TeamMemberDto[]> {
    const rows = await this.db
      .selectFrom('team_memberships')
      .innerJoin('accounts', 'accounts.id', 'team_memberships.account_id')
      .select([
        'accounts.id as account_id',
        'accounts.login_name',
        'accounts.display_name',
        'team_memberships.role',
        'team_memberships.status',
        'team_memberships.joined_at',
      ])
      .where('team_memberships.team_id', '=', teamId)
      .orderBy('accounts.display_name')
      .execute();
    return rows.map((row) => ({
      accountId: row.account_id,
      loginName: row.login_name,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      joinedAt: row.joined_at ? timestamp(row.joined_at) : null,
    }));
  }

  async assignRequirement(input: {
    requirementId: string;
    teamId: string;
    accountId: string;
    responsibility: string;
    now: string;
  }): Promise<RequirementAssignmentDto> {
    const row = await this.db
      .insertInto('requirement_assignments')
      .values({
        requirement_id: input.requirementId,
        team_id: input.teamId,
        account_id: input.accountId,
        responsibility: input.responsibility.trim(),
        status: 'ACTIVE',
        created_at: input.now,
        updated_at: input.now,
      })
      .onConflict((conflict) =>
        conflict
          .columns(['requirement_id', 'account_id', 'responsibility'])
          .doUpdateSet({
            team_id: input.teamId,
            status: 'ACTIVE',
            updated_at: input.now,
          }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return {
      requirementId: row.requirement_id,
      teamId: row.team_id,
      accountId: row.account_id,
      responsibility: row.responsibility,
      status: row.status,
    };
  }

  async assignRequirementAudited(input: {
    requirementId: string;
    teamId: string;
    accountId: string;
    responsibility: string;
    now: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<RequirementAssignmentDto>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.mutation);
      if (claim.status !== 'NEW') {
        const existing = await transaction
          .selectFrom('requirement_assignments')
          .selectAll()
          .where('requirement_id', '=', input.requirementId)
          .where('account_id', '=', input.accountId)
          .where('responsibility', '=', input.responsibility.trim())
          .executeTakeFirst();
        return {
          status: claim.status,
          value: existing
            ? {
                requirementId: existing.requirement_id,
                teamId: existing.team_id,
                accountId: existing.account_id,
                responsibility: existing.responsibility,
                status: existing.status,
              }
            : null,
        };
      }
      const row = await transaction
        .insertInto('requirement_assignments')
        .values({
          requirement_id: input.requirementId,
          team_id: input.teamId,
          account_id: input.accountId,
          responsibility: input.responsibility.trim(),
          status: 'ACTIVE',
          created_at: input.now,
          updated_at: input.now,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['requirement_id', 'account_id', 'responsibility'])
            .doUpdateSet({
              team_id: input.teamId,
              status: 'ACTIVE',
              updated_at: input.now,
            }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.mutation);
      return {
        status: 'CREATED',
        value: {
          requirementId: row.requirement_id,
          teamId: row.team_id,
          accountId: row.account_id,
          responsibility: row.responsibility,
          status: row.status,
        },
      };
    });
  }

  async createWorkspace(input: {
    id: string;
    teamId: string;
    name: string;
    repositoryLabel: string;
    repositoryFingerprint: string;
    now: string;
  }): Promise<WorkspaceDto> {
    const row = await this.db
      .insertInto('workspaces')
      .values({
        id: input.id,
        team_id: input.teamId,
        name: input.name.trim(),
        repository_label: input.repositoryLabel.trim(),
        repository_fingerprint: input.repositoryFingerprint.trim(),
        status: 'ACTIVE',
        verification_status: 'UNVERIFIED',
        row_version: 0,
        created_at: input.now,
        updated_at: input.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapWorkspace(row);
  }

  async createWorkspaceAudited(input: {
    id: string;
    teamId: string;
    name: string;
    repositoryLabel: string;
    repositoryFingerprint: string;
    now: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<WorkspaceDto>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.mutation);
      if (claim.status !== 'NEW') {
        const existing = claim.resultReference
          ? await transaction
              .selectFrom('workspaces')
              .selectAll()
              .where('id', '=', claim.resultReference)
              .executeTakeFirst()
          : undefined;
        return {
          status: claim.status,
          value: existing ? mapWorkspace(existing) : null,
        };
      }
      const row = await transaction
        .insertInto('workspaces')
        .values({
          id: input.id,
          team_id: input.teamId,
          name: input.name.trim(),
          repository_label: input.repositoryLabel.trim(),
          repository_fingerprint: input.repositoryFingerprint.trim(),
          status: 'ACTIVE',
          verification_status: 'UNVERIFIED',
          row_version: 0,
          created_at: input.now,
          updated_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.mutation);
      return { status: 'CREATED', value: mapWorkspace(row) };
    });
  }

  async listWorkspaces(
    teamIds: readonly string[],
  ): Promise<readonly WorkspaceDto[]> {
    if (teamIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('workspaces')
      .selectAll()
      .where('team_id', 'in', teamIds)
      .where('status', '=', 'ACTIVE')
      .orderBy('name')
      .execute();
    return rows.map(mapWorkspace);
  }

  async bindRequirementWorkspace(input: {
    requirementId: string;
    teamId: string;
    workspaceId: string;
    allowedRelativePath: string;
    accessLevel: WorkspaceAccessLevel;
    now: string;
  }): Promise<RequirementWorkspaceDto> {
    const row = await this.db
      .insertInto('requirement_workspaces')
      .values({
        requirement_id: input.requirementId,
        team_id: input.teamId,
        workspace_id: input.workspaceId,
        allowed_relative_path: input.allowedRelativePath,
        access_level: input.accessLevel,
        created_at: input.now,
      })
      .onConflict((conflict) =>
        conflict.columns(['requirement_id', 'workspace_id']).doUpdateSet({
          team_id: input.teamId,
          allowed_relative_path: input.allowedRelativePath,
          access_level: input.accessLevel,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return {
      requirementId: row.requirement_id,
      workspaceId: row.workspace_id,
      allowedRelativePath: row.allowed_relative_path,
      accessLevel: row.access_level,
    };
  }

  async bindRequirementWorkspaceAudited(input: {
    requirementId: string;
    teamId: string;
    workspaceId: string;
    allowedRelativePath: string;
    accessLevel: WorkspaceAccessLevel;
    now: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<RequirementWorkspaceDto>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.mutation);
      if (claim.status !== 'NEW') {
        const existing = await transaction
          .selectFrom('requirement_workspaces')
          .selectAll()
          .where('requirement_id', '=', input.requirementId)
          .where('workspace_id', '=', input.workspaceId)
          .executeTakeFirst();
        return {
          status: claim.status,
          value: existing
            ? {
                requirementId: existing.requirement_id,
                workspaceId: existing.workspace_id,
                allowedRelativePath: existing.allowed_relative_path,
                accessLevel: existing.access_level,
              }
            : null,
        };
      }
      const row = await transaction
        .insertInto('requirement_workspaces')
        .values({
          requirement_id: input.requirementId,
          team_id: input.teamId,
          workspace_id: input.workspaceId,
          allowed_relative_path: input.allowedRelativePath,
          access_level: input.accessLevel,
          created_at: input.now,
        })
        .onConflict((conflict) =>
          conflict.columns(['requirement_id', 'workspace_id']).doUpdateSet({
            team_id: input.teamId,
            allowed_relative_path: input.allowedRelativePath,
            access_level: input.accessLevel,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.mutation);
      return {
        status: 'CREATED',
        value: {
          requirementId: row.requirement_id,
          workspaceId: row.workspace_id,
          allowedRelativePath: row.allowed_relative_path,
          accessLevel: row.access_level,
        },
      };
    });
  }
}
