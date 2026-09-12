export const AGENT_RUN_STATUSES = [
  'QUEUED',
  'STARTING',
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_APPROVAL',
  'CANCELLING',
  'UNKNOWN',
  'VERIFYING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'RETRY_QUEUED',
] as const;

export const AGENT_RUN_OPERATIONS = [
  'ARTIFACT_CHECK',
  'CONTROLLED_ARTIFACT_EDIT',
] as const;
export const AGENT_RUN_ACCESS_MODES = ['READ_ONLY', 'WORKSPACE_WRITE'] as const;
export const AGENT_RUN_RESULT_OUTCOMES = [
  'PASS',
  'WARN',
  'BLOCKED',
  'UNKNOWN',
] as const;
export const AGENT_RUN_ACTION_KINDS = [
  'EDIT_FILES',
  'FORMAT',
  'TEST',
  'BUILD',
] as const;
export const AGENT_RUN_EVENT_TYPES = [
  'RUN_QUEUED',
  'BRIDGE_ASSIGNED',
  'APP_SERVER_INITIALIZED',
  'THREAD_STARTED',
  'TURN_STARTED',
  'AGENT_MESSAGE',
  'COMMAND_STARTED',
  'COMMAND_COMPLETED',
  'WAITING_INPUT',
  'WAITING_APPROVAL',
  'APPROVAL_REQUESTED',
  'APPROVAL_RESOLVED',
  'CANCEL_REQUESTED',
  'TURN_INTERRUPTED',
  'RUN_CANCELLED',
  'VERIFICATION_STARTED',
  'VERIFICATION_COMPLETED',
  'CAPSULE_VERIFIED',
  'BRIDGE_REVOKED',
  'RUN_FAILED',
  'RUN_UNKNOWN',
  'RESULT_RECORDED',
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type AgentRunOperation = (typeof AGENT_RUN_OPERATIONS)[number];
export type AgentRunAccessMode = (typeof AGENT_RUN_ACCESS_MODES)[number];
export type AgentRunResultOutcome = (typeof AGENT_RUN_RESULT_OUTCOMES)[number];
export type AgentRunActionKind = (typeof AGENT_RUN_ACTION_KINDS)[number];
export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[number];

export type AgentRunScopeDto = Readonly<{
  allowedRelativePaths: readonly string[];
  allowedActions: readonly AgentRunActionKind[];
  networkAccess: false;
  maxChangedFiles: number;
  maxChangedBytes: number;
  expiresAt: string;
}>;

export type AgentRunExternalIdsDto = Readonly<{
  threadId: string | null;
  turnId: string | null;
}>;

export type AgentRunDto = Readonly<{
  id: string;
  requirementId: string;
  baselineId: string;
  workspaceId: string;
  gitBaseline: string;
  skillReleaseId: string;
  operation: AgentRunOperation;
  accessMode: AgentRunAccessMode;
  status: AgentRunStatus;
  parentRunId: string | null;
  bridgeId: string | null;
  executionInstanceId: string | null;
  externalIds: AgentRunExternalIdsDto;
  resultOutcome: AgentRunResultOutcome | null;
  runScope: AgentRunScopeDto | null;
  runScopeHash: string | null;
  executionStartedAt: string | null;
  cancelRequestedAt: string | null;
  terminalAt: string | null;
  resultSummary: string | null;
  failureReason: string | null;
  rowVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}>;

export type AgentRunEventDto = Readonly<{
  id: string;
  runId: string;
  sequence: number;
  eventType: AgentRunEventType;
  summary: Readonly<Record<string, string | number | boolean | null>>;
  sourceEventId: string | null;
  occurredAt: string;
  receivedAt: string;
}>;

export type CreateAgentRunRequest = Readonly<{
  baselineId: string;
  workspaceId: string;
  skillKey: string;
  skillVersion: string;
  operation: AgentRunOperation;
  accessMode: AgentRunAccessMode;
  writeScope?: Readonly<{
    allowedRelativePaths: readonly string[];
    allowedActions: readonly AgentRunActionKind[];
    maxChangedFiles: number;
    maxChangedBytes: number;
  }>;
}>;

export type AgentRunLaunchWorkspaceDto = Readonly<{
  id: string;
  name: string;
  repositoryLabel: string;
  gitBaseline: string;
  bridgeId: string;
  lastVerifiedAt: string;
  accessLevel: 'READ' | 'WRITE';
  skillReleaseIds: readonly string[];
}>;

export type AgentRunLaunchOptionsDto = Readonly<{
  requirementId: string;
  baselineId: string;
  artifactSourceRef: string;
  workspaces: readonly AgentRunLaunchWorkspaceDto[];
  skills: readonly import('./skills.ts').SkillReleaseDto[];
}>;

export type AgentRunMutationResponse = Readonly<{
  replayed: boolean;
  run: AgentRunDto;
}>;

export type AgentRunEventsResponse = Readonly<{
  runId: string;
  afterSequence: number;
  nextSequence: number | null;
  items: readonly AgentRunEventDto[];
}>;

export type AgentRunListResponse = Readonly<{
  items: readonly AgentRunDto[];
}>;
