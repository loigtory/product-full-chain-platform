import type {
  ActionProposalDto,
  ContextBindingDto,
  LifecycleStage,
  ProductWorkSessionDto,
  ProductWorkSessionEventDto,
  ProductWorkReadinessBridgeStatus,
  ProductWorkReadinessSkillAvailability,
  ProductWorkTurnDto,
  ProductWorkWorkspaceEvidenceDto,
  ScopedActionAuthorization,
  SensitivityLevel,
  SkillRiskLevel,
} from '@pfc/contracts';

export type WorkSessionAnchor = Readonly<{
  teamId: string;
  requirementId: string;
  requirementName: string;
  requirementVersion: number;
  baselineId: string | null;
  stage: LifecycleStage;
  businessOwnerId: string | null;
  sensitivity: SensitivityLevel;
}>;

export type WorkSessionContextCandidate = Readonly<{
  contextType: 'MATERIAL_REF';
  targetId: string;
  targetVersion: number | null;
  contentHash: string;
  sensitivity: SensitivityLevel;
}>;

export type WorkSessionReadinessContextCandidate = Readonly<{
  materialRefId: string;
  referenceType: string;
  version: string | null;
  sensitivity: SensitivityLevel;
}>;

export type WorkSessionReadinessSkillCandidate = Readonly<{
  releaseId: string;
  displayName: string;
  version: string;
  riskLevel: SkillRiskLevel;
  contextCost: number | null;
  availability: ProductWorkReadinessSkillAvailability;
  disabledReason: string | null;
}>;

export type WorkSessionReadinessCapability = Readonly<{
  bridgeStatus: ProductWorkReadinessBridgeStatus;
  skills: readonly WorkSessionReadinessSkillCandidate[];
}>;

export interface WorkSessionScopedAuthorizationPort {
  grant(authorization: ScopedActionAuthorization): Promise<void>;
  find(authorizationId: string): Promise<ScopedActionAuthorization | null>;
  listCurrent(input: {
    actorId: string;
    requirementId: string;
    at: string;
  }): Promise<readonly ScopedActionAuthorization[]>;
  revoke(input: {
    authorizationId: string;
    expectedRowVersion: number;
    revokedBy: string;
    revokedAt: string;
  }): Promise<ScopedActionAuthorization>;
}

export type ProductWorkTurnCommandInput = Readonly<{
  id: string;
  turnId: string;
  commandType:
    | 'START_PRODUCT_WORK_TURN'
    | 'INTERRUPT_PRODUCT_WORK_TURN'
    | 'VERIFY_PRODUCT_WORK_TURN';
  payloadSummary: Readonly<Record<string, unknown>>;
  requiredCapability: string;
  idempotencyKey: string;
  createdAt: string;
}>;

export interface WorkSessionRepositoryPort {
  resolveSessionAnchor(input: {
    actorId: string;
    requirementId: string;
    teamId?: string;
  }): Promise<WorkSessionAnchor | null>;
  resolveContextCandidates(input: {
    requirementId: string;
    baselineId: string | null;
    targetIds: readonly string[];
  }): Promise<readonly WorkSessionContextCandidate[]>;
  listReadinessContextCandidates(input: {
    requirementId: string;
    baselineId: string | null;
    limit: number;
  }): Promise<readonly WorkSessionReadinessContextCandidate[]>;
  resolveProductWorkReadinessCapability(input: {
    teamId: string;
    at: string;
  }): Promise<WorkSessionReadinessCapability>;
  resolveProductWorkCapability(input: {
    teamId: string;
    skillReleaseId: string;
    at: string;
  }): Promise<Readonly<{ bridgeId: string; skillReleaseId: string }> | null>;
  resolveTargetVersion(
    target: ActionProposalDto['target'],
  ): Promise<number | null>;
  createSession(input: {
    session: ProductWorkSessionDto;
    event: ProductWorkSessionEventDto;
  }): Promise<ProductWorkSessionDto>;
  findSession(sessionId: string): Promise<ProductWorkSessionDto | null>;
  listSessions(
    requirementId: string,
    ownerId: string,
    limit: number,
  ): Promise<readonly ProductWorkSessionDto[]>;
  createTurn(input: {
    turn: ProductWorkTurnDto;
    expectedSessionVersion: number;
    contexts: readonly ContextBindingDto[];
    command: ProductWorkTurnCommandInput;
    event: ProductWorkSessionEventDto;
  }): Promise<ProductWorkTurnDto>;
  findTurnByIdempotencyKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<ProductWorkTurnDto | null>;
  findTurn(turnId: string): Promise<ProductWorkTurnDto | null>;
  listTurns(
    sessionId: string,
    limit: number,
  ): Promise<readonly ProductWorkTurnDto[]>;
  listContexts(sessionId: string): Promise<readonly ContextBindingDto[]>;
  createProposal(input: {
    proposal: ActionProposalDto;
    expectedSessionVersion: number;
    event: ProductWorkSessionEventDto;
  }): Promise<ActionProposalDto>;
  findProposal(proposalId: string): Promise<ActionProposalDto | null>;
  findPendingProposal(sessionId: string): Promise<ActionProposalDto | null>;
  listLinkedAgentRunIds(sessionId: string): Promise<readonly string[]>;
  resolveWorkspaceEvidence(input: {
    teamId: string;
    requirementId: string;
    bridgeId: string | null;
    at: string;
  }): Promise<ProductWorkWorkspaceEvidenceDto>;
  updateSession(input: {
    session: ProductWorkSessionDto;
    expectedRowVersion: number;
    event: ProductWorkSessionEventDto;
  }): Promise<ProductWorkSessionDto>;
  updateTurn(input: {
    turn: ProductWorkTurnDto;
    expectedTurnVersion: number;
    expectedSessionVersion: number;
    command: ProductWorkTurnCommandInput;
    event: ProductWorkSessionEventDto;
  }): Promise<ProductWorkTurnDto>;
  updateProposal(input: {
    proposal: ActionProposalDto;
    expectedProposalVersion: number;
    expectedSessionVersion: number;
    event: ProductWorkSessionEventDto;
  }): Promise<ActionProposalDto>;
  listEvents(
    sessionId: string,
    afterSequence: number,
    limit: number,
  ): Promise<
    Readonly<{
      reloadRequired: boolean;
      items: readonly ProductWorkSessionEventDto[];
    }>
  >;
}
