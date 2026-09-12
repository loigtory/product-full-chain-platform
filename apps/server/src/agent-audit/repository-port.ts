import type {
  AgentAuditEntryDto,
  AgentRunDto,
  SensitivityLevel,
} from '@pfc/contracts';

export interface AgentAuditRepositoryPort {
  findRun(runId: string): Promise<AgentRunDto | null>;
  findRunSensitivity(runId: string): Promise<SensitivityLevel | null>;
  listRunAudit(
    runId: string,
    limit: number,
  ): Promise<readonly AgentAuditEntryDto[]>;
}
