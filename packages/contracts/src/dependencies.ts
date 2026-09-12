import type {
  ActorContext,
  RequirementAction,
  RequirementAuthorizationSnapshot,
} from './access.ts';
import type {
  GateRunResult,
  LifecycleStage,
  SensitivityLevel,
} from './lifecycle.ts';

export const CAPABILITY_STATUSES = [
  'AVAILABLE',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;

export const CAPABILITY_SOURCES = [
  'POSTGRESQL',
  'REMOTE',
  'FIXTURE',
  'UNAVAILABLE',
] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];
export type CapabilitySource = (typeof CAPABILITY_SOURCES)[number];

export type CapabilityResult<T> =
  | Readonly<{
      status: 'AVAILABLE';
      source: Exclude<CapabilitySource, 'UNAVAILABLE'>;
      capabilityVersion: string;
      checkedAt: string;
      data: T;
    }>
  | Readonly<{
      status: 'UNAVAILABLE' | 'UNKNOWN';
      source: CapabilitySource;
      capabilityVersion: string;
      checkedAt: string;
      reasonCode: string;
    }>;

export type AuthorizationLookup = Readonly<{
  actor: ActorContext;
  requirementId: string;
  action: RequirementAction;
}>;

export interface AuthorizationPort {
  lookupRequirementAuthorization(
    request: AuthorizationLookup,
  ): Promise<CapabilityResult<RequirementAuthorizationSnapshot>>;
}

export type EvidenceDescriptor = Readonly<{
  evidenceRefId: string;
  baselineId: string;
  referenceType: string;
  sensitivity: SensitivityLevel;
  validity: 'VALID' | 'INVALIDATED';
}>;

export type ArtifactEvidenceRequest = Readonly<{
  actorId: string;
  requirementId: string;
  baselineId: string;
  evidenceRefIds: readonly string[];
}>;

export interface ArtifactEvidencePort {
  listEvidence(
    request: ArtifactEvidenceRequest,
  ): Promise<CapabilityResult<readonly EvidenceDescriptor[]>>;
}

export type GateExecutionRequest = Readonly<{
  actorId: string;
  requirementId: string;
  baselineId: string;
  stage: LifecycleStage;
  idempotencyKey: string;
}>;

export type GateExecutionCapabilityRequest = Omit<
  GateExecutionRequest,
  'idempotencyKey'
>;

export type GateExecutionCapability = Readonly<{
  executable: true;
}>;

export type GateExecutionReceipt = Readonly<{
  executionId: string;
  status: 'ACCEPTED' | 'RUNNING' | 'COMPLETED' | 'UNKNOWN';
  result: GateRunResult | null;
}>;

export interface GateExecutionPort {
  getGateExecutionCapability(
    request: GateExecutionCapabilityRequest,
  ): Promise<CapabilityResult<GateExecutionCapability>>;
  executeGate(
    request: GateExecutionRequest,
  ): Promise<CapabilityResult<GateExecutionReceipt>>;
}

export type DeliverySummaryRequest = Readonly<{
  actorId: string;
  requirementId: string;
  baselineId: string;
  stage: LifecycleStage;
}>;

export type DeliverySummary = Readonly<{
  status: 'PRESENT' | 'MISSING' | 'UNKNOWN';
  result: GateRunResult | null;
  summaryVersion: string | null;
}>;

export interface DeliverySummaryPort {
  getDeliverySummary(
    request: DeliverySummaryRequest,
  ): Promise<CapabilityResult<DeliverySummary>>;
}
