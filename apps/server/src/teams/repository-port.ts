import type {
  ActorRole,
  MutationEvidence,
  MutationPersistenceResult,
  RequirementAssignmentDto,
  TeamDto,
  TeamMemberDto,
} from '@pfc/contracts';

export interface TeamRepositoryPort {
  createTeamWithOwnerAudited(input: {
    id: string;
    name: string;
    ownerAccountId: string;
    now: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<TeamDto>>;
  listTeamsForAccount(accountId: string): Promise<readonly TeamDto[]>;
  findMembership(input: { teamId: string; accountId: string }): Promise<{
    role: ActorRole;
    status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  } | null>;
  listTeamMembers(teamId: string): Promise<readonly TeamMemberDto[]>;
  assignRequirementAudited(input: {
    requirementId: string;
    teamId: string;
    accountId: string;
    responsibility: string;
    now: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<RequirementAssignmentDto>>;
}
