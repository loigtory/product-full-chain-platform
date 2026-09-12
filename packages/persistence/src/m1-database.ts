import type { ColumnType } from 'kysely';

import type {
  AccountStatus,
  ActorRole,
  ArtifactSourceType,
  ArtifactStatus,
  AssignmentStatus,
  LifecycleStage,
  MembershipStatus,
  SensitivityLevel,
  TeamStatus,
  WorkspaceAccessLevel,
  WorkspaceStatus,
  WorkspaceVerificationStatus,
} from '@pfc/contracts';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface AccountTable {
  id: string;
  login_name: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  status: AccountStatus;
  row_version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AccountInvitationTable {
  id: string;
  team_id: string;
  login_name: string;
  role: ActorRole;
  token_hash: string;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  invited_by: string;
  created_at: Timestamp;
}

export interface SessionTable {
  id: string;
  account_id: string;
  token_hash: string;
  csrf_token_hash: string;
  expires_at: Timestamp;
  last_seen_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
}

export interface TeamTable {
  id: string;
  name: string;
  status: TeamStatus;
  owner_account_id: string;
  row_version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TeamMembershipTable {
  team_id: string;
  account_id: string;
  role: ActorRole;
  status: MembershipStatus;
  joined_at: Timestamp | null;
  created_at: Timestamp;
}

export interface RequirementAssignmentTable {
  requirement_id: string;
  team_id: string;
  account_id: string;
  responsibility: string;
  status: AssignmentStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WorkspaceTable {
  id: string;
  team_id: string;
  name: string;
  repository_label: string;
  repository_fingerprint: string;
  status: WorkspaceStatus;
  verification_status: WorkspaceVerificationStatus;
  row_version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RequirementWorkspaceTable {
  requirement_id: string;
  team_id: string;
  workspace_id: string;
  allowed_relative_path: string;
  access_level: WorkspaceAccessLevel;
  created_at: Timestamp;
}

export interface ArtifactTable {
  id: string;
  requirement_id: string;
  cap_id: string;
  stage: LifecycleStage;
  artifact_type: string;
  title: string;
  status: ArtifactStatus;
  current_version_id: string | null;
  row_version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ArtifactVersionTable {
  id: string;
  artifact_id: string;
  version_label: string;
  source_type: ArtifactSourceType;
  source_ref: string;
  content_hash: string;
  sensitivity: SensitivityLevel;
  created_by: string;
  created_at: Timestamp;
}

export interface M1DatabaseTables {
  accounts: AccountTable;
  account_invitations: AccountInvitationTable;
  sessions: SessionTable;
  teams: TeamTable;
  team_memberships: TeamMembershipTable;
  requirement_assignments: RequirementAssignmentTable;
  workspaces: WorkspaceTable;
  requirement_workspaces: RequirementWorkspaceTable;
  artifacts: ArtifactTable;
  artifact_versions: ArtifactVersionTable;
}
