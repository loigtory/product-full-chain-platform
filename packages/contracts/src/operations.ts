import type {
  LifecycleStage,
  MaterialPurpose,
  MaterialSourceType,
  SensitivityLevel,
} from './lifecycle.ts';
import type { MaterialImpactAssessmentDto } from './material-impacts.ts';

export const GATE_CENTER_VIEWS = ['CURRENT', 'HISTORY'] as const;
export const GATE_CENTER_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'PASS',
  'BLOCK',
  'WARN',
  'UNKNOWN',
] as const;
export const GATE_RUN_MODES = ['AUTOMATIC', 'MANUAL'] as const;
export const MATERIAL_BASELINE_STATUSES = [
  'CURRENT',
  'HISTORICAL',
  'CANDIDATE',
] as const;

export type GateCenterView = (typeof GATE_CENTER_VIEWS)[number];
export type GateCenterStatus = (typeof GATE_CENTER_STATUSES)[number];
export type GateRunMode = (typeof GATE_RUN_MODES)[number];
export type MaterialBaselineStatus =
  (typeof MATERIAL_BASELINE_STATUSES)[number];

export type GateCenterItemDto = Readonly<{
  key: string;
  requirementId: string;
  requirementName: string;
  requirementStage: LifecycleStage;
  stage: LifecycleStage;
  baselineId: string | null;
  gateRunId: string | null;
  mode: GateRunMode | null;
  status: GateCenterStatus;
  validity: 'CURRENT' | 'INVALIDATED' | 'STALE_BASELINE' | null;
  ownerId: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  nextAction: string;
  historyCount: number;
}>;

export type GateCenterResponse = Readonly<{
  items: readonly GateCenterItemDto[];
  nextCursor: string | null;
  checkedAt: string;
}>;

export type MaterialRefSummaryDto = Readonly<{
  id: string;
  referenceType: string;
  source: string;
  version: string | null;
  sensitivity: SensitivityLevel;
  validity: 'VALID' | 'INVALIDATED';
}>;

export type MaterialLibraryItemDto = Readonly<{
  baselineId: string;
  requirementId: string;
  requirementName: string;
  requirementStage: LifecycleStage;
  versionNumber: number;
  status: MaterialBaselineStatus;
  sourceType: MaterialSourceType;
  sourceDescription: string | null;
  materialPurpose: MaterialPurpose;
  sensitivity: SensitivityLevel;
  confirmedBy: string;
  confirmedAt: string;
  createdAt: string;
  materialRefs: readonly MaterialRefSummaryDto[];
  pendingImpact: MaterialImpactAssessmentDto | null;
}>;

export type MaterialLibraryResponse = Readonly<{
  items: readonly MaterialLibraryItemDto[];
  nextCursor: string | null;
  checkedAt: string;
}>;
