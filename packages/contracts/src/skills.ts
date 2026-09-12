import { AGENT_RUN_OPERATIONS } from './agent-runs.ts';

export const SKILL_SOURCE_TYPES = ['LOCAL_ALLOWLIST'] as const;
export const SKILL_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const SKILL_EVALUATION_STATUSES = [
  'NOT_EVALUATED',
  'PASSED',
  'FAILED',
] as const;
export const SKILL_RELEASE_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export const SKILL_RELEASE_SCOPES = [
  ...AGENT_RUN_OPERATIONS,
  'PRODUCT_WORK_TURN',
] as const;

export type SkillSourceType = (typeof SKILL_SOURCE_TYPES)[number];
export type SkillRiskLevel = (typeof SKILL_RISK_LEVELS)[number];
export type SkillEvaluationStatus = (typeof SKILL_EVALUATION_STATUSES)[number];
export type SkillReleaseStatus = (typeof SKILL_RELEASE_STATUSES)[number];
export type SkillReleaseScope = (typeof SKILL_RELEASE_SCOPES)[number];

export type SkillReleaseDto = Readonly<{
  id: string;
  skillKey: string;
  displayName: string;
  description: string;
  sourceType: SkillSourceType;
  logicalSource: string;
  version: string;
  contentHash: string;
  license: string | null;
  compatibleHarnesses: readonly string[];
  requiredCapabilities: readonly string[];
  riskLevel: SkillRiskLevel;
  owner: string;
  evaluationStatus: SkillEvaluationStatus;
  enabledScopes: readonly string[];
  contextCost: number | null;
  status: SkillReleaseStatus;
  createdAt: string;
}>;

export type SkillCatalogResponse = Readonly<{
  items: readonly SkillReleaseDto[];
}>;
