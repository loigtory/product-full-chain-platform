import type { ActorRole } from './access.ts';
import type { ArtifactContentMediaType } from './artifact-collaboration.ts';
import type { LifecycleStage, SensitivityLevel } from './lifecycle.ts';

export const ACCOUNT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;
export const TEAM_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const WORKSPACE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const WORKSPACE_VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'VERIFIED',
  'FAILED',
] as const;
export const WORKSPACE_ACCESS_LEVELS = ['READ', 'WRITE'] as const;
export const ASSIGNMENT_STATUSES = ['ACTIVE', 'ENDED'] as const;
export const ARTIFACT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const ARTIFACT_SOURCE_TYPES = [
  'WORKSPACE_RELATIVE',
  'CONTROLLED_REFERENCE',
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export type TeamStatus = (typeof TEAM_STATUSES)[number];
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];
export type WorkspaceVerificationStatus =
  (typeof WORKSPACE_VERIFICATION_STATUSES)[number];
export type WorkspaceAccessLevel = (typeof WORKSPACE_ACCESS_LEVELS)[number];
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];
export type ArtifactSourceType = (typeof ARTIFACT_SOURCE_TYPES)[number];

export type CurrentActorDto = Readonly<{
  actorId: string;
  loginName: string;
  displayName: string;
  roles: readonly ActorRole[];
  teams: readonly TeamSummaryDto[];
  currentTeamId: string | null;
  csrfToken: string;
}>;

export type TeamSummaryDto = Readonly<{
  id: string;
  name: string;
  role: ActorRole;
  status: TeamStatus;
}>;

export type TeamDto = Readonly<{
  id: string;
  name: string;
  status: TeamStatus;
  ownerAccountId: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}>;

export type TeamMemberDto = Readonly<{
  accountId: string;
  loginName: string;
  displayName: string;
  role: ActorRole;
  status: MembershipStatus;
  joinedAt: string | null;
}>;

export type RequirementAssignmentDto = Readonly<{
  requirementId: string;
  teamId: string;
  accountId: string;
  responsibility: string;
  status: AssignmentStatus;
}>;

export type WorkspaceDto = Readonly<{
  id: string;
  teamId: string;
  name: string;
  repositoryLabel: string;
  repositoryFingerprint: string;
  status: WorkspaceStatus;
  verificationStatus: WorkspaceVerificationStatus;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}>;

export type RequirementWorkspaceDto = Readonly<{
  requirementId: string;
  workspaceId: string;
  allowedRelativePath: string;
  accessLevel: WorkspaceAccessLevel;
}>;

export type ArtifactVersionDto = Readonly<{
  id: string;
  artifactId: string;
  versionLabel: string;
  sourceType: ArtifactSourceType;
  sourceRef: string;
  contentHash: string;
  sensitivity: SensitivityLevel;
  createdBy: string;
  createdAt: string;
}>;

export type ArtifactDto = Readonly<{
  id: string;
  requirementId: string;
  capId: string;
  stage: LifecycleStage;
  artifactType: string;
  title: string;
  status: ArtifactStatus;
  currentVersionId: string;
  rowVersion: number;
  versions: readonly ArtifactVersionDto[];
  createdAt: string;
  updatedAt: string;
}>;

export type CreateSessionRequest = Readonly<{
  loginName: string;
  password: string;
}>;

export type CreateSessionResponse = Readonly<{
  actor: CurrentActorDto;
  expiresAt: string;
}>;

export type SessionStateDto =
  | Readonly<{ authenticated: false }>
  | Readonly<{ authenticated: true; actor: CurrentActorDto }>;

export type AcceptInvitationRequest = Readonly<{
  displayName: string;
  password: string;
}>;

export type CreateTeamRequest = Readonly<{ name: string }>;
export type CreateInvitationRequest = Readonly<{
  loginName: string;
  role: ActorRole;
}>;
export type CreateInvitationResponse = Readonly<{
  invitationId: string;
  invitationToken: string;
  expiresAt: string;
}>;
export type CreateWorkspaceRequest = Readonly<{
  teamId: string;
  name: string;
  repositoryLabel: string;
  repositoryFingerprint: string;
}>;
export type BindRequirementWorkspaceRequest = Readonly<{
  teamId: string;
  allowedRelativePath: string;
  accessLevel: WorkspaceAccessLevel;
}>;
export type AssignRequirementRequest = Readonly<{
  teamId: string;
  accountId: string;
  responsibility: string;
}>;
type ArtifactVersionWriteRequest = Readonly<{
  versionLabel: string;
  sourceType: ArtifactSourceType;
  sourceRef: string;
  sensitivity: SensitivityLevel;
  contentHash?: string;
  mediaType?: ArtifactContentMediaType;
  content?: string;
}>;

export type RegisterArtifactRequest = ArtifactVersionWriteRequest &
  Readonly<{
    capId: string;
    stage: LifecycleStage;
    artifactType: string;
    title: string;
  }>;
export type AppendArtifactVersionRequest = ArtifactVersionWriteRequest;

export type OperationEvidence = Readonly<{
  actorId: string;
  eventId: string;
  outboxId: string;
  auditId: string;
  requestId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  requirementId?: string;
  occurredAt: string;
}>;

export type MutationEvidence = OperationEvidence &
  Readonly<{
    route: string;
    idempotencyKey: string;
    requestHash: string;
    idempotencyId: string;
  }>;

export type MutationPersistenceResult<T> = Readonly<{
  status: 'CREATED' | 'REPLAYED' | 'CONFLICT';
  value: T | null;
}>;
