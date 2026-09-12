import type {
  ActorRole,
  CreateInvitationResponse,
  RequirementAssignmentDto,
  RequirementWorkspaceDto,
  TeamDto,
  TeamMemberDto,
  WorkspaceDto,
} from '@pfc/contracts';

import { createUiIdempotencyKey } from '../idempotency.ts';
import { platformRequest } from '../platform/api-client.ts';

const jsonHeaders = (action: string) => ({
  'Content-Type': 'application/json',
  'Idempotency-Key': createUiIdempotencyKey(action),
});

export const teamAdminApi = {
  listTeams: () => platformRequest<readonly TeamDto[]>('/api/v1/teams'),
  createTeam: (name: string) =>
    platformRequest<TeamDto>('/api/v1/teams', {
      method: 'POST',
      headers: jsonHeaders('CREATE_TEAM'),
      body: JSON.stringify({ name }),
    }),
  listMembers: (teamId: string) =>
    platformRequest<readonly TeamMemberDto[]>(
      `/api/v1/teams/${encodeURIComponent(teamId)}/members`,
    ),
  inviteMember: (teamId: string, loginName: string, role: ActorRole) =>
    platformRequest<CreateInvitationResponse>(
      `/api/v1/teams/${encodeURIComponent(teamId)}/members`,
      {
        method: 'POST',
        headers: jsonHeaders('INVITE_MEMBER'),
        body: JSON.stringify({ loginName, role }),
      },
    ),
  assignRequirement: (input: {
    requirementId: string;
    teamId: string;
    accountId: string;
    responsibility: string;
  }) =>
    platformRequest<RequirementAssignmentDto>(
      `/api/v1/requirements/${encodeURIComponent(input.requirementId)}/assignment`,
      {
        method: 'PUT',
        headers: jsonHeaders('ASSIGN_REQUIREMENT'),
        body: JSON.stringify(input),
      },
    ),
  listWorkspaces: () =>
    platformRequest<readonly WorkspaceDto[]>('/api/v1/workspaces'),
  createWorkspace: (input: {
    teamId: string;
    name: string;
    repositoryLabel: string;
    repositoryFingerprint: string;
  }) =>
    platformRequest<WorkspaceDto>('/api/v1/workspaces', {
      method: 'POST',
      headers: jsonHeaders('CREATE_WORKSPACE'),
      body: JSON.stringify(input),
    }),
  bindWorkspace: (input: {
    requirementId: string;
    teamId: string;
    workspaceId: string;
    allowedRelativePath: string;
    accessLevel: 'READ' | 'WRITE';
  }) =>
    platformRequest<RequirementWorkspaceDto>(
      `/api/v1/requirements/${encodeURIComponent(input.requirementId)}/workspaces/${encodeURIComponent(input.workspaceId)}`,
      {
        method: 'PUT',
        headers: jsonHeaders('BIND_WORKSPACE'),
        body: JSON.stringify({
          teamId: input.teamId,
          allowedRelativePath: input.allowedRelativePath,
          accessLevel: input.accessLevel,
        }),
      },
    ),
};
