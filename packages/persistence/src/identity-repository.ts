import type {
  ActorRole,
  MutationEvidence,
  MutationPersistenceResult,
  OperationEvidence,
  TeamSummaryDto,
} from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';
import { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';

type ScopedDatabase = ReturnType<LifecycleKysely['withSchema']>;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export type AccountCredentialRecord = Readonly<{
  id: string;
  loginName: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  status: 'ACTIVE' | 'DISABLED';
  rowVersion: number;
}>;

export type SessionActorRecord = Readonly<{
  actorId: string;
  loginName: string;
  displayName: string;
  teams: readonly TeamSummaryDto[];
}>;

export type InvitationRecord = Readonly<{
  id: string;
  teamId: string;
  loginName: string;
  role: ActorRole;
  expiresAt: string;
  acceptedAt: string | null;
}>;

export class PostgresIdentityRepository {
  private readonly db: ScopedDatabase;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async countAccounts(): Promise<number> {
    const result = await this.db
      .selectFrom('accounts')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  async createAccount(input: {
    id: string;
    loginName: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
    now: string;
  }): Promise<void> {
    await this.db
      .insertInto('accounts')
      .values({
        id: input.id,
        login_name: input.loginName,
        display_name: input.displayName,
        password_hash: input.passwordHash,
        password_salt: input.passwordSalt,
        status: 'ACTIVE',
        row_version: 0,
        created_at: input.now,
        updated_at: input.now,
      })
      .execute();
  }

  async findAccountByLoginName(
    loginName: string,
  ): Promise<AccountCredentialRecord | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('login_name', '=', loginName)
      .executeTakeFirst();
    return row
      ? {
          id: row.id,
          loginName: row.login_name,
          displayName: row.display_name,
          passwordHash: row.password_hash,
          passwordSalt: row.password_salt,
          status: row.status,
          rowVersion: row.row_version,
        }
      : null;
  }

  async createSession(input: {
    id: string;
    accountId: string;
    tokenHash: string;
    csrfTokenHash: string;
    createdAt: string;
    expiresAt: string;
    evidence: OperationEvidence;
  }): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('sessions')
        .values({
          id: input.id,
          account_id: input.accountId,
          token_hash: input.tokenHash,
          csrf_token_hash: input.csrfTokenHash,
          expires_at: input.expiresAt,
          last_seen_at: input.createdAt,
          revoked_at: null,
          created_at: input.createdAt,
        })
        .execute();
      await appendMutationEvidence(transaction, input.evidence);
    });
  }

  async findActorBySession(input: {
    tokenHash: string;
    now: string;
  }): Promise<(SessionActorRecord & { csrfTokenHash: string }) | null> {
    const session = await this.db
      .selectFrom('sessions')
      .innerJoin('accounts', 'accounts.id', 'sessions.account_id')
      .select([
        'accounts.id as account_id',
        'accounts.login_name',
        'accounts.display_name',
        'sessions.csrf_token_hash',
      ])
      .where('sessions.token_hash', '=', input.tokenHash)
      .where('sessions.revoked_at', 'is', null)
      .where('sessions.expires_at', '>', new Date(input.now))
      .where('accounts.status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!session) return null;

    const memberships = await this.db
      .selectFrom('team_memberships')
      .innerJoin('teams', 'teams.id', 'team_memberships.team_id')
      .select([
        'teams.id',
        'teams.name',
        'teams.status',
        'team_memberships.role',
      ])
      .where('team_memberships.account_id', '=', session.account_id)
      .where('team_memberships.status', '=', 'ACTIVE')
      .where('teams.status', '=', 'ACTIVE')
      .orderBy('teams.name')
      .execute();

    return {
      actorId: session.account_id,
      loginName: session.login_name,
      displayName: session.display_name,
      csrfTokenHash: session.csrf_token_hash,
      teams: memberships.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        role: item.role,
      })),
    };
  }

  async touchSession(tokenHash: string, now: string): Promise<void> {
    await this.db
      .updateTable('sessions')
      .set({ last_seen_at: now })
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeSession(input: {
    tokenHash: string;
    now: string;
    evidence: OperationEvidence;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (transaction) => {
      const result = await transaction
        .updateTable('sessions')
        .set({ revoked_at: input.now })
        .where('token_hash', '=', input.tokenHash)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      const revoked = Number(result.numUpdatedRows) === 1;
      if (revoked) await appendMutationEvidence(transaction, input.evidence);
      return revoked;
    });
  }

  async createInvitationAudited(input: {
    id: string;
    teamId: string;
    loginName: string;
    role: ActorRole;
    tokenHash: string;
    expiresAt: string;
    invitedBy: string;
    createdAt: string;
    mutation: MutationEvidence;
  }): Promise<MutationPersistenceResult<InvitationRecord>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.mutation);
      if (claim.status !== 'NEW') {
        const existing = claim.resultReference
          ? await transaction
              .selectFrom('account_invitations')
              .selectAll()
              .where('id', '=', claim.resultReference)
              .executeTakeFirst()
          : undefined;
        return {
          status: claim.status,
          value: existing
            ? {
                id: existing.id,
                teamId: existing.team_id,
                loginName: existing.login_name,
                role: existing.role,
                expiresAt: timestamp(existing.expires_at),
                acceptedAt: existing.accepted_at
                  ? timestamp(existing.accepted_at)
                  : null,
              }
            : null,
        };
      }
      await transaction
        .insertInto('account_invitations')
        .values({
          id: input.id,
          team_id: input.teamId,
          login_name: input.loginName,
          role: input.role,
          token_hash: input.tokenHash,
          expires_at: input.expiresAt,
          accepted_at: null,
          invited_by: input.invitedBy,
          created_at: input.createdAt,
        })
        .execute();
      await appendMutationEvidence(transaction, input.mutation);
      return {
        status: 'CREATED',
        value: {
          id: input.id,
          teamId: input.teamId,
          loginName: input.loginName,
          role: input.role,
          expiresAt: input.expiresAt,
          acceptedAt: null,
        },
      };
    });
  }

  async findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<InvitationRecord | null> {
    const row = await this.db
      .selectFrom('account_invitations')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    return row
      ? {
          id: row.id,
          teamId: row.team_id,
          loginName: row.login_name,
          role: row.role,
          expiresAt: timestamp(row.expires_at),
          acceptedAt: row.accepted_at ? timestamp(row.accepted_at) : null,
        }
      : null;
  }

  async acceptInvitation(input: {
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
  }): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const claimed = await transaction
        .updateTable('account_invitations')
        .set({ accepted_at: input.now })
        .where('id', '=', input.invitationId)
        .where('accepted_at', 'is', null)
        .where('expires_at', '>', new Date(input.now))
        .executeTakeFirst();
      if (Number(claimed.numUpdatedRows) !== 1) {
        throw new Error('INVITATION_NOT_ACTIVE');
      }
      await transaction
        .insertInto('accounts')
        .values({
          id: input.accountId,
          login_name: input.loginName,
          display_name: input.displayName,
          password_hash: input.passwordHash,
          password_salt: input.passwordSalt,
          status: 'ACTIVE',
          row_version: 0,
          created_at: input.now,
          updated_at: input.now,
        })
        .execute();
      await transaction
        .insertInto('team_memberships')
        .values({
          team_id: input.teamId,
          account_id: input.accountId,
          role: input.role,
          status: 'ACTIVE',
          joined_at: input.now,
          created_at: input.now,
        })
        .execute();
      await appendMutationEvidence(transaction, input.evidence);
    });
  }
}
