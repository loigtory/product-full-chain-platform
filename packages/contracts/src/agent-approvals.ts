import type { AgentRunActionKind } from './agent-runs.ts';

export const AGENT_APPROVAL_KINDS = [
  'RUN_START',
  'COMMAND_EXECUTION',
  'FILE_CHANGE',
  'PERMISSIONS',
] as const;

export const AGENT_APPROVAL_DECISIONS = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'REVOKED',
  'CANCELLED',
] as const;

export const AGENT_CONTROL_ACTIONS = [
  'CANCEL',
  'VERIFY_UNKNOWN',
  'RETRY',
] as const;

export type AgentApprovalKind = (typeof AGENT_APPROVAL_KINDS)[number];
export type AgentApprovalDecision = (typeof AGENT_APPROVAL_DECISIONS)[number];
export type AgentControlAction = (typeof AGENT_CONTROL_ACTIONS)[number];

export type AgentApprovalScopeDto = Readonly<{
  allowedRelativePaths: readonly string[];
  allowedActions: readonly AgentRunActionKind[];
  networkAccess: boolean;
  maxChangedFiles: number;
  maxChangedBytes: number;
}>;

export type AgentApprovalDto = Readonly<{
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
  outsideCapsule: boolean;
  approvedScope: AgentApprovalScopeDto | null;
  decision: AgentApprovalDecision;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reasonCode: string | null;
  rowVersion: number;
}>;

export type AgentApprovalDecisionRequest = Readonly<{
  decision: 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approvedScope?: AgentApprovalScopeDto;
  reasonCode: string;
}>;

export type AgentApprovalListResponse = Readonly<{
  items: readonly AgentApprovalDto[];
}>;

export type AgentControlRequest = Readonly<{
  action: AgentControlAction;
  reasonCode: string;
}>;

export type AgentAuditEntryDto = Readonly<{
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  decision: string;
  reason: string | null;
  scopeSummary: Readonly<Record<string, string | number | boolean | null>>;
  occurredAt: string;
}>;
