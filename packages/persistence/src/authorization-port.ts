import type {
  ActorRole,
  AuthorizationLookup,
  AuthorizationPort,
  RequirementAction,
  RequirementAuthorizationSnapshot,
} from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';
import { PostgresScopedAuthorizationRepository } from './scoped-authorization-repository.ts';

export const WORK_SESSION_ROLE_ACTIONS: Readonly<
  Record<ActorRole, readonly RequirementAction[]>
> = {
  TEAM_ADMIN: [
    'VIEW_REQUIREMENT',
    'CREATE_REQUIREMENT',
    'COMPLETE_G0_REGISTRATION',
    'ASSESS_MATERIAL_IMPACT',
    'ANSWER_QUESTION',
    'CONFIRM_QUESTION',
    'RUN_GATE',
    'REGISTER_MANUAL_GATE',
    'CONFIRM_MATERIAL_IMPACT',
    'VIEW_MATERIAL',
    'VIEW_ARTIFACT',
    'REGISTER_ARTIFACT',
    'APPEND_ARTIFACT_VERSION',
    'REVIEW_ARTIFACT',
    'MANAGE_TRACEABILITY',
    'RUN_AGENT',
    'RUN_AGENT_WRITE',
    'VIEW_AGENT_RUN',
    'APPROVE_AGENT_ACTION',
    'CANCEL_AGENT_RUN',
    'VERIFY_AGENT_RUN',
    'VIEW_AGENT_AUDIT',
    'REVOKE_BRIDGE',
    'VIEW_WORK_SESSION',
    'CONTROL_WORK_SESSION',
    'GRANT_MATERIAL_TRANSMISSION',
    'READ_MCP',
  ],
  PRODUCT_MANAGER: [
    'VIEW_REQUIREMENT',
    'CREATE_REQUIREMENT',
    'COMPLETE_G0_REGISTRATION',
    'ASSESS_MATERIAL_IMPACT',
    'ANSWER_QUESTION',
    'CONFIRM_QUESTION',
    'RUN_GATE',
    'REGISTER_MANUAL_GATE',
    'VIEW_MATERIAL',
    'VIEW_ARTIFACT',
    'REGISTER_ARTIFACT',
    'APPEND_ARTIFACT_VERSION',
    'REVIEW_ARTIFACT',
    'MANAGE_TRACEABILITY',
    'RUN_AGENT',
    'RUN_AGENT_WRITE',
    'VIEW_AGENT_RUN',
    'CANCEL_AGENT_RUN',
    'TRANSMIT_MATERIAL',
    'VIEW_WORK_SESSION',
    'CREATE_WORK_SESSION',
    'SUBMIT_WORK_TURN',
    'DECIDE_ACTION_PROPOSAL',
    'CONTROL_WORK_SESSION',
    'READ_MCP',
  ],
  PRODUCT_OWNER: [
    'VIEW_REQUIREMENT',
    'COMPLETE_G0_REGISTRATION',
    'ASSESS_MATERIAL_IMPACT',
    'ANSWER_QUESTION',
    'CONFIRM_QUESTION',
    'RUN_GATE',
    'REGISTER_MANUAL_GATE',
    'CONFIRM_MATERIAL_IMPACT',
    'VIEW_MATERIAL',
    'VIEW_ARTIFACT',
    'REGISTER_ARTIFACT',
    'APPEND_ARTIFACT_VERSION',
    'REVIEW_ARTIFACT',
    'MANAGE_TRACEABILITY',
    'RUN_AGENT',
    'RUN_AGENT_WRITE',
    'VIEW_AGENT_RUN',
    'APPROVE_AGENT_ACTION',
    'CANCEL_AGENT_RUN',
    'VIEW_AGENT_AUDIT',
    'TRANSMIT_MATERIAL',
    'VIEW_WORK_SESSION',
    'CREATE_WORK_SESSION',
    'SUBMIT_WORK_TURN',
    'DECIDE_ACTION_PROPOSAL',
    'CONTROL_WORK_SESSION',
    'GRANT_MATERIAL_TRANSMISSION',
    'READ_MCP',
  ],
  BUSINESS_OWNER: [
    'VIEW_REQUIREMENT',
    'ANSWER_QUESTION',
    'CONFIRM_QUESTION',
    'CONFIRM_MATERIAL_IMPACT',
    'VIEW_MATERIAL',
    'VIEW_ARTIFACT',
    'REVIEW_ARTIFACT',
    'VIEW_AGENT_RUN',
    'TRANSMIT_MATERIAL',
    'VIEW_WORK_SESSION',
    'SUBMIT_WORK_TURN',
  ],
  ENGINEERING_OWNER: [
    'VIEW_REQUIREMENT',
    'ANSWER_QUESTION',
    'RUN_GATE',
    'VIEW_MATERIAL',
    'VIEW_ARTIFACT',
    'REVIEW_ARTIFACT',
    'MANAGE_TRACEABILITY',
    'RUN_AGENT',
    'RUN_AGENT_WRITE',
    'VIEW_AGENT_RUN',
    'APPROVE_AGENT_ACTION',
    'CANCEL_AGENT_RUN',
    'VERIFY_AGENT_RUN',
    'VIEW_AGENT_AUDIT',
    'TRANSMIT_MATERIAL',
    'VIEW_WORK_SESSION',
    'CREATE_WORK_SESSION',
    'SUBMIT_WORK_TURN',
    'DECIDE_ACTION_PROPOSAL',
    'CONTROL_WORK_SESSION',
    'READ_MCP',
  ],
  TEST_OWNER: [
    'VIEW_REQUIREMENT',
    'RUN_GATE',
    'REGISTER_MANUAL_GATE',
    'VIEW_MATERIAL',
    'VIEW_ARTIFACT',
    'REVIEW_ARTIFACT',
    'VIEW_AGENT_RUN',
    'VERIFY_AGENT_RUN',
    'VIEW_AGENT_AUDIT',
    'VIEW_WORK_SESSION',
  ],
  RELEASE_OWNER: [
    'VIEW_REQUIREMENT',
    'RUN_GATE',
    'REGISTER_MANUAL_GATE',
    'VIEW_MATERIAL',
    'VIEW_ARTIFACT',
    'REVIEW_ARTIFACT',
    'VIEW_AGENT_RUN',
    'VIEW_AGENT_AUDIT',
    'VIEW_WORK_SESSION',
  ],
};

export function resolveRequirementActionsForRoles(
  roles: readonly ActorRole[],
): readonly RequirementAction[] {
  return [
    ...new Set(roles.flatMap((role) => WORK_SESSION_ROLE_ACTIONS[role] ?? [])),
  ];
}

export class PostgresAuthorizationPort implements AuthorizationPort {
  private readonly db: ReturnType<LifecycleKysely['withSchema']>;
  private readonly scopedAuthorizations: PostgresScopedAuthorizationRepository | null;

  constructor(
    database: LifecycleKysely,
    schemaName = 'pfc',
    private readonly options: Readonly<{
      includeScopedTransmission?: boolean;
      now?: () => string;
    }> = {},
  ) {
    this.db = database.withSchema(schemaName);
    this.scopedAuthorizations = options.includeScopedTransmission
      ? new PostgresScopedAuthorizationRepository(database, schemaName)
      : null;
  }

  async lookupRequirementAuthorization(request: AuthorizationLookup) {
    const requirement = await this.db
      .selectFrom('requirements')
      .select(['id', 'initiator_id', 'business_owner_id'])
      .where('id', '=', request.requirementId)
      .executeTakeFirst();
    const memberships = requirement
      ? await this.db
          .selectFrom('requirement_assignments')
          .innerJoin('team_memberships', (join) =>
            join
              .onRef(
                'team_memberships.team_id',
                '=',
                'requirement_assignments.team_id',
              )
              .on('team_memberships.account_id', '=', request.actor.actorId),
          )
          .select([
            'team_memberships.team_id',
            'team_memberships.role',
            'team_memberships.status',
            'requirement_assignments.account_id as assigned_account_id',
            'requirement_assignments.status as assignment_status',
          ])
          .where(
            'requirement_assignments.requirement_id',
            '=',
            request.requirementId,
          )
          .execute()
      : [];
    const active = memberships.filter(
      (item) => item.status === 'ACTIVE' && item.assignment_status === 'ACTIVE',
    );
    const actorRoles = active.map((item) => item.role);
    const isDirect =
      requirement?.initiator_id === request.actor.actorId ||
      requirement?.business_owner_id === request.actor.actorId ||
      active.some((item) => item.assigned_account_id === request.actor.actorId);
    const allowedActions: RequirementAction[] = [
      ...resolveRequirementActionsForRoles(actorRoles),
    ];
    if (isDirect && !allowedActions.includes('VIEW_REQUIREMENT')) {
      allowedActions.push('VIEW_REQUIREMENT');
    }
    const actionAuthorizations = this.scopedAuthorizations
      ? await this.scopedAuthorizations.listCurrent({
          actorId: request.actor.actorId,
          requirementId: request.requirementId,
          at: this.options.now?.() ?? new Date().toISOString(),
        })
      : [];
    const snapshot: RequirementAuthorizationSnapshot = {
      actorId: request.actor.actorId,
      requirementId: request.requirementId,
      membership: {
        team: active.length > 0 ? 'YES' : 'NO',
        requirement: isDirect ? 'YES' : 'NO',
        restricted: isDirect || active.length > 0 ? 'YES' : 'NO',
      },
      allowedActions,
      approvedTransmissionTargets: this.scopedAuthorizations
        ? ['APPROVED_AI', 'APPROVED_SKILL']
        : [],
      actionAuthorizations,
    };
    return {
      status: 'AVAILABLE' as const,
      source: 'POSTGRESQL' as const,
      capabilityVersion: 'pfc-authorization/v1',
      checkedAt: new Date().toISOString(),
      data: snapshot,
    };
  }
}
