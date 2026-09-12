import type {
  AgentApprovalDecision,
  AgentApprovalDto,
  AgentApprovalKind,
  AgentApprovalScopeDto,
} from '@pfc/contracts';

import { assertAllowedRelativePath } from './workspace.ts';

function identifier(value: string, code: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/.test(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

function timestamp(value: string, code: string): string {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(code);
  return value;
}

function normalizeScope(scope: AgentApprovalScopeDto): AgentApprovalScopeDto {
  if (
    scope.allowedRelativePaths.length === 0 ||
    scope.allowedActions.length === 0 ||
    !Number.isInteger(scope.maxChangedFiles) ||
    scope.maxChangedFiles < 1 ||
    !Number.isInteger(scope.maxChangedBytes) ||
    scope.maxChangedBytes < 1
  ) {
    throw new Error('INVALID_AGENT_APPROVAL_SCOPE');
  }
  const paths = scope.allowedRelativePaths.map(assertAllowedRelativePath);
  if (
    new Set(paths).size !== paths.length ||
    new Set(scope.allowedActions).size !== scope.allowedActions.length
  ) {
    throw new Error('INVALID_AGENT_APPROVAL_SCOPE');
  }
  return { ...scope, allowedRelativePaths: paths };
}

function scopeIsSubset(
  approved: AgentApprovalScopeDto,
  requested: AgentApprovalScopeDto,
): boolean {
  return (
    !approved.networkAccess &&
    approved.allowedRelativePaths.every((path) =>
      requested.allowedRelativePaths.includes(path),
    ) &&
    approved.allowedActions.every((action) =>
      requested.allowedActions.includes(action),
    ) &&
    approved.maxChangedFiles <= requested.maxChangedFiles &&
    approved.maxChangedBytes <= requested.maxChangedBytes
  );
}

export function createAgentApproval(input: {
  id: string;
  runId: string;
  executionInstanceId: string;
  appServerRequestId: string | null;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  callbackId: string | null;
  kind: AgentApprovalKind;
  requestedScope: AgentApprovalScopeDto;
  scopeHash: string;
  outsideCapsule?: boolean;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
}): AgentApprovalDto {
  const runStart = input.kind === 'RUN_START';
  const appIdentity = [
    input.appServerRequestId,
    input.threadId,
    input.turnId,
    input.itemId,
  ];
  if (
    (runStart &&
      [...appIdentity, input.callbackId].some((value) => value !== null)) ||
    (!runStart &&
      appIdentity.some(
        (value) => typeof value !== 'string' || value.trim().length === 0,
      ))
  ) {
    throw new Error('INVALID_AGENT_APPROVAL_APP_IDENTITY');
  }
  const requestedAt = timestamp(
    input.requestedAt,
    'INVALID_AGENT_APPROVAL_TIMESTAMP',
  );
  const expiresAt = timestamp(
    input.expiresAt,
    'INVALID_AGENT_APPROVAL_TIMESTAMP',
  );
  if (Date.parse(expiresAt) <= Date.parse(requestedAt)) {
    throw new Error('INVALID_AGENT_APPROVAL_EXPIRY');
  }
  return {
    id: identifier(input.id, 'INVALID_AGENT_APPROVAL_ID'),
    runId: identifier(input.runId, 'INVALID_AGENT_APPROVAL_RUN_ID'),
    executionInstanceId: identifier(
      input.executionInstanceId,
      'INVALID_AGENT_APPROVAL_EXECUTION_ID',
    ),
    appServerRequestId: input.appServerRequestId?.trim() ?? null,
    threadId: input.threadId?.trim() ?? null,
    turnId: input.turnId?.trim() ?? null,
    itemId: input.itemId?.trim() ?? null,
    callbackId: input.callbackId?.trim() || null,
    kind: input.kind,
    requestedScope: normalizeScope(input.requestedScope),
    scopeHash: (() => {
      const normalized = input.scopeHash.trim().toLowerCase();
      if (!/^sha256:[a-f\d]{64}$/.test(normalized)) {
        throw new Error('INVALID_AGENT_APPROVAL_SCOPE_HASH');
      }
      return normalized;
    })(),
    outsideCapsule: input.outsideCapsule ?? false,
    approvedScope: null,
    decision: 'PENDING',
    requestedBy: identifier(
      input.requestedBy,
      'INVALID_AGENT_APPROVAL_REQUESTER',
    ),
    requestedAt,
    expiresAt,
    decidedBy: null,
    decidedAt: null,
    reasonCode: null,
    rowVersion: 0,
  };
}

export function decideAgentApproval(
  approval: AgentApprovalDto,
  input: {
    decision: Extract<
      AgentApprovalDecision,
      'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REVOKED'
    >;
    approvedScope?: AgentApprovalScopeDto;
    decidedBy: string;
    decidedAt: string;
    reasonCode: string;
  },
): AgentApprovalDto {
  if (approval.decision !== 'PENDING') {
    throw new Error('AGENT_APPROVAL_TERMINAL');
  }
  const decidedAt = timestamp(
    input.decidedAt,
    'INVALID_AGENT_APPROVAL_TIMESTAMP',
  );
  if (Date.parse(decidedAt) > Date.parse(approval.expiresAt)) {
    throw new Error('AGENT_APPROVAL_EXPIRED');
  }
  if (
    input.decision === 'APPROVED' &&
    input.decidedBy === approval.requestedBy
  ) {
    throw new Error('AGENT_APPROVAL_FOUR_EYES_REQUIRED');
  }
  const approvedScope = input.approvedScope
    ? normalizeScope(input.approvedScope)
    : null;
  if (input.decision === 'APPROVED') {
    if (approval.outsideCapsule) {
      throw new Error('AGENT_APPROVAL_OUTSIDE_CAPSULE');
    }
    if (!approvedScope) throw new Error('AGENT_APPROVAL_SCOPE_REQUIRED');
    if (approvedScope.networkAccess) {
      throw new Error('AGENT_APPROVAL_NETWORK_FORBIDDEN');
    }
    if (!scopeIsSubset(approvedScope, approval.requestedScope)) {
      throw new Error('AGENT_APPROVAL_SCOPE_EXPANSION');
    }
    if (
      approval.kind === 'RUN_START' &&
      !scopeIsSubset(approval.requestedScope, approvedScope)
    ) {
      throw new Error('AGENT_APPROVAL_RUN_START_SCOPE_MISMATCH');
    }
  } else if (approvedScope) {
    throw new Error('AGENT_APPROVAL_SCOPE_NOT_ALLOWED');
  }
  return {
    ...approval,
    decision: input.decision,
    approvedScope,
    decidedBy: identifier(input.decidedBy, 'INVALID_AGENT_APPROVAL_DECIDER'),
    decidedAt,
    reasonCode: identifier(input.reasonCode, 'INVALID_AGENT_APPROVAL_REASON'),
    rowVersion: approval.rowVersion + 1,
  };
}

export function expireAgentApproval(
  approval: AgentApprovalDto,
  expiredAt: string,
): AgentApprovalDto {
  if (approval.decision !== 'PENDING') {
    throw new Error('AGENT_APPROVAL_TERMINAL');
  }
  const decidedAt = timestamp(expiredAt, 'INVALID_AGENT_APPROVAL_TIMESTAMP');
  if (Date.parse(decidedAt) <= Date.parse(approval.expiresAt)) {
    throw new Error('AGENT_APPROVAL_NOT_EXPIRED');
  }
  return {
    ...approval,
    decision: 'EXPIRED',
    decidedAt,
    reasonCode: 'APPROVAL_EXPIRED',
    rowVersion: approval.rowVersion + 1,
  };
}
