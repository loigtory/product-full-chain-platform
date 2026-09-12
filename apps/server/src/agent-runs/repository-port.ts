import type {
  AgentApprovalDto,
  AgentRunDto,
  AgentRunEventDto,
  MutationEvidence,
  OperationEvidence,
  SensitivityLevel,
  SkillReleaseDto,
  WorkspaceAccessLevel,
  WorkspaceVerificationStatus,
} from '@pfc/contracts';

export type AgentRunCreationContext = Readonly<{
  requirementId: string;
  currentBaselineId: string;
  sensitivity: SensitivityLevel;
  workspaceId: string;
  workspaceVerificationStatus: WorkspaceVerificationStatus;
  workspaceAccessLevel: WorkspaceAccessLevel;
  skillReleaseId: string;
  skillContentHash: string;
  skillEvaluationStatus: 'NOT_EVALUATED' | 'PASSED' | 'FAILED';
  skillEnabled: boolean;
  currentGitBaseline: string;
  artifactVersionId: string;
  artifactSourceRef: string;
  artifactContentHash: string;
}>;

export type AgentRunLaunchContext = Readonly<{
  requirementId: string;
  baselineId: string;
  artifactSourceRef: string;
  sensitivity: SensitivityLevel;
  workspaces: readonly Readonly<{
    id: string;
    name: string;
    repositoryLabel: string;
    gitBaseline: string;
    bridgeId: string;
    lastVerifiedAt: string;
    accessLevel: WorkspaceAccessLevel;
    skillReleaseIds: readonly string[];
  }>[];
  skills: readonly SkillReleaseDto[];
}>;

export interface AgentRunRepositoryPort {
  resolveCreationContext(input: {
    requirementId: string;
    baselineId: string;
    workspaceId: string;
    skillKey: string;
    skillVersion: string;
    operation: import('@pfc/contracts').AgentRunOperation;
    activeAfter: string;
    checkedAt: string;
  }): Promise<AgentRunCreationContext | null>;
  resolveLaunchOptions(input: {
    requirementId: string;
    activeAfter: string;
    checkedAt: string;
  }): Promise<AgentRunLaunchContext | null>;
  createRun(input: {
    run: AgentRunDto;
    event: Omit<AgentRunEventDto, 'runId' | 'sequence'>;
    command: Readonly<{
      id: string;
      commandType: 'START_READ_ONLY_RUN' | 'START_WORKSPACE_WRITE_RUN';
      idempotencyKey: string;
      payload: Readonly<Record<string, unknown>>;
      createdAt: string;
    }> | null;
    startApproval: AgentApprovalDto | null;
    approvalEvidence: OperationEvidence | null;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'CREATED' | 'REPLAYED' | 'CONFLICT';
    run: AgentRunDto | null;
  }>;
  findRun(runId: string): Promise<AgentRunDto | null>;
  findRunSensitivity(runId: string): Promise<SensitivityLevel | null>;
  listRunsForActor(
    actorId: string,
    limit: number,
  ): Promise<readonly AgentRunDto[]>;
  listEvents(
    runId: string,
    afterSequence: number,
    limit: number,
  ): Promise<readonly AgentRunEventDto[]>;
}
