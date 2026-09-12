import type { CapabilityStatus } from './dependencies.ts';
import type {
  LifecycleErrorCode,
  LifecycleStage,
  MaterialPurpose,
  MaterialSourceType,
  SensitivityLevel,
} from './lifecycle.ts';
import type { QuestionDto } from './questions.ts';
import type {
  GateExecutionCapabilityDto,
  GateProjection,
  GateRunDto,
} from './gate-runs.ts';
import type { MaterialImpactAssessmentDto } from './material-impacts.ts';

export const REQUIREMENT_LIST_SCOPES = ['MINE', 'ALL', 'BLOCKED'] as const;
export const REQUIREMENT_LIST_VIEWS = ['TABLE', 'STAGE'] as const;
export const G0_GATE_PROJECTIONS = ['BLOCK', 'NOT_STARTED'] as const;
export const REQUIREMENT_SUBMISSION_STATUSES = [
  'CREATED',
  'NOT_FOUND',
  'UNKNOWN',
] as const;

export type RequirementListScope = (typeof REQUIREMENT_LIST_SCOPES)[number];
export type RequirementListView = (typeof REQUIREMENT_LIST_VIEWS)[number];
export type G0GateProjection = (typeof G0_GATE_PROJECTIONS)[number];
export type RequirementSubmissionStatus =
  (typeof REQUIREMENT_SUBMISSION_STATUSES)[number];

export type G0RegistrationDto = Readonly<{
  sourceType?: MaterialSourceType | null;
  sourceDescription?: string | null;
  businessOwnerId?: string | null;
  materialPurpose?: MaterialPurpose | null;
  sensitivity?: SensitivityLevel | null;
}>;

export type MaterialBaselineDto = Readonly<{
  id: string;
  versionNumber: number;
  sourceType: MaterialSourceType;
  sourceDescription: string | null;
  materialPurpose: MaterialPurpose;
  sensitivity: SensitivityLevel;
  confirmedBy: string;
  confirmedAt: string;
}>;

export type RequirementListItemDto = Readonly<{
  id: string;
  name: string;
  currentStage: LifecycleStage;
  gateProjection: GateProjection;
  ownerId: string;
  nextAction: string;
  updatedAt: string;
  dependencyStatus: CapabilityStatus;
  warningCode: string | null;
}>;

export type RequirementListResponse = Readonly<{
  items: readonly RequirementListItemDto[];
  nextCursor: string | null;
  partial: boolean;
  checkedAt: string;
}>;

export type RequirementDetailDto = Readonly<{
  id: string;
  name: string;
  originalIdea: string;
  initiatorId: string;
  businessOwnerId: string | null;
  currentStage: LifecycleStage;
  rowVersion: number;
  registration: G0RegistrationDto;
  missingFields: readonly string[];
  gateProjection: GateProjection;
  currentBaseline: MaterialBaselineDto | null;
  materialBaselines?: readonly MaterialBaselineDto[];
  materialImpacts?: readonly MaterialImpactAssessmentDto[];
  questions: readonly QuestionDto[];
  currentGateRun: GateRunDto | null;
  gateRuns: readonly GateRunDto[];
  gateExecution: GateExecutionCapabilityDto;
  createdAt: string;
  updatedAt: string;
}>;

export type MaterialImpactMutationResponse = Readonly<{
  replayed: boolean;
  requirement: Readonly<{
    id: string;
    currentStage: LifecycleStage;
    currentBaselineId: string | null;
    rowVersion: number;
  }>;
  assessment: MaterialImpactAssessmentDto;
}>;

export type CreateRequirementRequest = Readonly<{
  name: string;
  originalIdea: string;
  registration?: G0RegistrationDto;
}>;

export type CompleteG0RegistrationRequest = G0RegistrationDto;

export type RequirementMutationResponse = Readonly<{
  replayed: boolean;
  requirement: RequirementDetailDto;
}>;

export type RequirementSubmissionResponse = Readonly<{
  status: RequirementSubmissionStatus;
  existingResourceId: string | null;
}>;

export type ApiErrorResponse = Readonly<{
  code: LifecycleErrorCode;
  message: string;
  requestId: string;
  retryable: boolean;
  recoveryAction: string;
  currentVersion?: number;
  existingResourceId?: string;
}>;
