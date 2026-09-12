import type {
  AgentApprovalDto,
  AgentRunDto,
  MutationEvidence,
  SensitivityLevel,
} from '@pfc/contracts';
import type { decideAgentApproval } from '@pfc/domain';

export interface AgentApprovalRepositoryPort {
  findApproval(approvalId: string): Promise<AgentApprovalDto | null>;
  listPendingForActor(input: {
    actorId: string;
    limit: number;
  }): Promise<readonly AgentApprovalDto[]>;
  decideApproval(input: {
    approvalId: string;
    expectedRowVersion: number;
    decision: Parameters<typeof decideAgentApproval>[1];
    eventId: string;
    command: Readonly<{
      id: string;
      idempotencyKey: string;
      payload: Readonly<Record<string, unknown>>;
      runQueuedEventId?: string;
    }>;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'DECIDED' | 'REPLAYED' | 'CONFLICT';
    approval: AgentApprovalDto | null;
  }>;
}

export interface AgentApprovalRunRepositoryPort {
  findRun(runId: string): Promise<AgentRunDto | null>;
  findRunSensitivity(runId: string): Promise<SensitivityLevel | null>;
}
