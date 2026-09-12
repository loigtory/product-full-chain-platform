import type {
  AgentRunAccessMode,
  AgentRunExternalIdsDto,
  AgentRunOperation,
  AgentRunResultOutcome,
  AgentRunScopeDto,
  AgentRunStatus,
} from '@pfc/contracts';

export type AgentRun = Readonly<{
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

const terminalStatuses = new Set<AgentRunStatus>([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

const transitions: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> =
  {
    QUEUED: ['STARTING', 'CANCELLED'],
    RETRY_QUEUED: ['STARTING', 'CANCELLED'],
    STARTING: ['RUNNING', 'CANCELLING', 'FAILED', 'UNKNOWN'],
    RUNNING: [
      'WAITING_INPUT',
      'WAITING_APPROVAL',
      'CANCELLING',
      'SUCCEEDED',
      'FAILED',
      'UNKNOWN',
    ],
    WAITING_INPUT: ['RUNNING', 'CANCELLING', 'FAILED', 'UNKNOWN'],
    WAITING_APPROVAL: [
      'QUEUED',
      'RUNNING',
      'CANCELLING',
      'FAILED',
      'CANCELLED',
      'UNKNOWN',
    ],
    CANCELLING: ['CANCELLED', 'UNKNOWN'],
    UNKNOWN: ['VERIFYING'],
    VERIFYING: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'],
    SUCCEEDED: [],
    FAILED: [],
    CANCELLED: [],
  };

function identifier(value: string, code: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

function isoTimestamp(value: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error('INVALID_AGENT_RUN_TIMESTAMP');
  }
  return value;
}

function validateRunScope(
  scope: AgentRunScopeDto,
  createdAt: string,
): AgentRunScopeDto {
  if (scope.networkAccess)
    throw new Error('AGENT_RUN_NETWORK_ACCESS_FORBIDDEN');
  if (
    scope.allowedRelativePaths.length === 0 ||
    scope.allowedActions.length === 0 ||
    !Number.isInteger(scope.maxChangedFiles) ||
    scope.maxChangedFiles < 1 ||
    scope.maxChangedFiles > 100 ||
    !Number.isInteger(scope.maxChangedBytes) ||
    scope.maxChangedBytes < 1 ||
    scope.maxChangedBytes > 10_000_000 ||
    Date.parse(scope.expiresAt) <= Date.parse(createdAt)
  ) {
    throw new Error('INVALID_AGENT_RUN_SCOPE');
  }
  const paths = scope.allowedRelativePaths.map((value) => {
    const normalized = value.trim().replaceAll('\\', '/');
    if (
      !normalized ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized
        .split('/')
        .some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error('INVALID_AGENT_RUN_SCOPE');
    }
    return normalized;
  });
  if (new Set(paths).size !== paths.length) {
    throw new Error('INVALID_AGENT_RUN_SCOPE');
  }
  return { ...scope, allowedRelativePaths: paths };
}

export function createAgentRun(input: {
  id: string;
  requirementId: string;
  baselineId: string;
  workspaceId: string;
  gitBaseline: string;
  skillReleaseId: string;
  operation: AgentRunOperation;
  accessMode: AgentRunAccessMode;
  createdBy: string;
  createdAt: string;
  parentRunId?: string | null;
  executionInstanceId?: string | null;
  runScope?: AgentRunScopeDto | null;
  runScopeHash?: string | null;
}): AgentRun {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(input.gitBaseline.trim())) {
    throw new Error('INVALID_AGENT_RUN_GIT_BASELINE');
  }
  const createdAt = isoTimestamp(input.createdAt);
  const workspaceWrite = input.accessMode === 'WORKSPACE_WRITE';
  if (
    workspaceWrite &&
    (!input.executionInstanceId || !input.runScope || !input.runScopeHash)
  ) {
    throw new Error('AGENT_RUN_SCOPE_REQUIRED');
  }
  if (workspaceWrite && input.operation !== 'CONTROLLED_ARTIFACT_EDIT') {
    throw new Error('AGENT_RUN_OPERATION_ACCESS_MISMATCH');
  }
  if (
    !workspaceWrite &&
    (input.operation !== 'ARTIFACT_CHECK' ||
      input.executionInstanceId ||
      input.runScope ||
      input.runScopeHash)
  ) {
    throw new Error('AGENT_RUN_OPERATION_ACCESS_MISMATCH');
  }
  if (input.runScopeHash && !/^sha256:[a-f\d]{64}$/i.test(input.runScopeHash)) {
    throw new Error('INVALID_AGENT_RUN_SCOPE_HASH');
  }
  const runScope = input.runScope
    ? validateRunScope(input.runScope, createdAt)
    : null;
  return {
    id: identifier(input.id, 'INVALID_AGENT_RUN_ID'),
    requirementId: identifier(
      input.requirementId,
      'INVALID_AGENT_RUN_REQUIREMENT_ID',
    ),
    baselineId: identifier(input.baselineId, 'INVALID_AGENT_RUN_BASELINE_ID'),
    workspaceId: identifier(
      input.workspaceId,
      'INVALID_AGENT_RUN_WORKSPACE_ID',
    ),
    gitBaseline: input.gitBaseline.toLowerCase(),
    skillReleaseId: identifier(
      input.skillReleaseId,
      'INVALID_AGENT_RUN_SKILL_RELEASE_ID',
    ),
    operation: input.operation,
    accessMode: input.accessMode,
    status: workspaceWrite
      ? 'WAITING_APPROVAL'
      : input.parentRunId
        ? 'RETRY_QUEUED'
        : 'QUEUED',
    parentRunId: input.parentRunId ?? null,
    bridgeId: null,
    executionInstanceId: input.executionInstanceId
      ? identifier(
          input.executionInstanceId,
          'INVALID_AGENT_RUN_EXECUTION_INSTANCE_ID',
        )
      : null,
    externalIds: { threadId: null, turnId: null },
    resultOutcome: null,
    runScope,
    runScopeHash: input.runScopeHash?.toLowerCase() ?? null,
    executionStartedAt: null,
    cancelRequestedAt: null,
    terminalAt: null,
    resultSummary: null,
    failureReason: null,
    rowVersion: 0,
    createdBy: identifier(input.createdBy, 'INVALID_AGENT_RUN_ACTOR_ID'),
    createdAt,
    updatedAt: createdAt,
  };
}

export function transitionAgentRun(
  run: AgentRun,
  nextStatus: AgentRunStatus,
  input: {
    occurredAt: string;
    bridgeId?: string;
    externalIds?: Partial<AgentRunExternalIdsDto>;
    resultSummary?: string;
    failureReason?: string;
    resultOutcome?: AgentRunResultOutcome;
  },
): AgentRun {
  if (terminalStatuses.has(run.status)) throw new Error('AGENT_RUN_TERMINAL');
  if (!transitions[run.status].includes(nextStatus)) {
    throw new Error('INVALID_AGENT_RUN_TRANSITION');
  }
  if (nextStatus === 'SUCCEEDED' && !input.resultSummary?.trim()) {
    throw new Error('AGENT_RUN_RESULT_REQUIRED');
  }
  if (
    nextStatus === 'SUCCEEDED' &&
    !['PASS', 'WARN'].includes(input.resultOutcome ?? '')
  ) {
    throw new Error('AGENT_RUN_RESULT_OUTCOME_REQUIRED');
  }
  if (
    ['FAILED', 'UNKNOWN'].includes(nextStatus) &&
    !input.failureReason?.trim()
  ) {
    throw new Error('AGENT_RUN_FAILURE_REASON_REQUIRED');
  }
  return {
    ...run,
    status: nextStatus,
    bridgeId: input.bridgeId
      ? identifier(input.bridgeId, 'INVALID_AGENT_RUN_BRIDGE_ID')
      : run.bridgeId,
    externalIds: {
      threadId: input.externalIds?.threadId ?? run.externalIds.threadId,
      turnId: input.externalIds?.turnId ?? run.externalIds.turnId,
    },
    resultOutcome:
      nextStatus === 'UNKNOWN'
        ? 'UNKNOWN'
        : (input.resultOutcome ?? run.resultOutcome),
    resultSummary: input.resultSummary?.trim() ?? run.resultSummary,
    failureReason: input.failureReason?.trim() ?? run.failureReason,
    rowVersion: run.rowVersion + 1,
    updatedAt: isoTimestamp(input.occurredAt),
    terminalAt: terminalStatuses.has(nextStatus)
      ? isoTimestamp(input.occurredAt)
      : run.terminalAt,
  };
}
