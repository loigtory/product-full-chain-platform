import { randomUUID } from 'node:crypto';

import type {
  ActorContext,
  ActorRole,
  CreateInvitationResponse,
  RequirementAssignmentDto,
  TeamDto,
  TeamMemberDto,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';

import type { IdentityApplicationService } from '../identity/application-service.ts';
import { createMutationEvidence } from '../mutation-evidence.ts';
import type { TeamRepositoryPort } from './repository-port.ts';

function assertAuthenticated(actor: ActorContext): void {
  if (actor.authenticationStatus !== 'AUTHENTICATED') {
    throw new DomainRuleViolation(
      'AUTHENTICATION_REQUIRED',
      'Session required.',
    );
  }
}

export class TeamApplicationService {
  constructor(
    private readonly repository: TeamRepositoryPort,
    private readonly identity: IdentityApplicationService,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly idFactory: (prefix: string) => string = (prefix) =>
      `${prefix}-${randomUUID()}`,
  ) {}

  private async assertTeamRole(
    actor: ActorContext,
    teamId: string,
    roles: readonly ActorRole[],
  ): Promise<void> {
    assertAuthenticated(actor);
    const membership = await this.repository.findMembership({
      teamId,
      accountId: actor.actorId,
    });
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      !roles.includes(membership.role)
    ) {
      throw new DomainRuleViolation('PERMISSION_DENIED', 'Team access denied.');
    }
  }

  async createTeam(
    actor: ActorContext,
    name: string,
    idempotencyKey: string,
    requestId: string,
  ): Promise<{ replayed: boolean; value: TeamDto }> {
    assertAuthenticated(actor);
    if (!actor.roles.includes('TEAM_ADMIN')) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Team creation denied.',
      );
    }
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 160) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Team name is invalid.',
      );
    }
    const id = this.idFactory('team');
    const now = this.now();
    const result = await this.repository.createTeamWithOwnerAudited({
      id,
      name: normalizedName,
      ownerAccountId: actor.actorId,
      now,
      mutation: createMutationEvidence({
        actorId: actor.actorId,
        route: '/api/v1/teams',
        idempotencyKey,
        request: { name: normalizedName },
        requestId,
        eventType: 'team.created',
        aggregateType: 'team',
        aggregateId: id,
        aggregateVersion: 0,
        occurredAt: now,
        idFactory: this.idFactory,
      }),
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency conflict.',
      );
    }
    if (!result.value) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Team result is unknown.',
      );
    }
    return { replayed: result.status === 'REPLAYED', value: result.value };
  }

  async listTeams(actor: ActorContext): Promise<readonly TeamDto[]> {
    assertAuthenticated(actor);
    return this.repository.listTeamsForAccount(actor.actorId);
  }

  async listMembers(
    actor: ActorContext,
    teamId: string,
  ): Promise<readonly TeamMemberDto[]> {
    await this.assertTeamRole(actor, teamId, ['TEAM_ADMIN', 'PRODUCT_OWNER']);
    return this.repository.listTeamMembers(teamId);
  }

  async inviteMember(input: {
    actor: ActorContext;
    teamId: string;
    loginName: string;
    role: ActorRole;
    idempotencyKey: string;
    requestId: string;
  }): Promise<CreateInvitationResponse> {
    await this.assertTeamRole(input.actor, input.teamId, ['TEAM_ADMIN']);
    return this.identity.createInvitation(input);
  }

  async assignRequirement(input: {
    actor: ActorContext;
    requirementId: string;
    teamId: string;
    accountId: string;
    responsibility: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<{ replayed: boolean; value: RequirementAssignmentDto }> {
    await this.assertTeamRole(input.actor, input.teamId, [
      'TEAM_ADMIN',
      'PRODUCT_OWNER',
    ]);
    const responsibility = input.responsibility.trim();
    if (!responsibility || responsibility.length > 120) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Responsibility is invalid.',
      );
    }
    const now = this.now();
    const aggregateId = this.idFactory('assignment');
    const result = await this.repository.assignRequirementAudited({
      requirementId: input.requirementId,
      teamId: input.teamId,
      accountId: input.accountId,
      responsibility,
      now,
      mutation: createMutationEvidence({
        actorId: input.actor.actorId,
        route: `/api/v1/requirements/${input.requirementId}/assignment`,
        idempotencyKey: input.idempotencyKey,
        request: {
          teamId: input.teamId,
          accountId: input.accountId,
          responsibility,
        },
        requestId: input.requestId,
        eventType: 'requirement.assignment-upserted',
        aggregateType: 'requirement-assignment',
        aggregateId,
        aggregateVersion: 0,
        requirementId: input.requirementId,
        occurredAt: now,
        idFactory: this.idFactory,
      }),
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency conflict.',
      );
    }
    if (!result.value) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Assignment result is unknown.',
      );
    }
    return { replayed: result.status === 'REPLAYED', value: result.value };
  }
}
