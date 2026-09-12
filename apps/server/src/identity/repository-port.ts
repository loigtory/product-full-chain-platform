import type {
  ActorRole,
  MutationEvidence,
  MutationPersistenceResult,
  OperationEvidence,
  TeamSummaryDto,
} from '@pfc/contracts';

export type IdentityAccountRecord = Readonly<{
  id: string;
  loginName: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  status: 'ACTIVE' | 'DISABLED';
  rowVersion: number;
}>;

export type IdentitySessionActorRecord = Readonly<{
  actorId: string;
  loginName: string;
  displayName: string;
  csrfTokenHash: string;
  teams: readonly TeamSummaryDto[];
}>;

export type IdentityInvitationRecord = Readonly<{
  id: string;
  teamId: string;
  loginName: string;
  role: ActorRole;
  expiresAt: string;
  acceptedAt: string | null;
}>;

export interface IdentityRepositoryPort {
  findAccountByLoginName(
    loginName: string,
  ): Promise<IdentityAccountRecord | null>;
  createSession(input: {
    id: string;
    accountId: string;
    tokenHash: string;
    csrfTokenHash: string;
    createdAt: string;
    expiresAt: string;
    evidence: OperationEvidence;
  }): Promise<void>;
  findActorBySession(input: {
    tokenHash: string;
    now: string;
  }): Promise<IdentitySessionActorRecord | null>;
  touchSession(tokenHash: string, now: string): Promise<void>;
  revokeSession(input: {
    tokenHash: string;
    now: string;
    evidence: OperationEvidence;
  }): Promise<boolean>;
  createInvitationAudited(input: {
    id: string;
    teamId: string;
    loginName: string;
    role: ActorRole;
    tokenHash: string;
    expiresAt: string;
    invitedBy: string;
    createdAt: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<IdentityInvitationRecord>>;
  findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<IdentityInvitationRecord | null>;
  acceptInvitation(input: {
    invitationId: string;
    accountId: string;
    loginName: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
    teamId: string;
    role: ActorRole;
    now: string;
    evidence: OperationEvidence;
  }): Promise<void>;
}
