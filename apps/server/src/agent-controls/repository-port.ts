import type {
  AgentControlAction,
  AgentRunDto,
  MutationEvidence,
  SensitivityLevel,
} from '@pfc/contracts';

export interface AgentControlRepositoryPort {
  findRun(runId: string): Promise<AgentRunDto | null>;
  findRunSensitivity(runId: string): Promise<SensitivityLevel | null>;
  controlRun(input: {
    action: AgentControlAction;
    runId: string;
    expectedRowVersion: number;
    reasonCode: string;
    actorId: string;
    occurredAt: string;
    commandId: string;
    eventIdPrefix: string;
    childRunId: string;
    childExecutionInstanceId: string;
    childScopeExpiresAt: string;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'APPLIED' | 'REPLAYED' | 'CONFLICT';
    run: AgentRunDto | null;
    childRun: AgentRunDto | null;
  }>;
  findBridge(bridgeId: string): Promise<{
    id: string;
    teamId: string;
    status: 'OFFLINE' | 'ONLINE' | 'DEGRADED' | 'REVOKED';
    activeRunCount: number;
  } | null>;
  revokeBridge(input: {
    bridgeId: string;
    actorId: string;
    reasonCode: string;
    expectedActiveRunCount: number;
    occurredAt: string;
    commandIdPrefix: string;
    eventIdPrefix: string;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'REVOKED' | 'REPLAYED' | 'CONFLICT';
    affectedRunCount: number;
  }>;
}
