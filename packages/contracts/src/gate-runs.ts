import type { ActorRole } from './access.ts';
import type { GateResult, GateRunResult, LifecycleStage } from './lifecycle.ts';

export const GATE_PROJECTIONS = [
  'BLOCK',
  'NOT_STARTED',
  'PROCESSING',
  'WARN',
  'UNKNOWN',
] as const;

export const MANUAL_GATE_RUN_RESULTS = ['PASS', 'BLOCK', 'WARN'] as const;

export const GATE_CONFIRMATION_ROLES = [
  'PRODUCT_OWNER',
  'BUSINESS_OWNER',
  'ENGINEERING_OWNER',
  'TEST_OWNER',
  'RELEASE_OWNER',
] as const satisfies readonly ActorRole[];

export type GateProjection = (typeof GATE_PROJECTIONS)[number];
export type ManualGateRunResult = (typeof MANUAL_GATE_RUN_RESULTS)[number];
export type GateConfirmationRole = (typeof GATE_CONFIRMATION_ROLES)[number];

export type GateCheckDto = Readonly<{
  id: string;
  checkKey: string;
  result: GateResult;
  reason: string | null;
  ownerId: string | null;
  closePoint: string | null;
}>;

export type GateRunEvidenceDto = Readonly<{
  evidenceRefId: string;
  accessDecision: 'ALLOWED' | 'DENIED' | 'UNKNOWN';
  actionAuthorizationRef: string | null;
}>;

export type StageAdvancementDto = Readonly<{
  id: string;
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
  advancedAt: string;
}>;

export type GateRunDto = Readonly<{
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
  checks: readonly GateCheckDto[];
  evidence: readonly GateRunEvidenceDto[];
  advancement: StageAdvancementDto | null;
}>;

export type GateExecutionCapabilityDto = Readonly<{
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  capabilityVersion: string;
  checkedAt: string;
  reasonCode: string | null;
}>;

export type StartAutomaticGateRunRequest = Readonly<{
  baselineId: string;
  stage: LifecycleStage;
}>;

export type ManualGateCheckInput = Readonly<{
  checkKey: string;
  result: GateResult;
  reason?: string | null;
  ownerId?: string | null;
  closePoint?: string | null;
}>;

export type RegisterManualGateRunRequest = Readonly<{
  baselineId: string;
  stage: LifecycleStage;
  result: ManualGateRunResult;
  registrationNote: string;
  confirmedRole: GateConfirmationRole;
  evidenceRefIds: readonly string[];
  checks: readonly ManualGateCheckInput[];
}>;

export type GateRunMutationResponse = Readonly<{
  replayed: boolean;
  reusedInProgress: boolean;
  gateRun: GateRunDto;
  requirement: Readonly<{
    id: string;
    currentStage: LifecycleStage;
    currentBaselineId: string | null;
    rowVersion: number;
  }>;
}>;
