import type {
  AgentApprovalDto,
  AgentRunDto,
  AgentRunEventType,
  MutationEvidence,
} from '@pfc/contracts';
import type { BridgeCapabilitySnapshot } from '../../../../packages/protocol/src/index.ts';

export type BridgeRequestContext = Readonly<{
  bridgeId: string;
  credential: string;
  messageId: string;
  nonce: string;
  sentAt: string;
}>;

export type BridgeLeasedCommand = Readonly<{
  commandId: string;
  runId: string;
  commandType: import('../../../../packages/protocol/src/index.ts').BridgeCommandType;
  leaseUntil: string;
  attempt: number;
  afterSequence: number;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface BridgeRuntimeRepositoryPort {
  authenticateMessage(input: {
    bridgeId: string;
    credentialDigest: string;
    messageId: string;
    nonce: string;
    sentAt: string;
    receivedAt: string;
  }): Promise<boolean>;
  recordCapabilitySnapshot(input: {
    id: string;
    bridgeId: string;
    snapshot: BridgeCapabilitySnapshot;
    receivedAt: string;
    expiresAt: string;
  }): Promise<boolean>;
  expireDueApprovals(input: {
    expiredAt: string;
    limit: number;
    idPrefix: string;
  }): Promise<number>;
  leaseNextCommand(input: {
    bridgeId: string;
    leasedAt: string;
    leaseUntil: string;
    eventId: string;
  }): Promise<BridgeLeasedCommand | null>;
  appendEvent(input: {
    id: string;
    commandId: string;
    runId: string;
    expectedSequence: number;
    bridgeId: string;
    sourceEventId: string;
    eventType: AgentRunEventType;
    summary: Readonly<Record<string, string | number | boolean | null>>;
    occurredAt: string;
    receivedAt: string;
  }): Promise<{
    status: 'APPENDED' | 'DUPLICATE' | 'SEQUENCE_GAP' | 'COMMAND_INVALID';
  }>;
  acknowledgeCommand(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
    reasonCode?: string;
    threadId?: string;
    turnId?: string;
    acknowledgedAt: string;
  }): Promise<'ACKNOWLEDGED' | 'IGNORED'>;
  commandOwnsRun(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    executionInstanceId: string;
  }): Promise<boolean>;
  findRun(runId: string): Promise<AgentRunDto | null>;
  createApproval(input: {
    approval: AgentApprovalDto;
    eventId: string;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'CREATED' | 'REPLAYED' | 'CONFLICT';
    approval: AgentApprovalDto | null;
    afterSequence: number | null;
  }>;
  recordCapsule(input: {
    id: string;
    eventId: string;
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
  }): Promise<boolean>;
}
