import type {
  EventSummary,
  GateResult,
  GateRunResult,
  GateConfirmationRole,
  LifecycleStage,
  MaterialPurpose,
  MaterialSourceType,
  MaterialImpactConfirmationRole,
  MaterialImpactDecision,
  MaterialImpactStatus,
  QuestionConfirmationRole,
  QuestionDecisionKind,
  QuestionDecisionScopeDto,
  QuestionStatus,
  SensitivityLevel,
} from '@pfc/contracts';

export type Requirement = Readonly<{
  id: string;
  name: string;
  originalIdea: string;
  initiatorId: string;
  businessOwnerId: string | null;
  currentStage: LifecycleStage;
  currentBaselineId: string | null;
  rowVersion: number;
  draftRegistration?: G0Registration;
  createdAt: string;
  updatedAt: string;
}>;

export type G0Registration = Readonly<{
  sourceType?: MaterialSourceType | null;
  sourceDescription?: string | null;
  businessOwnerId?: string | null;
  materialPurpose?: MaterialPurpose | null;
  sensitivity?: SensitivityLevel | null;
}>;

export type G0RegistrationField =
  | 'sourceType'
  | 'sourceDescription'
  | 'businessOwnerId'
  | 'materialPurpose'
  | 'sensitivity';

export type MaterialBaseline = Readonly<{
  id: string;
  requirementId: string;
  versionNumber: number;
  status: 'CURRENT' | 'HISTORICAL' | 'CANDIDATE';
  sourceType: MaterialSourceType;
  sourceDescription: string | null;
  materialPurpose: MaterialPurpose;
  sensitivity: SensitivityLevel;
  confirmedBy: string;
  confirmedAt: string;
  createdAt: string;
}>;

export type Question = Readonly<{
  id: string;
  requirementId: string;
  baselineId: string;
  prompt: string;
  reason: string | null;
  candidates: readonly string[];
  ownerId: string;
  closeByStage: LifecycleStage;
  status: QuestionStatus;
  currentDecisionId: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}>;

export type Decision = Readonly<{
  id: string;
  questionId: string;
  kind: QuestionDecisionKind;
  rawAnswer: string;
  explanation: string | null;
  scope: QuestionDecisionScopeDto;
  versionNumber: number;
  confirmedRole: QuestionConfirmationRole | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  validity: 'CURRENT' | 'SUPERSEDED';
  supersedesDecisionId: string | null;
  createdAt: string;
}>;

export type EvidenceRef = Readonly<{
  id: string;
  baselineId: string;
  referenceType: string;
  source: string;
  version: string | null;
  contentHash: string | null;
  location: string;
  sensitivity: SensitivityLevel;
  validity: 'VALID' | 'INVALIDATED';
  createdAt: string;
}>;

export type MaterialImpactAssessment = Readonly<{
  id: string;
  requirementId: string;
  originalBaselineId: string;
  candidateBaselineId: string;
  recommendedStage: LifecycleStage;
  selectedStage: LifecycleStage | null;
  decision: MaterialImpactDecision | null;
  reason: string | null;
  status: MaterialImpactStatus;
  confirmedRole: MaterialImpactConfirmationRole | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  invalidatedGateRunIds: readonly string[];
  createdAt: string;
}>;

export type GateRun = Readonly<{
  id: string;
  requirementId: string;
  baselineId: string;
  stage: LifecycleStage;
  mode: 'AUTOMATIC' | 'MANUAL';
  status: 'IN_PROGRESS' | 'COMPLETED';
  result: GateRunResult | null;
  validity: 'CURRENT' | 'INVALIDATED' | 'STALE_BASELINE';
  ownerId: string;
  confirmedRole: GateConfirmationRole | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  unknownReason: string | null;
  registrationNote: string | null;
}>;

export type StageAdvancement = Readonly<{
  id: string;
  gateRunId: string;
  requirementId: string;
  baselineId: string;
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
  advancedAt: string;
}>;

export type GateCheck = Readonly<{
  id: string;
  gateRunId: string;
  checkKey: string;
  result: GateResult;
  reason: string | null;
  ownerId: string | null;
  closePoint: string | null;
  createdAt: string;
}>;

export type GateRunEvidence = Readonly<{
  gateRunId: string;
  evidenceRefId: string;
  accessDecision: 'ALLOWED' | 'DENIED' | 'UNKNOWN';
  actionAuthorizationRef: string | null;
  createdAt: string;
}>;

export type TimelineEvent = Readonly<{
  id: string;
  requirementId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  actorId: string;
  beforeSummary: EventSummary | null;
  afterSummary: EventSummary;
  aggregateVersion: number;
  occurredAt: string;
}>;

export type AuditEvent = Readonly<{
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  decision: string;
  reason: string | null;
  scopeSummary: EventSummary;
  requestId: string;
  occurredAt: string;
}>;

export type IdempotencyRecord = Readonly<{
  id: string;
  actorId: string;
  route: string;
  idempotencyKey: string;
  requestHash: string;
  resultReference: string | null;
  responseSummary: EventSummary | null;
  createdAt: string;
}>;

export type OutboxEvent = Readonly<{
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  summary: EventSummary;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
}>;
