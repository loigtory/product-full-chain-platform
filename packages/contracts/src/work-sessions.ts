import type { ActorRole, ScopedActionAuthorization } from './access.ts';
import type { CreateAgentRunRequest } from './agent-runs.ts';
import type {
  EventSummary,
  LifecycleStage,
  MaterialPurpose,
  MaterialSourceType,
  SensitivityLevel,
} from './lifecycle.ts';
import type { QuestionConfirmationRole } from './questions.ts';
import type { SkillRiskLevel } from './skills.ts';
import type { BridgeCapabilityState, BridgeStatus } from './bridges.ts';

export const PRODUCT_WORK_SESSION_STATUSES = [
  'ACTIVE',
  'BLOCKED',
  'COMPLETED',
  'ARCHIVED',
] as const;

export const PRODUCT_WORK_TURN_STATUSES = [
  'RECEIVED',
  'QUEUED',
  'RUNNING',
  'WAITING_INPUT',
  'PROPOSING',
  'COMPLETED',
  'FAILED',
  'CANCELLING',
  'CANCELLED',
  'UNKNOWN',
] as const;

export const ACTION_PROPOSAL_STATUSES = [
  'DRAFT',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'APPLYING',
  'APPLIED',
  'REJECTED',
  'EXPIRED',
  'STALE',
  'FAILED',
  'UNKNOWN',
] as const;

export const ACTION_PROPOSAL_KINDS = [
  'COMPLETE_G0_REGISTRATION',
  'ANSWER_QUESTION',
  'CONFIRM_QUESTION',
  'REGISTER_ARTIFACT',
  'APPEND_ARTIFACT_VERSION',
  'CREATE_AGENT_RUN',
  'REGISTER_TRACE_LINK',
  'READ_MCP',
] as const;

export const PRODUCT_WORK_CONTEXT_TYPES = [
  'MATERIAL_BASELINE',
  'MATERIAL_REF',
  'QUESTION',
  'DECISION',
  'ARTIFACT_VERSION',
  'GATE_RUN',
  'AGENT_RUN',
  'EVIDENCE',
] as const;

export const CONTEXT_BINDING_ROLES = [
  'PRIMARY',
  'SOURCE',
  'OUTPUT',
  'EVIDENCE',
] as const;

export const WORK_SESSION_CONTROL_ACTIONS = [
  'COMPLETE',
  'ARCHIVE',
  'RESUME',
] as const;

export const WORK_TURN_CONTROL_ACTIONS = ['CANCEL', 'VERIFY'] as const;
export const PRODUCT_WORK_CONTROL_SURFACES = ['WEB'] as const;

export const PRODUCT_WORK_READINESS_BLOCKER_CODES = [
  'NO_CURRENT_BASELINE',
  'NO_VALID_CONTEXT',
  'CONTEXT_SELECTION_REQUIRED',
  'BRIDGE_UNAVAILABLE',
  'BRIDGE_UNVERIFIED',
  'NO_COMPATIBLE_SKILL',
  'SKILL_SELECTION_REQUIRED',
  'TRANSMISSION_AUTHORIZATION_REQUIRED',
  'TRANSMISSION_DENIED',
  'TRANSMISSION_STATUS_UNKNOWN',
] as const;

export const PRODUCT_WORK_READINESS_BRIDGE_STATUSES = [
  'AVAILABLE',
  'UNAVAILABLE',
  'UNVERIFIED',
] as const;

export const PRODUCT_WORK_READINESS_TRANSMISSION_STATUSES = [
  'READY',
  'AUTHORIZATION_REQUIRED',
  'DENIED',
  'UNKNOWN',
] as const;

export const PRODUCT_WORK_READINESS_SKILL_AVAILABILITIES = [
  'AVAILABLE',
  'UNAVAILABLE',
] as const;

export const PRODUCT_WORK_SESSION_EVENT_TYPES = [
  'SESSION_CREATED',
  'SESSION_BLOCKED',
  'SESSION_RESUMED',
  'SESSION_COMPLETED',
  'SESSION_ARCHIVED',
  'TURN_RECEIVED',
  'TURN_QUEUED',
  'TURN_STARTED',
  'TURN_WAITING_INPUT',
  'TURN_MESSAGE_AVAILABLE',
  'TURN_PROPOSAL_AVAILABLE',
  'TURN_COMPLETED',
  'TURN_CANCEL_REQUESTED',
  'TURN_CANCELLED',
  'TURN_FAILED',
  'TURN_UNKNOWN',
  'PROPOSAL_DECIDED',
  'PROPOSAL_APPLYING',
  'PROPOSAL_APPLIED',
  'PROPOSAL_STALE',
  'PROPOSAL_FAILED',
  'PROPOSAL_UNKNOWN',
  'CONTEXT_INVALIDATED',
  'AGENT_RUN_LINKED',
  'MCP_READ_REQUESTED',
  'MCP_READ_STARTED',
  'MCP_READ_COMPLETED',
  'MCP_READ_FAILED',
  'MCP_READ_UNKNOWN',
] as const;

export type ProductWorkSessionStatus =
  (typeof PRODUCT_WORK_SESSION_STATUSES)[number];
export type ProductWorkTurnStatus = (typeof PRODUCT_WORK_TURN_STATUSES)[number];
export type ActionProposalStatus = (typeof ACTION_PROPOSAL_STATUSES)[number];
export type ActionProposalKind = (typeof ACTION_PROPOSAL_KINDS)[number];
export type ProductWorkContextType =
  (typeof PRODUCT_WORK_CONTEXT_TYPES)[number];
export type ContextBindingRole = (typeof CONTEXT_BINDING_ROLES)[number];
export type WorkSessionControlAction =
  (typeof WORK_SESSION_CONTROL_ACTIONS)[number];
export type WorkTurnControlAction = (typeof WORK_TURN_CONTROL_ACTIONS)[number];
export type ProductWorkControlSurface =
  (typeof PRODUCT_WORK_CONTROL_SURFACES)[number];
export type ProductWorkReadinessBlockerCode =
  (typeof PRODUCT_WORK_READINESS_BLOCKER_CODES)[number];
export type ProductWorkReadinessBridgeStatus =
  (typeof PRODUCT_WORK_READINESS_BRIDGE_STATUSES)[number];
export type ProductWorkReadinessTransmissionStatus =
  (typeof PRODUCT_WORK_READINESS_TRANSMISSION_STATUSES)[number];
export type ProductWorkReadinessSkillAvailability =
  (typeof PRODUCT_WORK_READINESS_SKILL_AVAILABILITIES)[number];
export type ProductWorkSessionEventType =
  (typeof PRODUCT_WORK_SESSION_EVENT_TYPES)[number];

export type ProductWorkSessionDto = Readonly<{
  schemaVersion: 'product-work-session/1';
  id: string;
  teamId: string;
  requirementId: string;
  openedRequirementVersion: number;
  currentRequirementVersion: number;
  openedBaselineId: string | null;
  openedStage: LifecycleStage;
  status: ProductWorkSessionStatus;
  controlSurface: ProductWorkControlSurface;
  activeTurnId: string | null;
  lastSequence: number;
  ownerId: string;
  title: string | null;
  blockReason: string | null;
  rowVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}>;

export type ProductWorkTurnExternalIdsDto = Readonly<{
  threadId: string | null;
  turnId: string | null;
}>;

export type ProductWorkTurnUsageSummaryDto = Readonly<{
  inputTokens: number | 'UNKNOWN';
  outputTokens: number | 'UNKNOWN';
  cachedInputTokens: number | 'UNKNOWN';
  durationMs: number | 'UNKNOWN';
}>;

export type ProductWorkTurnDto = Readonly<{
  schemaVersion: 'product-work-turn/1';
  id: string;
  sessionId: string;
  sequence: number;
  intentKind: string;
  inputText: string;
  visibleResponse: string | null;
  status: ProductWorkTurnStatus;
  skillReleaseId: string;
  bridgeId: string | null;
  externalIds: ProductWorkTurnExternalIdsDto;
  usageSummary: ProductWorkTurnUsageSummaryDto | null;
  failureReason: string | null;
  recoveryAction: string | null;
  contentRetentionUntil: string | null;
  redactedAt: string | null;
  rowVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
}>;

export type ContextBindingDto = Readonly<{
  schemaVersion: 'product-work-context-binding/1';
  id: string;
  sessionId: string;
  turnId: string;
  contextType: ProductWorkContextType;
  targetId: string;
  targetVersion: number | null;
  contentHash: string;
  bindingRole: ContextBindingRole;
  sensitivity: SensitivityLevel;
  invalidatedAt: string | null;
  reasonCode: string | null;
  createdAt: string;
}>;

export type CompleteG0RegistrationProposalChangeSet = Readonly<{
  kind: 'COMPLETE_G0_REGISTRATION';
  sourceType: MaterialSourceType;
  sourceDescription?: string;
  businessOwnerId: string;
  materialPurpose: MaterialPurpose;
  sensitivity: SensitivityLevel;
}>;

export type AnswerQuestionProposalChangeSet = Readonly<{
  kind: 'ANSWER_QUESTION';
  questionId: string;
  answer: string;
}>;

export type ConfirmQuestionProposalChangeSet = Readonly<{
  kind: 'CONFIRM_QUESTION';
  questionId: string;
  confirmationRole: QuestionConfirmationRole;
  reason: string;
}>;

export type RegisterArtifactProposalChangeSet = Readonly<{
  kind: 'REGISTER_ARTIFACT';
  capId: string;
  stage: LifecycleStage;
  artifactType: string;
  title: string;
}>;

export type AppendArtifactVersionProposalChangeSet = Readonly<{
  kind: 'APPEND_ARTIFACT_VERSION';
  artifactId: string;
  versionLabel: string;
  sourceType: string;
  sourceRef: string;
  contentHash: string;
  sensitivity: SensitivityLevel;
}>;

export type CreateAgentRunProposalChangeSet = Readonly<
  { kind: 'CREATE_AGENT_RUN' } & CreateAgentRunRequest
>;

export type RegisterTraceLinkProposalChangeSet = Readonly<{
  kind: 'REGISTER_TRACE_LINK';
  sourceSubjectId: string;
  targetSubjectId: string;
  relationType: string;
}>;

export type ReadMcpProposalChangeSet = Readonly<{
  kind: 'READ_MCP';
  logicalCapabilityId: string;
  input: Readonly<Record<string, unknown>>;
  sensitivity: SensitivityLevel;
  materialRefIds: readonly string[];
}>;

export type ActionProposalChangeSet =
  | CompleteG0RegistrationProposalChangeSet
  | AnswerQuestionProposalChangeSet
  | ConfirmQuestionProposalChangeSet
  | RegisterArtifactProposalChangeSet
  | AppendArtifactVersionProposalChangeSet
  | CreateAgentRunProposalChangeSet
  | RegisterTraceLinkProposalChangeSet
  | ReadMcpProposalChangeSet;

export type ActionProposalTargetDto = Readonly<{
  aggregateType:
    | 'REQUIREMENT'
    | 'QUESTION'
    | 'ARTIFACT'
    | 'AGENT_RUN'
    | 'TRACE_LINK'
    | 'MCP_CAPABILITY';
  aggregateId: string;
  rowVersion: number;
}>;

export type ActionProposalDisplayDiffDto = Readonly<{
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}>;

export type ActionProposalResultRefDto = Readonly<{
  aggregateType:
    | 'REQUIREMENT'
    | 'QUESTION'
    | 'ARTIFACT'
    | 'AGENT_RUN'
    | 'TRACE_LINK'
    | 'MCP_CAPABILITY';
  aggregateId: string;
  rowVersion: number;
}>;

export type ActionProposalDto = Readonly<{
  schemaVersion: 'product-action-proposal/1';
  id: string;
  sessionId: string;
  turnId: string;
  kind: ActionProposalKind;
  target: ActionProposalTargetDto;
  changeSet: ActionProposalChangeSet;
  displayDiff: readonly ActionProposalDisplayDiffDto[];
  scopeHash: string;
  confirmationRequirement: ActorRole;
  status: ActionProposalStatus;
  confirmedBy: string | null;
  confirmedAt: string | null;
  reasonCode: string | null;
  resultRef: ActionProposalResultRefDto | null;
  failureReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}>;

export type ProductWorkSessionEventDto = Readonly<{
  schemaVersion: 'product-work-session-event/1';
  eventId: string;
  sessionId: string;
  sequence: number;
  type: ProductWorkSessionEventType;
  aggregateRef: Readonly<{ type: string; id: string }>;
  safeSummary: EventSummary;
  occurredAt: string;
  receivedAt: string;
}>;

export type CreateProductWorkSessionRequest = Readonly<{
  schemaVersion: 'create-product-work-session/1';
  teamId?: string;
  controlSurface: 'WEB';
  title?: string;
}>;

export type CreateProductWorkTurnRequest = Readonly<{
  schemaVersion: 'create-product-work-turn/1';
  intentKind: string;
  message: string;
  contextBindingIds: readonly string[];
  skillReleaseId?: string;
}>;

export type ProductWorkReadinessContextOptionDto = Readonly<{
  materialRefId: string;
  referenceType: string;
  version: string | null;
  sensitivity: SensitivityLevel;
  selectedByDefault: boolean;
  reason: string;
}>;

export type ProductWorkReadinessSkillOptionDto = Readonly<{
  releaseId: string;
  displayName: string;
  version: string;
  riskLevel: SkillRiskLevel;
  contextCost: number | null;
  availability: ProductWorkReadinessSkillAvailability;
  disabledReason: string | null;
  recommended: boolean;
}>;

export type ProductWorkReadinessBlockerDto = Readonly<{
  code: ProductWorkReadinessBlockerCode;
  message: string;
  recoveryAction: string;
}>;

export type ProductWorkReadinessAuthorizationDto = Readonly<{
  authorizationId: string;
  materialRefIds: readonly string[];
  validUntil: string;
  rowVersion: number;
}>;

export type ProductWorkSessionReadinessDto = Readonly<{
  schemaVersion: 'product-work-session-readiness/1';
  sessionId: string;
  sessionRowVersion: number;
  requirementRowVersion: number;
  baselineId: string | null;
  checkedAt: string;
  contextOptions: readonly ProductWorkReadinessContextOptionDto[];
  skillOptions: readonly ProductWorkReadinessSkillOptionDto[];
  recommendedContextIds: readonly string[];
  recommendedSkillReleaseId: string | null;
  transmissionStatus: ProductWorkReadinessTransmissionStatus;
  bridgeStatus: ProductWorkReadinessBridgeStatus;
  activeTransmissionAuthorization: ProductWorkReadinessAuthorizationDto | null;
  blockers: readonly ProductWorkReadinessBlockerDto[];
}>;

export type CreateProductWorkTransmissionAuthorizationRequest = Readonly<{
  schemaVersion: 'create-product-work-transmission-authorization/1';
  beneficiaryActorId: string;
  materialRefIds: readonly string[];
  validForMinutes: number;
}>;

export type RevokeProductWorkTransmissionAuthorizationRequest = Readonly<{
  schemaVersion: 'revoke-product-work-transmission-authorization/1';
}>;

export type ProductWorkTransmissionAuthorizationMutationResponse = Readonly<{
  replayed: boolean;
  authorization: ScopedActionAuthorization;
}>;

export type ActionProposalDecisionRequest = Readonly<{
  schemaVersion: 'action-proposal-decision/1';
  decision: 'CONFIRM' | 'REJECT';
  scopeHash: string;
  reasonCode: string;
}>;

export type ProductWorkSessionMutationResponse = Readonly<{
  replayed: boolean;
  session: ProductWorkSessionDto;
}>;

export type ProductWorkTurnMutationResponse = Readonly<{
  replayed: boolean;
  turn: ProductWorkTurnDto;
}>;

export type ActionProposalMutationResponse = Readonly<{
  replayed: boolean;
  proposal: ActionProposalDto;
}>;

export type ProductWorkTurnPageResponse = Readonly<{
  items: readonly ProductWorkTurnDto[];
  nextCursor: string | null;
}>;

export type ProductWorkSessionListResponse = Readonly<{
  items: readonly ProductWorkSessionDto[];
  nextCursor: string | null;
}>;

export type ProductWorkSessionEventsResponse = Readonly<{
  sessionId: string;
  afterSequence: number;
  nextSequence: number | null;
  reloadRequired: boolean;
  items: readonly ProductWorkSessionEventDto[];
}>;

export type ProductWorkWorkspaceEvidenceDto = Readonly<{
  schemaVersion: 'product-workspace-evidence/1';
  evidenceStatus: 'VERIFIED' | 'MISSING' | 'EXPIRED' | 'MISMATCHED';
  bridgeId: string | null;
  bridgeStatus: BridgeStatus | null;
  workspaceId: string | null;
  verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'FAILED' | null;
  repositoryFingerprint: string | null;
  bindingGitBaseline: string | null;
  capabilityGitBaseline: string | null;
  capabilityCapturedAt: string | null;
  capabilityExpiresAt: string | null;
  capabilityFreshness: 'CURRENT' | 'EXPIRED' | 'MISSING';
  codexAppServer: BridgeCapabilityState;
  zedCli: BridgeCapabilityState;
  productWorkTurn: BridgeCapabilityState;
  mcp: Readonly<{
    state: BridgeCapabilityState;
    status: 'AVAILABLE' | 'DRIFTED' | 'UNVERIFIED' | 'UNAVAILABLE';
    configFingerprint: string | null;
    registeredReadCapabilityCount: number;
  }>;
}>;

export type ProductWorkSessionSnapshotDto = Readonly<{
  schemaVersion: 'product-work-session-snapshot/1';
  session: ProductWorkSessionDto;
  requirement: Readonly<{
    id: string;
    name: string;
    currentStage: LifecycleStage;
    currentBaselineId: string | null;
    rowVersion: number;
    businessOwnerId: string | null;
  }>;
  contextItems: readonly ContextBindingDto[];
  turns: ProductWorkTurnPageResponse;
  pendingProposal: ActionProposalDto | null;
  linkedAgentRunIds: readonly string[];
  workspaceEvidence: ProductWorkWorkspaceEvidenceDto;
  recoveryAction: string | null;
}>;
