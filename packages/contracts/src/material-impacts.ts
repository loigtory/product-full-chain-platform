import type { ActorRole } from './access.ts';
import type {
  LifecycleStage,
  MaterialPurpose,
  MaterialSourceType,
  SensitivityLevel,
} from './lifecycle.ts';

export const MATERIAL_IMPACT_DECISIONS = ['IMPACTS', 'NO_IMPACT'] as const;
export const MATERIAL_IMPACT_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
] as const;
export const MATERIAL_IMPACT_CONFIRMATION_ROLES = [
  'PRODUCT_OWNER',
  'BUSINESS_OWNER',
] as const satisfies readonly ActorRole[];

export type MaterialImpactDecision = (typeof MATERIAL_IMPACT_DECISIONS)[number];
export type MaterialImpactStatus = (typeof MATERIAL_IMPACT_STATUSES)[number];
export type MaterialImpactConfirmationRole =
  (typeof MATERIAL_IMPACT_CONFIRMATION_ROLES)[number];

export type CandidateBaselineInput = Readonly<{
  sourceType: MaterialSourceType;
  sourceDescription?: string | null;
  materialPurpose: MaterialPurpose;
  sensitivity: SensitivityLevel;
}>;

export type MaterialImpactAssessmentDto = Readonly<{
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

export type CreateMaterialImpactAssessmentRequest = Readonly<{
  candidateBaseline: CandidateBaselineInput;
  recommendedStage: LifecycleStage;
}>;

export type ConfirmMaterialImpactRequest = Readonly<{
  decision: MaterialImpactDecision;
  selectedStage?: LifecycleStage | null;
  reason: string;
  confirmedRole: MaterialImpactConfirmationRole;
}>;
