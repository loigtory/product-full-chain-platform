import type { SensitivityLevel } from './lifecycle.ts';

export const EXECUTION_EVIDENCE_SOURCE_TYPES = [
  'AGENT_RUN_RESULT',
  'PRODUCT_WORK_TURN_RESULT',
  'MCP_READ_RESULT',
  'REVIEW_RESULT',
  'TEST_RESULT',
] as const;
export const EXECUTION_EVIDENCE_OUTCOMES = [
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
] as const;
export const MCP_CAPABILITY_EFFECTS = ['READ_ONLY'] as const;
export const MCP_CAPABILITY_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
] as const;
export const MCP_READ_STATUSES = [
  'REQUESTED',
  'QUEUED',
  'LEASED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'UNKNOWN',
] as const;

export type ExecutionEvidenceSourceType =
  (typeof EXECUTION_EVIDENCE_SOURCE_TYPES)[number];
export type ExecutionEvidenceOutcome =
  (typeof EXECUTION_EVIDENCE_OUTCOMES)[number];
export type McpCapabilityEffect = (typeof MCP_CAPABILITY_EFFECTS)[number];
export type McpCapabilityStatus = (typeof MCP_CAPABILITY_STATUSES)[number];
export type McpReadStatus = (typeof MCP_READ_STATUSES)[number];

export type ExecutionEvidenceDto = Readonly<{
  schemaVersion: 'execution-evidence/1';
  id: string;
  requirementId: string;
  baselineId: string;
  sourceType: ExecutionEvidenceSourceType;
  sourceId: string;
  outcome: ExecutionEvidenceOutcome;
  safeSummary: string;
  contentHash: string;
  sensitivity: SensitivityLevel;
  artifactVersionId: string | null;
  gateRunId: string | null;
  retentionClass: 'PRODUCT_FACT' | 'GATE_EVIDENCE';
  createdAt: string;
}>;

export type McpCapabilityRegistrationDto = Readonly<{
  schemaVersion: 'mcp-capability-registration/1';
  id: string;
  logicalCapabilityId: string;
  serverName: string;
  toolName: string;
  inputSchemaHash: string;
  configFingerprint: string;
  effect: McpCapabilityEffect;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  maxInputBytes: number;
  maxOutputBytes: number;
  timeoutMs: number;
  allowedTeamIds: readonly string[];
  allowedRequirementIds: readonly string[];
  status: McpCapabilityStatus;
  reviewedBy: string;
  reviewedAt: string;
  reviewEvidenceRef: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}>;

export type McpReadRequestDto = Readonly<{
  schemaVersion: 'mcp-read-request/1';
  id: string;
  sessionId: string;
  turnId: string;
  requirementId: string;
  teamId: string;
  capabilityId: string;
  logicalCapabilityId: string;
  artifactVersionId: string;
  inputHash: string;
  sensitivity: SensitivityLevel;
  status: McpReadStatus;
  bridgeId: string | null;
  externalThreadId: string | null;
  outputSummary: string | null;
  outputHash: string | null;
  outputBytes: number | null;
  outputTruncated: boolean;
  durationMs: number | null;
  evidenceId: string | null;
  failureReason: string | null;
  recoveryAction: string | null;
  rowVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
}>;

export type McpCapabilityListResponse = Readonly<{
  items: readonly McpCapabilityPublicDto[];
}>;

export type McpCapabilityPublicDto = Readonly<{
  schemaVersion: 'mcp-capability-public/1';
  logicalCapabilityId: string;
  effect: McpCapabilityEffect;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  maxInputBytes: number;
  maxOutputBytes: number;
  timeoutMs: number;
  status: McpCapabilityStatus;
}>;

export type ExecutionEvidenceListResponse = Readonly<{
  items: readonly ExecutionEvidenceDto[];
  nextCursor: string | null;
}>;

export type McpReadRequestListResponse = Readonly<{
  items: readonly McpReadRequestDto[];
}>;

export type CreateMcpReadRequest = Readonly<{
  schemaVersion: 'create-mcp-read-request/1';
  turnId: string;
  logicalCapabilityId: string;
  artifactVersionId: string;
  input: Readonly<Record<string, unknown>>;
  sensitivity: SensitivityLevel;
  materialRefIds: readonly string[];
}>;
