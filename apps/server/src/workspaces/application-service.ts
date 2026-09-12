import { randomUUID } from 'node:crypto';

import type {
  ActorContext,
  RequirementWorkspaceDto,
  WorkspaceAccessLevel,
  WorkspaceDto,
} from '@pfc/contracts';
import {
  assertAllowedRelativePath,
  assertRepositoryFingerprint,
  DomainRuleViolation,
} from '@pfc/domain';

import { createMutationEvidence } from '../mutation-evidence.ts';
import type { WorkspaceRepositoryPort } from './repository-port.ts';

export class WorkspaceApplicationService {
  constructor(
    private readonly repository: WorkspaceRepositoryPort,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly idFactory: (prefix: string) => string = (prefix) =>
      `${prefix}-${randomUUID()}`,
  ) {}

  private async assertTeamAdmin(actor: ActorContext, teamId: string) {
    if (actor.authenticationStatus !== 'AUTHENTICATED') {
      throw new DomainRuleViolation(
        'AUTHENTICATION_REQUIRED',
        'Session required.',
      );
    }
    const membership = await this.repository.findMembership({
      teamId,
      accountId: actor.actorId,
    });
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      !['TEAM_ADMIN', 'PRODUCT_OWNER'].includes(membership.role)
    ) {
      throw new DomainRuleViolation(
        'PERMISSION_DENIED',
        'Workspace access denied.',
      );
    }
  }

  async list(actor: ActorContext): Promise<readonly WorkspaceDto[]> {
    if (actor.authenticationStatus !== 'AUTHENTICATED') {
      throw new DomainRuleViolation(
        'AUTHENTICATION_REQUIRED',
        'Session required.',
      );
    }
    return this.repository.listWorkspaces(actor.teamIds);
  }

  async create(input: {
    actor: ActorContext;
    teamId: string;
    name: string;
    repositoryLabel: string;
    repositoryFingerprint: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<{ replayed: boolean; value: WorkspaceDto }> {
    await this.assertTeamAdmin(input.actor, input.teamId);
    const values = [input.name, input.repositoryLabel].map((value) =>
      value.trim(),
    );
    if (values.some((value) => !value)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Workspace fields are required.',
      );
    }
    const repositoryFingerprint = assertRepositoryFingerprint(
      input.repositoryFingerprint,
    );
    const id = this.idFactory('workspace');
    const now = this.now();
    const result = await this.repository.createWorkspaceAudited({
      id,
      teamId: input.teamId,
      name: values[0]!,
      repositoryLabel: values[1]!,
      repositoryFingerprint,
      now,
      mutation: createMutationEvidence({
        actorId: input.actor.actorId,
        route: '/api/v1/workspaces',
        idempotencyKey: input.idempotencyKey,
        request: {
          teamId: input.teamId,
          name: values[0],
          repositoryLabel: values[1],
          repositoryFingerprint,
        },
        requestId: input.requestId,
        eventType: 'workspace.created',
        aggregateType: 'workspace',
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
        'Workspace result is unknown.',
      );
    }
    return { replayed: result.status === 'REPLAYED', value: result.value };
  }

  async bind(input: {
    actor: ActorContext;
    requirementId: string;
    teamId: string;
    workspaceId: string;
    allowedRelativePath: string;
    accessLevel: WorkspaceAccessLevel;
    idempotencyKey: string;
    requestId: string;
  }): Promise<{ replayed: boolean; value: RequirementWorkspaceDto }> {
    await this.assertTeamAdmin(input.actor, input.teamId);
    const allowedRelativePath = assertAllowedRelativePath(
      input.allowedRelativePath,
    );
    const now = this.now();
    const aggregateId = this.idFactory('requirement-workspace');
    const result = await this.repository.bindRequirementWorkspaceAudited({
      requirementId: input.requirementId,
      teamId: input.teamId,
      workspaceId: input.workspaceId,
      allowedRelativePath,
      accessLevel: input.accessLevel,
      now,
      mutation: createMutationEvidence({
        actorId: input.actor.actorId,
        route: `/api/v1/requirements/${input.requirementId}/workspaces/${input.workspaceId}`,
        idempotencyKey: input.idempotencyKey,
        request: {
          teamId: input.teamId,
          allowedRelativePath,
          accessLevel: input.accessLevel,
        },
        requestId: input.requestId,
        eventType: 'requirement.workspace-bound',
        aggregateType: 'requirement-workspace',
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
        'Workspace binding result is unknown.',
      );
    }
    return { replayed: result.status === 'REPLAYED', value: result.value };
  }
}
