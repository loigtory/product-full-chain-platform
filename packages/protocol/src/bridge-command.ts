import type { AgentApprovalScopeDto, AgentRunScopeDto } from '@pfc/contracts';

export const BRIDGE_COMMAND_TYPES = [
  'START_READ_ONLY_RUN',
  'START_WORKSPACE_WRITE_RUN',
  'RESOLVE_APPROVAL',
  'INTERRUPT_RUN',
  'VERIFY_RUN_STATE',
] as const;

export type BridgeCommandType = (typeof BRIDGE_COMMAND_TYPES)[number];

export type StartReadonlyRunPayload = Readonly<{
  requirementId: string;
  baselineId: string;
  workspaceId: string;
  gitBaseline: string;
  skillReleaseId: string;
  skillContentHash: string;
  artifactVersionId: string;
  artifactSourceRef: string;
  artifactContentHash: string;
  objectiveKey: 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK';
  accessMode: 'READ_ONLY';
}>;

export type StartWorkspaceWriteRunPayload = Readonly<{
  requirementId: string;
  baselineId: string;
  workspaceId: string;
  gitBaseline: string;
  skillReleaseId: string;
  skillContentHash: string;
  artifactVersionId: string;
  artifactSourceRef: string;
  artifactContentHash: string;
  executionInstanceId: string;
  runScope: AgentRunScopeDto;
  runScopeHash: string;
  objectiveKey: 'CONTROLLED_ARTIFACT_EDIT';
  accessMode: 'WORKSPACE_WRITE';
}>;

export type ResolveApprovalPayload = Readonly<{
  executionInstanceId: string;
  approvalId: string;
  appServerRequestId: string;
  approvalKind: 'COMMAND_EXECUTION' | 'FILE_CHANGE' | 'PERMISSIONS';
  decision: 'accept' | 'decline' | 'cancel';
  grantedScope?: AgentApprovalScopeDto;
}>;

export type InterruptRunPayload = Readonly<{
  executionInstanceId: string;
  threadId: string | null;
  turnId: string | null;
}>;

export type VerifyRunStatePayload = Readonly<{
  executionInstanceId: string;
}>;

type BridgeCommandBase = Readonly<{
  commandId: string;
  runId: string;
  leaseUntil: string;
  attempt: number;
  afterSequence: number;
}>;

export type BridgeCommand = BridgeCommandBase &
  (
    | Readonly<{
        commandType: 'START_READ_ONLY_RUN';
        payload: StartReadonlyRunPayload;
      }>
    | Readonly<{
        commandType: 'START_WORKSPACE_WRITE_RUN';
        payload: StartWorkspaceWriteRunPayload;
      }>
    | Readonly<{
        commandType: 'RESOLVE_APPROVAL';
        payload: ResolveApprovalPayload;
      }>
    | Readonly<{
        commandType: 'INTERRUPT_RUN';
        payload: InterruptRunPayload;
      }>
    | Readonly<{
        commandType: 'VERIFY_RUN_STATE';
        payload: VerifyRunStatePayload;
      }>
  );

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string,
): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    throw new Error(code);
  }
}

function boundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error(`BRIDGE_COMMAND_${field}_INVALID`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`BRIDGE_COMMAND_${field}_INVALID`);
  }
  return value as number;
}

function workspaceRelativePath(value: unknown, field: string): string {
  const candidate = boundedString(value, field);
  if (
    candidate.startsWith('/') ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.includes('\\') ||
    candidate
      .split('/')
      .some((segment) => !segment || segment === '..' || segment === '.')
  ) {
    throw new Error(`BRIDGE_COMMAND_${field}_INVALID`);
  }
  return candidate;
}

function contentHash(value: unknown, field: string): string {
  const hash = boundedString(value, field);
  if (!/^(?:sha256:)?[a-f\d]{64}$/i.test(hash)) {
    throw new Error(`BRIDGE_COMMAND_${field}_INVALID`);
  }
  return hash;
}

function commonStartPayload(value: Record<string, unknown>): void {
  boundedString(value.requirementId, 'REQUIREMENT_ID');
  boundedString(value.baselineId, 'BASELINE_ID');
  boundedString(value.workspaceId, 'WORKSPACE_ID');
  const gitBaseline = boundedString(value.gitBaseline, 'GIT_BASELINE');
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(gitBaseline)) {
    throw new Error('BRIDGE_COMMAND_GIT_BASELINE_INVALID');
  }
  boundedString(value.skillReleaseId, 'SKILL_RELEASE_ID');
  contentHash(value.skillContentHash, 'SKILL_CONTENT_HASH');
  boundedString(value.artifactVersionId, 'ARTIFACT_VERSION_ID');
  workspaceRelativePath(value.artifactSourceRef, 'ARTIFACT_SOURCE_REF');
  contentHash(value.artifactContentHash, 'ARTIFACT_CONTENT_HASH');
}

function parseRunScope(value: unknown): AgentRunScopeDto {
  if (!record(value)) throw new Error('BRIDGE_COMMAND_RUN_SCOPE_INVALID');
  exactFields(
    value,
    [
      'allowedRelativePaths',
      'allowedActions',
      'networkAccess',
      'maxChangedFiles',
      'maxChangedBytes',
      'expiresAt',
    ],
    'BRIDGE_COMMAND_RUN_SCOPE_FIELDS_INVALID',
  );
  if (value.networkAccess !== false) {
    throw new Error('BRIDGE_COMMAND_NETWORK_ACCESS_FORBIDDEN');
  }
  if (
    !Array.isArray(value.allowedRelativePaths) ||
    value.allowedRelativePaths.length === 0 ||
    value.allowedRelativePaths.length > 100 ||
    !Array.isArray(value.allowedActions) ||
    value.allowedActions.length === 0 ||
    !value.allowedActions.every((action) =>
      ['EDIT_FILES', 'FORMAT', 'TEST', 'BUILD'].includes(String(action)),
    )
  ) {
    throw new Error('BRIDGE_COMMAND_RUN_SCOPE_INVALID');
  }
  for (const relativePath of value.allowedRelativePaths) {
    workspaceRelativePath(relativePath, 'RUN_SCOPE_PATH');
  }
  const maxChangedFiles = nonNegativeInteger(
    value.maxChangedFiles,
    'MAX_CHANGED_FILES',
  );
  const maxChangedBytes = nonNegativeInteger(
    value.maxChangedBytes,
    'MAX_CHANGED_BYTES',
  );
  if (!maxChangedFiles || !maxChangedBytes) {
    throw new Error('BRIDGE_COMMAND_RUN_SCOPE_INVALID');
  }
  const expiresAt = boundedString(value.expiresAt, 'RUN_SCOPE_EXPIRES_AT');
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new Error('BRIDGE_COMMAND_RUN_SCOPE_INVALID');
  }
  return value as unknown as AgentRunScopeDto;
}

function parseApprovalScope(value: unknown): AgentApprovalScopeDto {
  if (!record(value)) throw new Error('BRIDGE_COMMAND_APPROVAL_SCOPE_INVALID');
  parseRunScope({
    ...value,
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
  return value as unknown as AgentApprovalScopeDto;
}

function parsePayload(
  commandType: BridgeCommandType,
  value: Record<string, unknown>,
): void {
  if (commandType === 'START_READ_ONLY_RUN') {
    exactFields(
      value,
      [
        'requirementId',
        'baselineId',
        'workspaceId',
        'gitBaseline',
        'skillReleaseId',
        'skillContentHash',
        'artifactVersionId',
        'artifactSourceRef',
        'artifactContentHash',
        'objectiveKey',
        'accessMode',
      ],
      'BRIDGE_COMMAND_PAYLOAD_FIELDS_INVALID',
    );
    commonStartPayload(value);
    if (value.accessMode !== 'READ_ONLY') {
      throw new Error('BRIDGE_R1_READ_ONLY_REQUIRED');
    }
    if (value.objectiveKey !== 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK') {
      throw new Error('BRIDGE_COMMAND_OBJECTIVE_UNSUPPORTED');
    }
    return;
  }
  if (commandType === 'START_WORKSPACE_WRITE_RUN') {
    exactFields(
      value,
      [
        'requirementId',
        'baselineId',
        'workspaceId',
        'gitBaseline',
        'skillReleaseId',
        'skillContentHash',
        'artifactVersionId',
        'artifactSourceRef',
        'artifactContentHash',
        'executionInstanceId',
        'runScope',
        'runScopeHash',
        'objectiveKey',
        'accessMode',
      ],
      'BRIDGE_COMMAND_PAYLOAD_FIELDS_INVALID',
    );
    commonStartPayload(value);
    boundedString(value.executionInstanceId, 'EXECUTION_INSTANCE_ID');
    parseRunScope(value.runScope);
    contentHash(value.runScopeHash, 'RUN_SCOPE_HASH');
    if (
      value.accessMode !== 'WORKSPACE_WRITE' ||
      value.objectiveKey !== 'CONTROLLED_ARTIFACT_EDIT'
    ) {
      throw new Error('BRIDGE_COMMAND_WRITE_CONTEXT_INVALID');
    }
    return;
  }
  if (commandType === 'RESOLVE_APPROVAL') {
    const expected = [
      'executionInstanceId',
      'approvalId',
      'appServerRequestId',
      'approvalKind',
      'decision',
      ...(value.grantedScope === undefined ? [] : ['grantedScope']),
    ];
    exactFields(value, expected, 'BRIDGE_COMMAND_PAYLOAD_FIELDS_INVALID');
    boundedString(value.executionInstanceId, 'EXECUTION_INSTANCE_ID');
    boundedString(value.approvalId, 'APPROVAL_ID');
    boundedString(value.appServerRequestId, 'APP_SERVER_REQUEST_ID');
    if (
      !['COMMAND_EXECUTION', 'FILE_CHANGE', 'PERMISSIONS'].includes(
        String(value.approvalKind),
      )
    ) {
      throw new Error('BRIDGE_COMMAND_APPROVAL_KIND_INVALID');
    }
    if (!['accept', 'decline', 'cancel'].includes(String(value.decision))) {
      throw new Error('BRIDGE_COMMAND_APPROVAL_DECISION_INVALID');
    }
    if (value.grantedScope !== undefined)
      parseApprovalScope(value.grantedScope);
    return;
  }
  if (commandType === 'INTERRUPT_RUN') {
    exactFields(
      value,
      ['executionInstanceId', 'threadId', 'turnId'],
      'BRIDGE_COMMAND_PAYLOAD_FIELDS_INVALID',
    );
    boundedString(value.executionInstanceId, 'EXECUTION_INSTANCE_ID');
    if (value.threadId !== null) boundedString(value.threadId, 'THREAD_ID');
    if (value.turnId !== null) boundedString(value.turnId, 'TURN_ID');
    return;
  }
  exactFields(
    value,
    ['executionInstanceId'],
    'BRIDGE_COMMAND_PAYLOAD_FIELDS_INVALID',
  );
  boundedString(value.executionInstanceId, 'EXECUTION_INSTANCE_ID');
}

export function parseBridgeCommand(value: unknown): BridgeCommand {
  if (!record(value)) throw new Error('BRIDGE_COMMAND_INVALID');
  exactFields(
    value,
    [
      'commandId',
      'runId',
      'commandType',
      'leaseUntil',
      'attempt',
      'afterSequence',
      'payload',
    ],
    'BRIDGE_COMMAND_FIELDS_INVALID',
  );
  if (!BRIDGE_COMMAND_TYPES.includes(value.commandType as BridgeCommandType)) {
    throw new Error('BRIDGE_COMMAND_TYPE_UNSUPPORTED');
  }
  if (!record(value.payload)) throw new Error('BRIDGE_COMMAND_PAYLOAD_INVALID');
  boundedString(value.commandId, 'ID');
  boundedString(value.runId, 'RUN_ID');
  const leaseUntil = boundedString(value.leaseUntil, 'LEASE_UNTIL');
  if (Number.isNaN(Date.parse(leaseUntil))) {
    throw new Error('BRIDGE_COMMAND_LEASE_UNTIL_INVALID');
  }
  const attempt = nonNegativeInteger(value.attempt, 'ATTEMPT');
  if (attempt < 1) throw new Error('BRIDGE_COMMAND_ATTEMPT_INVALID');
  nonNegativeInteger(value.afterSequence, 'AFTER_SEQUENCE');
  parsePayload(value.commandType as BridgeCommandType, value.payload);
  return value as unknown as BridgeCommand;
}
