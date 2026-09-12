import type {
  RequirementWorkspaceDto,
  MutationEvidence,
  MutationPersistenceResult,
  WorkspaceAccessLevel,
  WorkspaceDto,
} from '@pfc/contracts';

export interface WorkspaceRepositoryPort {
  findMembership(input: { teamId: string; accountId: string }): Promise<{
    role: string;
    status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  } | null>;
  createWorkspaceAudited(input: {
    id: string;
    teamId: string;
    name: string;
    repositoryLabel: string;
    repositoryFingerprint: string;
    now: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<WorkspaceDto>>;
  listWorkspaces(teamIds: readonly string[]): Promise<readonly WorkspaceDto[]>;
  bindRequirementWorkspaceAudited(input: {
    requirementId: string;
    teamId: string;
    workspaceId: string;
    allowedRelativePath: string;
    accessLevel: WorkspaceAccessLevel;
    now: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<RequirementWorkspaceDto>>;
}
