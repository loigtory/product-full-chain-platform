import type { EventSummary, SensitivityLevel } from './lifecycle.ts';

export const ACTOR_ROLES = [
  'PRODUCT_MANAGER',
  'PRODUCT_OWNER',
  'BUSINESS_OWNER',
  'ENGINEERING_OWNER',
  'TEST_OWNER',
  'RELEASE_OWNER',
  'TEAM_ADMIN',
] as const;

export const REQUIREMENT_ACTIONS = [
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
  'TRANSMIT_MATERIAL',
  'VIEW_WORK_SESSION',
  'CREATE_WORK_SESSION',
  'SUBMIT_WORK_TURN',
  'DECIDE_ACTION_PROPOSAL',
  'CONTROL_WORK_SESSION',
  'GRANT_MATERIAL_TRANSMISSION',
  'READ_MCP',
] as const;

export const ACCESS_FACTS = ['YES', 'NO', 'UNKNOWN'] as const;

export const TRANSMISSION_TARGETS = [
  'APPROVED_AI',
  'APPROVED_SKILL',
  'MODEL',
  'TERMINAL',
  'BRIDGE',
  'MCP',
] as const;

export type ActorRole = (typeof ACTOR_ROLES)[number];
export type RequirementAction = (typeof REQUIREMENT_ACTIONS)[number];
export type AccessFact = (typeof ACCESS_FACTS)[number];
export type TransmissionTarget = (typeof TRANSMISSION_TARGETS)[number];

export type ActorContext = Readonly<{
  actorId: string;
  roles: readonly ActorRole[];
  teamIds: readonly string[];
  authenticationStatus: 'AUTHENTICATED' | 'UNKNOWN';
}>;

export type MaterialTransmission = Readonly<{
  target: TransmissionTarget;
  purpose: string;
}>;

export type RequirementAccessRequest = Readonly<{
  requirementId: string;
  action: RequirementAction;
  sensitivity: SensitivityLevel | 'UNKNOWN';
  materialRefIds: readonly string[];
  requestedAt: string;
  transmission?: MaterialTransmission;
}>;

export type ScopedActionAuthorization = Readonly<{
  authorizationId: string;
  actorId: string;
  requirementId: string;
  action: RequirementAction;
  target: TransmissionTarget;
  purpose: string;
  materialRefIds: readonly string[];
  scopeHash: string;
  status: 'GRANTED' | 'REVOKED' | 'UNKNOWN';
  validFrom: string;
  validUntil: string;
  grantedBy: string;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  rowVersion: number;
}>;

export type RequirementAuthorizationSnapshot = Readonly<{
  actorId: string;
  requirementId: string;
  membership: Readonly<{
    team: AccessFact;
    requirement: AccessFact;
    restricted: AccessFact;
  }>;
  allowedActions: readonly RequirementAction[];
  approvedTransmissionTargets: readonly TransmissionTarget[];
  actionAuthorizations: readonly ScopedActionAuthorization[];
}>;

export type AccessDecision = Readonly<{
  decision: 'ALLOW' | 'DENY';
  code: 'PERMISSION_DENIED' | 'SENSITIVE_ACTION_AUTH_REQUIRED' | null;
  reasonCode: string;
  auditSummary: EventSummary;
}>;
