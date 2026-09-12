import type {
  AgentApprovalKind,
  AgentApprovalScopeDto,
  AgentRunEventType,
} from '../../../packages/contracts/src/index.ts';
import type { BridgeCapabilitySnapshot } from '../../../packages/protocol/src/index.ts';

export type BridgeAgentEvent = Readonly<{
  eventType: AgentRunEventType;
  summary: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type BridgeRunnerResult = Readonly<{
  threadId: string;
  turnId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  reasonCode?: string;
}>;

export interface AgentRunnerPort {
  runReadonly(
    input: Readonly<{
      workspacePath: string;
      objective: string;
      skill: Readonly<{ name: string; path: string }>;
    }>,
    onEvent: (event: BridgeAgentEvent) => void | Promise<void>,
  ): Promise<BridgeRunnerResult>;
  close?(): Promise<void>;
}

export interface BridgeGatewayPort {
  claimNext(input: {
    bridgeId: string;
    leaseSeconds: number;
  }): Promise<unknown | null>;
  submitEvent(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    sourceEventId: string;
    expectedSequence: number;
    event: BridgeAgentEvent;
    occurredAt: string;
  }): Promise<{ status: 'APPENDED' | 'DUPLICATE' | 'SEQUENCE_GAP' }>;
  acknowledge(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
    reasonCode?: string;
    threadId?: string;
    turnId?: string;
    acknowledgedAt: string;
  }): Promise<void>;
  reportCapabilities(input: {
    bridgeId: string;
    snapshot: BridgeCapabilitySnapshot;
  }): Promise<void>;
  submitApproval(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    executionInstanceId: string;
    appServerRequestId: string;
    threadId: string;
    turnId: string;
    itemId: string;
    callbackId: string | null;
    kind: AgentApprovalKind;
    requestedScope: AgentApprovalScopeDto;
    outsideCapsule: boolean;
    requestedAt: string;
  }): Promise<{ afterSequence: number }>;
  reportCapsule(input: {
    bridgeId: string;
    runId: string;
    executionInstanceId: string;
    sourceGitBaseline: string;
    scopeHash: string;
    beforeManifestHash: string;
    afterManifestHash: string | null;
    lifecycle: 'MATERIALIZED' | 'VERIFIED' | 'UNKNOWN';
    diffSummary: Readonly<{
      changedFiles: number;
      changedBytes: number;
      changedPaths: readonly string[];
    }> | null;
    occurredAt: string;
  }): Promise<void>;
}

export interface BridgeLocalRegistryPort {
  resolveWorkspace(workspaceId: string): Promise<{
    path: string;
    verified: boolean;
    allowedRelativePath: string;
  } | null>;
  resolveSkill(skillReleaseId: string): Promise<{
    name: string;
    path: string;
    contentHash: string;
    enabled: boolean;
  } | null>;
}

export interface WorkspaceInspectorPort {
  currentGitBaseline(workspacePath: string): Promise<string>;
}

export interface ArtifactInspectorPort {
  inspectWithinScope(input: {
    workspacePath: string;
    scopePath: string;
    artifactPath: string;
  }): Promise<
    | { status: 'VERIFIED'; contentHash: string }
    | { status: 'OUTSIDE_SCOPE' }
    | { status: 'UNREADABLE' }
  >;
}

export interface PairingWorkspaceInspectorPort extends WorkspaceInspectorPort {
  repositoryFingerprint(workspacePath: string): Promise<string>;
}
