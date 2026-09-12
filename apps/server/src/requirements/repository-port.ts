import type { GateRunResult, SensitivityLevel } from '@pfc/contracts';
import type {
  Decision,
  GateCheck,
  GateRun,
  GateRunEvidence,
  IdempotencyRecord,
  EvidenceRef,
  MaterialBaseline,
  MaterialImpactAssessment,
  OutboxEvent,
  Question,
  Requirement,
  StageAdvancement,
  TimelineEvent,
} from '@pfc/domain';

export type RequirementListCandidate = Readonly<{
  id: string;
  name: string;
  initiatorId: string;
  businessOwnerId: string | null;
  currentStage: Requirement['currentStage'];
  currentBaselineId: string | null;
  rowVersion: number;
  sensitivity: SensitivityLevel;
  updatedAt: string;
}>;

export type RequirementRecord = Readonly<{
  requirement: Requirement;
  currentBaseline: MaterialBaseline | null;
}>;

export type QuestionRecord = Readonly<{
  question: Question;
  decisions: readonly Decision[];
}>;

export type GateRunRecord = Readonly<{
  gateRun: GateRun;
  checks: readonly GateCheck[];
  evidence: readonly GateRunEvidence[];
  advancement: StageAdvancement | null;
}>;

export type SequencedTimelineEvent = Readonly<{
  sequence: number;
  event: TimelineEvent;
}>;

export type CreateMaterialImpactWrite = Readonly<{
  requirementId: string;
  expectedCurrentBaselineId: string;
  candidateBaseline: MaterialBaseline;
  assessment: MaterialImpactAssessment;
  timelineEvent: TimelineEvent;
  outboxEvent: OutboxEvent;
}>;

export type ConfirmMaterialImpactWrite = Readonly<{
  requirement: Requirement;
  previousRowVersion: number;
  previousBaseline: MaterialBaseline;
  currentBaseline: MaterialBaseline;
  assessment: MaterialImpactAssessment;
  invalidatedGateRunIds: readonly string[];
  timelineEvent: TimelineEvent;
  outboxEvent: OutboxEvent;
}>;

export type IdempotentMaterialImpactCommand<TWrite> = Readonly<{
  write: TWrite;
  idempotency: IdempotencyRecord;
}>;

export type RequirementWrite = Readonly<{
  requirement: Requirement;
  materialBaseline: MaterialBaseline | null;
  materialRefs: readonly EvidenceRef[];
  timelineEvent: TimelineEvent;
  outboxEvent: OutboxEvent;
}>;

export type IdempotentRequirementCommand = Readonly<{
  write: RequirementWrite;
  idempotency: IdempotencyRecord;
}>;

export type CompleteG0Command = Readonly<{
  previousRowVersion: number;
  write: RequirementWrite;
  idempotency: IdempotencyRecord;
}>;

export type IdempotentCommandResult = Readonly<{
  status: 'CREATED' | 'REPLAYED' | 'CONFLICT';
  resourceId: string;
}>;

export type QuestionMutationWrite = Readonly<{
  requirementId: string;
  previousQuestionId: string;
  previousRowVersion: number;
  question: Question;
  decisionToInsert: Decision | null;
  decisionToUpdate: Decision | null;
  newQuestion: QuestionRecord | null;
  resultQuestionId: string;
  timelineEvent: TimelineEvent;
  outboxEvent: OutboxEvent;
}>;

export type IdempotentQuestionCommand = Readonly<{
  write: QuestionMutationWrite;
  idempotency: IdempotencyRecord;
}>;

export type GateRunStartWrite = Readonly<{
  requirementId: string;
  expectedRequirementRowVersion: number;
  gateRun: GateRun;
  timelineEvent: TimelineEvent;
  outboxEvent: OutboxEvent;
}>;

export type IdempotentGateRunStartCommand = Readonly<{
  write: GateRunStartWrite;
  idempotency: IdempotencyRecord;
}>;

export type GateRunStartResult = Readonly<{
  status: 'CREATED' | 'REPLAYED' | 'REUSED_IN_PROGRESS' | 'CONFLICT';
  resourceId: string;
}>;

export type CompleteGateRunCommand = Readonly<{
  requirementId: string;
  gateRunId: string;
  result: GateRunResult;
  checks: readonly GateCheck[];
  evidence: readonly GateRunEvidence[];
  completedAt: string;
  failureReason?: string;
  unknownReason?: string;
  actorId: string;
  gateTimelineEventId: string;
  gateOutboxEventId: string;
  advancementTimelineEventId: string;
  advancementOutboxEventId: string;
}>;

export type CompleteGateRunResult = Readonly<{
  replayed: boolean;
  gateRun: GateRunRecord;
  requirement: RequirementRecord;
}>;

export interface RequirementRepositoryPort {
  listRequirementCandidates(input: {
    search: string;
    cursor: string | null;
    limit: number;
  }): Promise<
    Readonly<{
      items: readonly RequirementListCandidate[];
      nextCursor: string | null;
    }>
  >;
  findRequirementAccessMetadata(
    id: string,
  ): Promise<Readonly<{ id: string; sensitivity: SensitivityLevel }> | null>;
  findRequirementRecordById(id: string): Promise<RequirementRecord | null>;
  listMaterialBaselinesByRequirement(
    requirementId: string,
  ): Promise<readonly MaterialBaseline[]>;
  listMaterialImpactsByRequirement(
    requirementId: string,
  ): Promise<readonly MaterialImpactAssessment[]>;
  findMaterialImpactById(
    requirementId: string,
    impactId: string,
  ): Promise<MaterialImpactAssessment | null>;
  listQuestionRecordsByRequirement(
    requirementId: string,
    baselineId: string,
  ): Promise<readonly QuestionRecord[]>;
  findQuestionRecordById(
    requirementId: string,
    questionId: string,
  ): Promise<QuestionRecord | null>;
  createRequirementIdempotently(
    command: IdempotentRequirementCommand,
  ): Promise<IdempotentCommandResult>;
  completeG0RegistrationIdempotently(
    command: CompleteG0Command,
  ): Promise<IdempotentCommandResult>;
  mutateQuestionIdempotently(
    command: IdempotentQuestionCommand,
  ): Promise<IdempotentCommandResult>;
  listGateRunRecordsByRequirement(
    requirementId: string,
  ): Promise<readonly GateRunRecord[]>;
  findGateRunRecordById(
    requirementId: string,
    gateRunId: string,
  ): Promise<GateRunRecord | null>;
  startGateRunIdempotently(
    command: IdempotentGateRunStartCommand,
  ): Promise<GateRunStartResult>;
  completeGateRun(
    command: CompleteGateRunCommand,
  ): Promise<CompleteGateRunResult>;
  createMaterialImpactIdempotently(
    command: IdempotentMaterialImpactCommand<CreateMaterialImpactWrite>,
  ): Promise<IdempotentCommandResult>;
  confirmMaterialImpactIdempotently(
    command: IdempotentMaterialImpactCommand<ConfirmMaterialImpactWrite>,
  ): Promise<IdempotentCommandResult>;
  listTimelineEvents(input: {
    requirementId: string;
    cursor: number | null;
    afterSequence: number | null;
    limit: number;
  }): Promise<
    Readonly<{
      items: readonly SequencedTimelineEvent[];
      nextCursor: number | null;
    }>
  >;
  hasTimelineEvent(input: {
    requirementId: string;
    sequence: number;
  }): Promise<boolean>;
  findIdempotencyRecord(input: {
    actorId: string;
    route: string;
    idempotencyKey: string;
  }): Promise<IdempotencyRecord | null>;
}
