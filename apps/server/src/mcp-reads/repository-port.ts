import type {
  ExecutionEvidenceDto,
  ExecutionEvidenceSourceType,
  McpCapabilityRegistrationDto,
  McpReadRequestDto,
  MutationEvidence,
} from '@pfc/contracts';
import type {
  McpReadCommand,
  McpReadContext,
  McpReadEvent,
} from '@pfc/protocol';

export interface ExecutionEvidenceRepositoryPort {
  list(input: {
    requirementId: string;
    sourceType?: ExecutionEvidenceSourceType;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: readonly ExecutionEvidenceDto[];
    nextCursor: string | null;
  }>;
}

export interface McpReadRepositoryPort {
  findSessionContext(
    sessionId: string,
    turnId: string,
  ): Promise<Readonly<{
    session_id: string;
    requirement_id: string;
    team_id: string;
    opened_baseline_id: string | null;
    session_status: string;
    session_row_version: number;
    last_sequence: number;
    turn_id: string;
    turn_status: string;
  }> | null>;
  findCapability(
    logicalCapabilityId: string,
  ): Promise<McpCapabilityRegistrationDto | null>;
  evidenceTargetBelongsToRequirement(input: {
    artifactVersionId: string;
    requirementId: string;
  }): Promise<boolean>;
  listCapabilities(input: {
    requirementId: string;
    teamIds: readonly string[];
  }): Promise<readonly McpCapabilityRegistrationDto[]>;
  resolveRuntime(input: {
    capability: McpCapabilityRegistrationDto;
    teamId: string;
    at: string;
  }): Promise<Readonly<{
    bridgeId: string;
    state: 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED';
    serverName: string;
    toolName: string;
    inputSchemaHash: string;
    configFingerprint: string;
    runtimeStatus: 'CONNECTED' | 'UNAVAILABLE' | 'UNVERIFIED';
    authStatus: 'UNKNOWN' | 'UNSUPPORTED' | 'READY' | 'REQUIRED';
    readOnlyHint: boolean | null;
  }> | null>;
  countActiveRequests(sessionId: string): Promise<number>;
  findIdempotentRequest(input: {
    actorId: string;
    route: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<
    | { status: 'REPLAYED'; request: McpReadRequestDto }
    | { status: 'CONFLICT' | 'UNKNOWN'; request: null }
    | null
  >;
  createRequest(input: {
    request: McpReadRequestDto;
    rawInput: Readonly<Record<string, unknown>>;
    materialRefIds: readonly string[];
    commandId: string;
    expectedSessionVersion: number;
    evidence: MutationEvidence;
  }): Promise<{
    status: 'CREATED' | 'REPLAYED' | 'CONFLICT' | 'VERSION_CONFLICT';
    request: McpReadRequestDto | null;
  }>;
  findRequest(requestId: string): Promise<McpReadRequestDto | null>;
  listRequests(sessionId: string): Promise<readonly McpReadRequestDto[]>;
  leaseNextCommand(input: {
    bridgeId: string;
    leasedAt: string;
    leaseUntil: string;
  }): Promise<McpReadCommand | null>;
  readLeasedContext(input: {
    bridgeId: string;
    commandId: string;
    readAt: string;
  }): Promise<McpReadContext | null>;
  appendEvent(input: {
    bridgeId: string;
    commandId: string;
    event: McpReadEvent;
    receivedAt: string;
    sessionEventId: string;
    evidenceId: string;
    operation: Omit<
      MutationEvidence,
      'aggregateId' | 'aggregateVersion' | 'occurredAt'
    >;
  }): Promise<'APPENDED' | 'DUPLICATE' | 'COMMAND_INVALID'>;
}
