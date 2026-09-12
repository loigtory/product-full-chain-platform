import { createHash } from 'node:crypto';

import type {
  EventSummary,
  GateCenterStatus,
  GateConfirmationRole,
  GateResult,
  GateRunResult,
  LifecycleStage,
  MaterialPurpose,
  MaterialSourceType,
  QuestionDecisionScopeDto,
  SensitivityLevel,
} from '@pfc/contracts';
import {
  applyGateResult,
  assertGateCheckConsistency,
  assertSafeEventSummary,
  createOutboxEvent,
  DomainRuleViolation,
  type Decision,
  type GateCheck,
  type GateRun,
  type GateRunEvidence,
  type IdempotencyRecord,
  type EvidenceRef,
  type MaterialBaseline,
  type MaterialImpactAssessment,
  type OutboxEvent,
  type Question,
  type Requirement,
  type StageAdvancement,
  type TimelineEvent,
} from '@pfc/domain';

import type { LifecycleKysely } from './database.ts';

type ScopedLifecycleDatabase = ReturnType<LifecycleKysely['withSchema']>;

export type TimelineEventWrite = Readonly<{
  id: string;
  requirementId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  actorId: string;
  beforeSummary: EventSummary | null;
  afterSummary: EventSummary;
  aggregateVersion: number;
  occurredAt: string;
}>;

export type CreateRequirementWrite = Readonly<{
  requirement: Requirement;
  materialBaseline: MaterialBaseline | null;
  materialRefs: readonly EvidenceRef[];
  timelineEvent: TimelineEventWrite;
  outboxEvent: OutboxEvent;
}>;

export type IdempotentRequirementWrite = Readonly<{
  write: CreateRequirementWrite;
  idempotency: IdempotencyRecord;
}>;

export type CompleteG0RequirementWrite = Readonly<{
  previousRowVersion: number;
  write: CreateRequirementWrite;
  idempotency: IdempotencyRecord;
}>;

export type IdempotentRequirementWriteResult = Readonly<{
  status: 'CREATED' | 'REPLAYED' | 'CONFLICT';
  resourceId: string;
}>;

export type QuestionRecordWrite = Readonly<{
  question: Question;
  decisions: readonly Decision[];
}>;

export type QuestionMutationWrite = Readonly<{
  requirementId: string;
  previousQuestionId: string;
  previousRowVersion: number;
  question: Question;
  decisionToInsert: Decision | null;
  decisionToUpdate: Decision | null;
  newQuestion: QuestionRecordWrite | null;
  resultQuestionId: string;
  timelineEvent: TimelineEventWrite;
  outboxEvent: OutboxEvent;
}>;

export type IdempotentQuestionWrite = Readonly<{
  write: QuestionMutationWrite;
  idempotency: IdempotencyRecord;
}>;

export type GateRunRecordWrite = Readonly<{
  gateRun: GateRun;
  checks: readonly GateCheck[];
  evidence: readonly GateRunEvidence[];
  advancement: StageAdvancement | null;
}>;

export type GateRunStartWrite = Readonly<{
  requirementId: string;
  expectedRequirementRowVersion: number;
  gateRun: GateRun;
  timelineEvent: TimelineEventWrite;
  outboxEvent: OutboxEvent;
}>;

export type IdempotentGateRunStartWrite = Readonly<{
  write: GateRunStartWrite;
  idempotency: IdempotencyRecord;
}>;

export type GateRunStartWriteResult = Readonly<{
  status: 'CREATED' | 'REPLAYED' | 'REUSED_IN_PROGRESS' | 'CONFLICT';
  resourceId: string;
}>;

export type CreateMaterialImpactWrite = Readonly<{
  requirementId: string;
  expectedCurrentBaselineId: string;
  candidateBaseline: MaterialBaseline;
  assessment: MaterialImpactAssessment;
  timelineEvent: TimelineEventWrite;
  outboxEvent: OutboxEvent;
}>;

export type ConfirmMaterialImpactWrite = Readonly<{
  requirement: Requirement;
  previousRowVersion: number;
  previousBaseline: MaterialBaseline;
  currentBaseline: MaterialBaseline;
  assessment: MaterialImpactAssessment;
  invalidatedGateRunIds: readonly string[];
  timelineEvent: TimelineEventWrite;
  outboxEvent: OutboxEvent;
}>;

export type IdempotentMaterialImpactWrite<TWrite> = Readonly<{
  write: TWrite;
  idempotency: IdempotencyRecord;
}>;

export type CompleteGateRunWrite = Readonly<{
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

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function validateCreateRequirementBindings(
  write: CreateRequirementWrite,
): void {
  const {
    requirement,
    materialBaseline,
    materialRefs,
    timelineEvent,
    outboxEvent,
  } = write;
  const baselineMatches = materialBaseline
    ? materialBaseline.requirementId === requirement.id &&
      materialBaseline.id === requirement.currentBaselineId &&
      materialBaseline.status === 'CURRENT'
    : requirement.currentBaselineId === null;
  const timelineMatches =
    timelineEvent.requirementId === requirement.id &&
    timelineEvent.aggregateType === 'requirement' &&
    timelineEvent.aggregateId === requirement.id &&
    timelineEvent.aggregateVersion === requirement.rowVersion;
  const outboxMatches =
    outboxEvent.aggregateType === 'requirement' &&
    outboxEvent.aggregateId === requirement.id &&
    outboxEvent.aggregateVersion === requirement.rowVersion &&
    outboxEvent.type === timelineEvent.eventType &&
    outboxEvent.status === 'PENDING';
  const expectedContentHash = `sha256:${createHash('sha256')
    .update(requirement.originalIdea)
    .digest('hex')}`;
  const initialRef = materialRefs[0];
  const materialRefsMatch = materialBaseline
    ? materialRefs.length === 1 &&
      Boolean(initialRef?.id.trim()) &&
      initialRef?.baselineId === materialBaseline.id &&
      initialRef.referenceType === 'ORIGINAL_IDEA' &&
      initialRef.source === requirement.originalIdea &&
      initialRef.version === '1' &&
      initialRef.contentHash === expectedContentHash &&
      initialRef.location ===
        `pfc://requirements/${encodeURIComponent(requirement.id)}/original-idea` &&
      initialRef.sensitivity === materialBaseline.sensitivity &&
      initialRef.validity === 'VALID' &&
      initialRef.createdAt === materialBaseline.createdAt
    : materialRefs.length === 0;

  if (
    !baselineMatches ||
    !materialRefsMatch ||
    !timelineMatches ||
    !outboxMatches
  ) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Requirement, baseline, initial material, timeline, and outbox bindings must match.',
    );
  }
}

function validateIdempotency(
  idempotency: IdempotencyRecord,
  requirementId: string,
): void {
  if (
    !idempotency.id.trim() ||
    !idempotency.actorId.trim() ||
    !idempotency.route.trim() ||
    !idempotency.idempotencyKey.trim() ||
    !idempotency.requestHash.trim() ||
    idempotency.resultReference !== requirementId
  ) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Idempotency binding is invalid.',
    );
  }
  if (idempotency.responseSummary) {
    assertSafeEventSummary(idempotency.responseSummary);
  }
}

function mapRequirement(row: {
  id: string;
  name: string;
  original_idea: string;
  initiator_id: string;
  business_owner_id: string | null;
  current_stage: Requirement['currentStage'];
  current_baseline_id: string | null;
  row_version: number;
  draft_source_type: MaterialSourceType | null;
  draft_source_description: string | null;
  draft_material_purpose: MaterialPurpose | null;
  draft_sensitivity: SensitivityLevel | null;
  created_at: Date | string;
  updated_at: Date | string;
}): Requirement {
  return {
    id: row.id,
    name: row.name,
    originalIdea: row.original_idea,
    initiatorId: row.initiator_id,
    businessOwnerId: row.business_owner_id,
    currentStage: row.current_stage,
    currentBaselineId: row.current_baseline_id,
    rowVersion: row.row_version,
    draftRegistration: {
      sourceType: row.draft_source_type,
      sourceDescription: row.draft_source_description,
      businessOwnerId: row.business_owner_id,
      materialPurpose: row.draft_material_purpose,
      sensitivity: row.draft_sensitivity,
    },
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function mapMaterialBaseline(row: {
  id: string;
  requirement_id: string;
  version_number: number;
  status: MaterialBaseline['status'];
  source_type: MaterialSourceType;
  source_description: string | null;
  material_purpose: MaterialPurpose;
  sensitivity: SensitivityLevel;
  confirmed_by: string;
  confirmed_at: Date | string;
  created_at: Date | string;
}): MaterialBaseline {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    versionNumber: row.version_number,
    status: row.status,
    sourceType: row.source_type,
    sourceDescription: row.source_description,
    materialPurpose: row.material_purpose,
    sensitivity: row.sensitivity,
    confirmedBy: row.confirmed_by,
    confirmedAt: timestamp(row.confirmed_at),
    createdAt: timestamp(row.created_at),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function mapMaterialImpact(row: {
  id: string;
  requirement_id: string;
  original_baseline_id: string;
  candidate_baseline_id: string;
  recommended_stage: LifecycleStage;
  selected_stage: LifecycleStage | null;
  decision: MaterialImpactAssessment['decision'];
  reason: string | null;
  status: MaterialImpactAssessment['status'];
  confirmed_role: MaterialImpactAssessment['confirmedRole'];
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  invalidated_gate_run_ids: unknown;
  created_at: Date | string;
}): MaterialImpactAssessment {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    originalBaselineId: row.original_baseline_id,
    candidateBaselineId: row.candidate_baseline_id,
    recommendedStage: row.recommended_stage,
    selectedStage: row.selected_stage,
    decision: row.decision,
    reason: row.reason,
    status: row.status,
    confirmedRole: row.confirmed_role,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at ? timestamp(row.confirmed_at) : null,
    invalidatedGateRunIds: stringArray(row.invalidated_gate_run_ids),
    createdAt: timestamp(row.created_at),
  };
}

function mapQuestion(row: {
  id: string;
  requirement_id: string;
  baseline_id: string;
  prompt: string;
  reason: string | null;
  candidates: unknown;
  owner_id: string;
  close_by_stage: Question['closeByStage'];
  status: Question['status'];
  current_decision_id: string | null;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}): Question {
  const candidates = Array.isArray(row.candidates)
    ? row.candidates.filter(
        (candidate): candidate is string => typeof candidate === 'string',
      )
    : [];
  return {
    id: row.id,
    requirementId: row.requirement_id,
    baselineId: row.baseline_id,
    prompt: row.prompt,
    reason: row.reason,
    candidates,
    ownerId: row.owner_id,
    closeByStage: row.close_by_stage,
    status: row.status,
    currentDecisionId: row.current_decision_id,
    rowVersion: row.row_version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function mapDecision(row: {
  id: string;
  question_id: string;
  decision_kind: Decision['kind'];
  raw_answer: string;
  explanation: string | null;
  scope: unknown;
  version_number: number;
  confirmed_role: Decision['confirmedRole'];
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  validity: Decision['validity'];
  supersedes_decision_id: string | null;
  created_at: Date | string;
}): Decision {
  return {
    id: row.id,
    questionId: row.question_id,
    kind: row.decision_kind,
    rawAnswer: row.raw_answer,
    explanation: row.explanation,
    scope: row.scope as QuestionDecisionScopeDto,
    versionNumber: row.version_number,
    confirmedRole: row.confirmed_role,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at ? timestamp(row.confirmed_at) : null,
    validity: row.validity,
    supersedesDecisionId: row.supersedes_decision_id,
    createdAt: timestamp(row.created_at),
  };
}

function mapGateRun(row: {
  id: string;
  requirement_id: string;
  baseline_id: string;
  stage: LifecycleStage;
  mode: GateRun['mode'];
  status: GateRun['status'];
  result: GateRunResult | null;
  validity: GateRun['validity'];
  owner_id: string;
  confirmed_role: GateConfirmationRole | null;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  failure_reason: string | null;
  unknown_reason: string | null;
  registration_note: string | null;
}): GateRun {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    baselineId: row.baseline_id,
    stage: row.stage,
    mode: row.mode,
    status: row.status,
    result: row.result,
    validity: row.validity,
    ownerId: row.owner_id,
    confirmedRole: row.confirmed_role,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at ? timestamp(row.confirmed_at) : null,
    startedAt: timestamp(row.started_at),
    completedAt: row.completed_at ? timestamp(row.completed_at) : null,
    failureReason: row.failure_reason,
    unknownReason: row.unknown_reason,
    registrationNote: row.registration_note,
  };
}

function mapGateCheck(row: {
  id: string;
  gate_run_id: string;
  check_key: string;
  result: GateResult;
  reason: string | null;
  owner_id: string | null;
  close_point: string | null;
  created_at: Date | string;
}): GateCheck {
  return {
    id: row.id,
    gateRunId: row.gate_run_id,
    checkKey: row.check_key,
    result: row.result,
    reason: row.reason,
    ownerId: row.owner_id,
    closePoint: row.close_point,
    createdAt: timestamp(row.created_at),
  };
}

function mapGateRunEvidence(row: {
  gate_run_id: string;
  evidence_ref_id: string;
  access_decision: GateRunEvidence['accessDecision'];
  action_authorization_ref: string | null;
  created_at: Date | string;
}): GateRunEvidence {
  return {
    gateRunId: row.gate_run_id,
    evidenceRefId: row.evidence_ref_id,
    accessDecision: row.access_decision,
    actionAuthorizationRef: row.action_authorization_ref,
    createdAt: timestamp(row.created_at),
  };
}

function mapStageAdvancement(row: {
  id: string;
  gate_run_id: string;
  requirement_id: string;
  baseline_id: string;
  from_stage: LifecycleStage;
  to_stage: LifecycleStage;
  advanced_at: Date | string;
}): StageAdvancement {
  return {
    id: row.id,
    gateRunId: row.gate_run_id,
    requirementId: row.requirement_id,
    baselineId: row.baseline_id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    advancedAt: timestamp(row.advanced_at),
  };
}

async function loadGateRunRecord(
  scoped: ScopedLifecycleDatabase,
  requirementId: string,
  gateRunId: string,
): Promise<GateRunRecordWrite | null> {
  const row = await scoped
    .selectFrom('gate_runs')
    .selectAll()
    .where('id', '=', gateRunId)
    .where('requirement_id', '=', requirementId)
    .executeTakeFirst();
  if (!row) return null;
  const [checks, evidence, advancement] = await Promise.all([
    scoped
      .selectFrom('gate_checks')
      .selectAll()
      .where('gate_run_id', '=', gateRunId)
      .orderBy('check_key')
      .execute(),
    scoped
      .selectFrom('gate_run_evidence')
      .selectAll()
      .where('gate_run_id', '=', gateRunId)
      .orderBy('evidence_ref_id')
      .execute(),
    scoped
      .selectFrom('stage_advancements')
      .selectAll()
      .where('gate_run_id', '=', gateRunId)
      .executeTakeFirst(),
  ]);
  return {
    gateRun: mapGateRun(row),
    checks: checks.map(mapGateCheck),
    evidence: evidence.map(mapGateRunEvidence),
    advancement: advancement ? mapStageAdvancement(advancement) : null,
  };
}

async function claimIdempotency(
  scoped: ScopedLifecycleDatabase,
  record: IdempotencyRecord,
): Promise<
  | Readonly<{ claimed: true }>
  | Readonly<{ claimed: false; existing: IdempotencyRecord }>
> {
  const claimed = await scoped
    .insertInto('idempotency_records')
    .values({
      id: record.id,
      actor_id: record.actorId,
      route: record.route,
      idempotency_key: record.idempotencyKey,
      request_hash: record.requestHash,
      result_reference: record.resultReference,
      response_summary: record.responseSummary,
      created_at: record.createdAt,
    })
    .onConflict((conflict) =>
      conflict.columns(['actor_id', 'route', 'idempotency_key']).doNothing(),
    )
    .returning('id')
    .executeTakeFirst();
  if (claimed) return { claimed: true };

  const existing = await scoped
    .selectFrom('idempotency_records')
    .selectAll()
    .where('actor_id', '=', record.actorId)
    .where('route', '=', record.route)
    .where('idempotency_key', '=', record.idempotencyKey)
    .executeTakeFirstOrThrow();
  return {
    claimed: false,
    existing: {
      id: existing.id,
      actorId: existing.actor_id,
      route: existing.route,
      idempotencyKey: existing.idempotency_key,
      requestHash: existing.request_hash,
      resultReference: existing.result_reference,
      responseSummary: existing.response_summary,
      createdAt: timestamp(existing.created_at),
    },
  };
}

async function insertTimelineAndOutbox(
  scoped: ScopedLifecycleDatabase,
  write: Pick<CreateRequirementWrite, 'timelineEvent' | 'outboxEvent'>,
  outboxEvent: OutboxEvent,
): Promise<void> {
  const { timelineEvent } = write;
  await scoped
    .insertInto('timeline_events')
    .values({
      id: timelineEvent.id,
      requirement_id: timelineEvent.requirementId,
      aggregate_type: timelineEvent.aggregateType,
      aggregate_id: timelineEvent.aggregateId,
      event_type: timelineEvent.eventType,
      actor_id: timelineEvent.actorId,
      before_summary: timelineEvent.beforeSummary,
      after_summary: timelineEvent.afterSummary,
      aggregate_version: timelineEvent.aggregateVersion,
      occurred_at: timelineEvent.occurredAt,
    })
    .execute();
  await scoped
    .insertInto('outbox_events')
    .values({
      id: outboxEvent.id,
      event_type: outboxEvent.type,
      aggregate_type: outboxEvent.aggregateType,
      aggregate_id: outboxEvent.aggregateId,
      aggregate_version: outboxEvent.aggregateVersion,
      payload_summary: outboxEvent.summary,
      status: outboxEvent.status,
      occurred_at: outboxEvent.occurredAt,
      published_at: null,
    })
    .execute();
}

async function insertDecision(
  scoped: ScopedLifecycleDatabase,
  decision: Decision,
): Promise<void> {
  await scoped
    .insertInto('decisions')
    .values({
      id: decision.id,
      question_id: decision.questionId,
      decision_kind: decision.kind,
      raw_answer: decision.rawAnswer,
      explanation: decision.explanation,
      scope: decision.scope,
      version_number: decision.versionNumber,
      confirmed_role: decision.confirmedRole,
      confirmed_by: decision.confirmedBy,
      confirmed_at: decision.confirmedAt,
      validity: decision.validity,
      supersedes_decision_id: decision.supersedesDecisionId,
      created_at: decision.createdAt,
    })
    .execute();
}

async function insertQuestion(
  scoped: ScopedLifecycleDatabase,
  question: Question,
): Promise<void> {
  await scoped
    .insertInto('questions')
    .values({
      id: question.id,
      requirement_id: question.requirementId,
      baseline_id: question.baselineId,
      prompt: question.prompt,
      reason: question.reason,
      candidates: JSON.stringify(question.candidates),
      owner_id: question.ownerId,
      close_by_stage: question.closeByStage,
      status: question.status,
      current_decision_id: null,
      row_version: question.rowVersion,
      created_at: question.createdAt,
      updated_at: question.updatedAt,
    })
    .execute();
}

async function insertMaterialRefs(
  scoped: ScopedLifecycleDatabase,
  materialRefs: readonly EvidenceRef[],
): Promise<void> {
  if (materialRefs.length === 0) return;
  await scoped
    .insertInto('material_refs')
    .values(
      materialRefs.map((materialRef) => ({
        id: materialRef.id,
        baseline_id: materialRef.baselineId,
        reference_type: materialRef.referenceType,
        source: materialRef.source,
        version: materialRef.version,
        content_hash: materialRef.contentHash,
        location: materialRef.location,
        sensitivity: materialRef.sensitivity,
        validity: materialRef.validity,
        created_at: materialRef.createdAt,
      })),
    )
    .execute();
}

async function insertRequirementAggregate(
  scoped: ScopedLifecycleDatabase,
  write: CreateRequirementWrite,
  outboxEvent: OutboxEvent,
): Promise<void> {
  const { requirement, materialBaseline, materialRefs } = write;
  await scoped
    .insertInto('requirements')
    .values({
      id: requirement.id,
      name: requirement.name,
      original_idea: requirement.originalIdea,
      initiator_id: requirement.initiatorId,
      business_owner_id: requirement.businessOwnerId,
      current_stage: requirement.currentStage,
      current_baseline_id: null,
      row_version: requirement.rowVersion,
      draft_source_type: requirement.draftRegistration?.sourceType ?? null,
      draft_source_description:
        requirement.draftRegistration?.sourceDescription ?? null,
      draft_material_purpose:
        requirement.draftRegistration?.materialPurpose ?? null,
      draft_sensitivity: requirement.draftRegistration?.sensitivity ?? null,
      created_at: requirement.createdAt,
      updated_at: requirement.updatedAt,
    })
    .execute();

  if (materialBaseline) {
    await scoped
      .insertInto('material_baselines')
      .values({
        id: materialBaseline.id,
        requirement_id: materialBaseline.requirementId,
        version_number: materialBaseline.versionNumber,
        status: materialBaseline.status,
        source_type: materialBaseline.sourceType,
        source_description: materialBaseline.sourceDescription,
        material_purpose: materialBaseline.materialPurpose,
        sensitivity: materialBaseline.sensitivity,
        confirmed_by: materialBaseline.confirmedBy,
        confirmed_at: materialBaseline.confirmedAt,
        created_at: materialBaseline.createdAt,
      })
      .execute();
    await insertMaterialRefs(scoped, materialRefs);
    await scoped
      .updateTable('requirements')
      .set({ current_baseline_id: materialBaseline.id })
      .where('id', '=', requirement.id)
      .executeTakeFirstOrThrow();
  }
  await insertTimelineAndOutbox(scoped, write, outboxEvent);
}

export class PostgresLifecycleRepository {
  constructor(
    private readonly database: LifecycleKysely,
    private readonly schemaName: string,
  ) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName)) {
      throw new Error('INVALID_LIFECYCLE_SCHEMA_NAME');
    }
  }

  async createRequirement(write: CreateRequirementWrite): Promise<void> {
    validateCreateRequirementBindings(write);
    assertSafeEventSummary(write.timelineEvent.afterSummary);
    if (write.timelineEvent.beforeSummary) {
      assertSafeEventSummary(write.timelineEvent.beforeSummary);
    }
    const validatedOutboxEvent = createOutboxEvent({
      id: write.outboxEvent.id,
      type: write.outboxEvent.type,
      aggregateType: write.outboxEvent.aggregateType,
      aggregateId: write.outboxEvent.aggregateId,
      aggregateVersion: write.outboxEvent.aggregateVersion,
      occurredAt: write.outboxEvent.occurredAt,
      summary: write.outboxEvent.summary,
    });

    await this.database.transaction().execute(async (transaction) => {
      await insertRequirementAggregate(
        transaction.withSchema(this.schemaName),
        write,
        validatedOutboxEvent,
      );
    });
  }

  async createRequirementIdempotently(
    command: IdempotentRequirementWrite,
  ): Promise<IdempotentRequirementWriteResult> {
    validateCreateRequirementBindings(command.write);
    validateIdempotency(command.idempotency, command.write.requirement.id);
    assertSafeEventSummary(command.write.timelineEvent.afterSummary);
    const validatedOutboxEvent = createOutboxEvent({
      id: command.write.outboxEvent.id,
      type: command.write.outboxEvent.type,
      aggregateType: command.write.outboxEvent.aggregateType,
      aggregateId: command.write.outboxEvent.aggregateId,
      aggregateVersion: command.write.outboxEvent.aggregateVersion,
      occurredAt: command.write.outboxEvent.occurredAt,
      summary: command.write.outboxEvent.summary,
    });

    return this.database.transaction().execute(async (transaction) => {
      const scoped = transaction.withSchema(this.schemaName);
      const claim = await claimIdempotency(scoped, command.idempotency);
      if (!claim.claimed) {
        return {
          status:
            claim.existing.requestHash === command.idempotency.requestHash
              ? 'REPLAYED'
              : 'CONFLICT',
          resourceId:
            claim.existing.resultReference ?? command.write.requirement.id,
        };
      }
      await insertRequirementAggregate(
        scoped,
        command.write,
        validatedOutboxEvent,
      );
      return {
        status: 'CREATED',
        resourceId: command.write.requirement.id,
      };
    });
  }

  async completeG0RegistrationIdempotently(
    command: CompleteG0RequirementWrite,
  ): Promise<IdempotentRequirementWriteResult> {
    validateCreateRequirementBindings(command.write);
    validateIdempotency(command.idempotency, command.write.requirement.id);
    const baseline = command.write.materialBaseline;
    if (
      !baseline ||
      command.write.requirement.rowVersion !== command.previousRowVersion + 1
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'G0 completion binding is invalid.',
      );
    }
    const validatedOutboxEvent = createOutboxEvent({
      id: command.write.outboxEvent.id,
      type: command.write.outboxEvent.type,
      aggregateType: command.write.outboxEvent.aggregateType,
      aggregateId: command.write.outboxEvent.aggregateId,
      aggregateVersion: command.write.outboxEvent.aggregateVersion,
      occurredAt: command.write.outboxEvent.occurredAt,
      summary: command.write.outboxEvent.summary,
    });

    return this.database.transaction().execute(async (transaction) => {
      const scoped = transaction.withSchema(this.schemaName);
      const claim = await claimIdempotency(scoped, command.idempotency);
      if (!claim.claimed) {
        return {
          status:
            claim.existing.requestHash === command.idempotency.requestHash
              ? 'REPLAYED'
              : 'CONFLICT',
          resourceId:
            claim.existing.resultReference ?? command.write.requirement.id,
        };
      }

      const current = await scoped
        .selectFrom('requirements')
        .select(['id', 'row_version', 'current_stage', 'current_baseline_id'])
        .where('id', '=', command.write.requirement.id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) {
        throw new DomainRuleViolation(
          'NOT_FOUND',
          'Requirement was not found.',
        );
      }
      if (current.row_version !== command.previousRowVersion) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Requirement row version does not match.',
          { currentVersion: current.row_version },
        );
      }
      if (
        current.current_stage !== 'G0' ||
        current.current_baseline_id !== null
      ) {
        throw new DomainRuleViolation(
          'INVALID_STATE_TRANSITION',
          'G0 registration can only complete an incomplete G0 draft.',
        );
      }

      await scoped
        .insertInto('material_baselines')
        .values({
          id: baseline.id,
          requirement_id: baseline.requirementId,
          version_number: baseline.versionNumber,
          status: baseline.status,
          source_type: baseline.sourceType,
          source_description: baseline.sourceDescription,
          material_purpose: baseline.materialPurpose,
          sensitivity: baseline.sensitivity,
          confirmed_by: baseline.confirmedBy,
          confirmed_at: baseline.confirmedAt,
          created_at: baseline.createdAt,
        })
        .execute();
      await insertMaterialRefs(scoped, command.write.materialRefs);
      await scoped
        .updateTable('requirements')
        .set({
          business_owner_id: command.write.requirement.businessOwnerId,
          current_baseline_id: baseline.id,
          row_version: command.write.requirement.rowVersion,
          draft_source_type:
            command.write.requirement.draftRegistration?.sourceType ?? null,
          draft_source_description:
            command.write.requirement.draftRegistration?.sourceDescription ??
            null,
          draft_material_purpose:
            command.write.requirement.draftRegistration?.materialPurpose ??
            null,
          draft_sensitivity:
            command.write.requirement.draftRegistration?.sensitivity ?? null,
          updated_at: command.write.requirement.updatedAt,
        })
        .where('id', '=', command.write.requirement.id)
        .where('row_version', '=', command.previousRowVersion)
        .executeTakeFirstOrThrow();
      await insertTimelineAndOutbox(
        scoped,
        command.write,
        validatedOutboxEvent,
      );
      return {
        status: 'CREATED',
        resourceId: command.write.requirement.id,
      };
    });
  }

  async listRequirementCandidates(input: {
    search: string;
    cursor: string | null;
    limit: number;
  }) {
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Requirement list cursor or limit is invalid.',
      );
    }
    let query = this.database
      .withSchema(this.schemaName)
      .selectFrom('requirements')
      .leftJoin(
        'material_baselines',
        'material_baselines.id',
        'requirements.current_baseline_id',
      )
      .select([
        'requirements.id',
        'requirements.name',
        'requirements.initiator_id',
        'requirements.business_owner_id',
        'requirements.current_stage',
        'requirements.current_baseline_id',
        'requirements.row_version',
        'requirements.draft_sensitivity',
        'requirements.updated_at',
        'material_baselines.sensitivity as baseline_sensitivity',
      ]);
    const search = input.search.trim();
    if (search)
      query = query.where('requirements.name', 'ilike', `%${search}%`);
    const rows = await query
      .orderBy('requirements.updated_at', 'desc')
      .orderBy('requirements.id', 'asc')
      .offset(offset)
      .limit(input.limit + 1)
      .execute();
    const hasNext = rows.length > input.limit;
    const pageRows = hasNext ? rows.slice(0, input.limit) : rows;
    return {
      items: pageRows.map((row) => ({
        id: row.id,
        name: row.name,
        initiatorId: row.initiator_id,
        businessOwnerId: row.business_owner_id,
        currentStage: row.current_stage,
        currentBaselineId: row.current_baseline_id,
        rowVersion: row.row_version,
        sensitivity:
          row.baseline_sensitivity ?? row.draft_sensitivity ?? 'RESTRICTED',
        updatedAt: timestamp(row.updated_at),
      })),
      nextCursor: hasNext ? String(offset + input.limit) : null,
    };
  }

  async listGateCenterItems(input: {
    view: 'CURRENT' | 'HISTORY';
    search: string;
    stage: LifecycleStage | null;
    status: GateCenterStatus | null;
    mode: 'AUTOMATIC' | 'MANUAL' | null;
    cursor: string | null;
    limit: number;
  }) {
    const offset = this.listOffset(input.cursor, input.limit);
    return input.view === 'CURRENT'
      ? this.listCurrentGateCenterItems(input, offset)
      : this.listHistoricalGateCenterItems(input, offset);
  }

  private async listCurrentGateCenterItems(
    input: {
      search: string;
      stage: LifecycleStage | null;
      status: GateCenterStatus | null;
      mode: 'AUTOMATIC' | 'MANUAL' | null;
      limit: number;
    },
    offset: number,
  ) {
    const scoped = this.database.withSchema(this.schemaName);
    let query = scoped
      .selectFrom('requirements')
      .leftJoin(
        'material_baselines as current_baseline',
        'current_baseline.id',
        'requirements.current_baseline_id',
      )
      .leftJoinLateral(
        (expression) =>
          expression
            .selectFrom('gate_runs as current_gate_source')
            .select([
              'current_gate_source.id',
              'current_gate_source.baseline_id',
              'current_gate_source.mode',
              'current_gate_source.status',
              'current_gate_source.result',
              'current_gate_source.validity',
              'current_gate_source.owner_id',
              'current_gate_source.started_at',
              'current_gate_source.completed_at',
            ])
            .whereRef(
              'current_gate_source.requirement_id',
              '=',
              'requirements.id',
            )
            .whereRef(
              'current_gate_source.baseline_id',
              '=',
              'requirements.current_baseline_id',
            )
            .whereRef(
              'current_gate_source.stage',
              '=',
              'requirements.current_stage',
            )
            .where('current_gate_source.validity', '=', 'CURRENT')
            .orderBy('current_gate_source.started_at', 'desc')
            .orderBy('current_gate_source.id', 'desc')
            .limit(1)
            .as('current_gate'),
        (join) => join.onTrue(),
      )
      .select([
        'requirements.id as requirement_id',
        'requirements.name as requirement_name',
        'requirements.current_stage as requirement_stage',
        'requirements.current_baseline_id as current_baseline_id',
        'requirements.initiator_id as initiator_id',
        'requirements.business_owner_id as business_owner_id',
        'requirements.draft_sensitivity as draft_sensitivity',
        'requirements.updated_at as requirement_updated_at',
        'current_baseline.sensitivity as baseline_sensitivity',
        'current_gate.id as gate_run_id',
        'current_gate.baseline_id as gate_baseline_id',
        'current_gate.mode as gate_mode',
        'current_gate.status as gate_run_status',
        'current_gate.result as gate_result',
        'current_gate.validity as gate_validity',
        'current_gate.owner_id as gate_owner_id',
        'current_gate.started_at as gate_started_at',
        'current_gate.completed_at as gate_completed_at',
        (expression) =>
          expression
            .selectFrom('gate_runs as gate_history')
            .select((count) => count.fn.countAll<number>().as('count'))
            .whereRef('gate_history.requirement_id', '=', 'requirements.id')
            .as('history_count'),
      ]);
    const search = input.search.trim();
    if (search)
      query = query.where('requirements.name', 'ilike', `%${search}%`);
    if (input.stage)
      query = query.where('requirements.current_stage', '=', input.stage);
    if (input.mode) query = query.where('current_gate.mode', '=', input.mode);
    if (input.status === 'NOT_STARTED') {
      query = query.where('current_gate.id', 'is', null);
    } else if (input.status === 'IN_PROGRESS') {
      query = query.where('current_gate.status', '=', 'IN_PROGRESS');
    } else if (input.status) {
      query = query
        .where('current_gate.status', '=', 'COMPLETED')
        .where('current_gate.result', '=', input.status);
    }
    const rows = await query
      .orderBy('requirements.updated_at', 'desc')
      .orderBy('requirements.id', 'asc')
      .offset(offset)
      .limit(input.limit + 1)
      .execute();
    const hasNext = rows.length > input.limit;
    return {
      items: rows.slice(0, input.limit).map((row) => {
        const status: GateCenterStatus = row.gate_run_id
          ? row.gate_run_status === 'IN_PROGRESS'
            ? 'IN_PROGRESS'
            : (row.gate_result ?? 'UNKNOWN')
          : 'NOT_STARTED';
        return {
          key: `CURRENT:${row.requirement_id}`,
          requirementId: row.requirement_id,
          requirementName: row.requirement_name,
          requirementStage: row.requirement_stage,
          stage: row.requirement_stage,
          baselineId: row.current_baseline_id,
          gateRunId: row.gate_run_id,
          mode: row.gate_mode,
          status,
          validity: row.gate_validity,
          ownerId:
            row.gate_owner_id ?? row.business_owner_id ?? row.initiator_id,
          startedAt: row.gate_started_at
            ? timestamp(row.gate_started_at)
            : null,
          completedAt: row.gate_completed_at
            ? timestamp(row.gate_completed_at)
            : null,
          updatedAt: timestamp(row.requirement_updated_at),
          nextAction: row.current_baseline_id
            ? status === 'IN_PROGRESS'
              ? '查看门禁运行'
              : status === 'BLOCK'
                ? '处理门禁阻断'
                : status === 'WARN'
                  ? '处理门禁警告'
                  : status === 'UNKNOWN'
                    ? '刷新门禁结果'
                    : '运行当前门禁'
            : '补齐 G0 登记',
          historyCount: Number(row.history_count ?? 0),
          sensitivity:
            row.baseline_sensitivity ??
            row.draft_sensitivity ??
            ('RESTRICTED' as const),
        };
      }),
      nextCursor: hasNext ? String(offset + input.limit) : null,
    };
  }

  private async listHistoricalGateCenterItems(
    input: {
      search: string;
      stage: LifecycleStage | null;
      status: GateCenterStatus | null;
      mode: 'AUTOMATIC' | 'MANUAL' | null;
      limit: number;
    },
    offset: number,
  ) {
    if (input.status === 'NOT_STARTED') {
      return { items: [], nextCursor: null };
    }
    const scoped = this.database.withSchema(this.schemaName);
    let query = scoped
      .selectFrom('gate_runs')
      .innerJoin('requirements', 'requirements.id', 'gate_runs.requirement_id')
      .innerJoin(
        'material_baselines as gate_baseline',
        'gate_baseline.id',
        'gate_runs.baseline_id',
      )
      .select([
        'gate_runs.id as gate_run_id',
        'gate_runs.requirement_id',
        'gate_runs.baseline_id',
        'gate_runs.stage',
        'gate_runs.mode',
        'gate_runs.status as gate_run_status',
        'gate_runs.result',
        'gate_runs.validity',
        'gate_runs.owner_id',
        'gate_runs.started_at',
        'gate_runs.completed_at',
        'requirements.name as requirement_name',
        'requirements.current_stage as requirement_stage',
        'requirements.updated_at as requirement_updated_at',
        'gate_baseline.sensitivity',
        (expression) =>
          expression
            .selectFrom('gate_runs as gate_history')
            .select((count) => count.fn.countAll<number>().as('count'))
            .whereRef(
              'gate_history.requirement_id',
              '=',
              'gate_runs.requirement_id',
            )
            .as('history_count'),
      ]);
    const search = input.search.trim();
    if (search)
      query = query.where('requirements.name', 'ilike', `%${search}%`);
    if (input.stage) query = query.where('gate_runs.stage', '=', input.stage);
    if (input.mode) query = query.where('gate_runs.mode', '=', input.mode);
    if (input.status === 'IN_PROGRESS') {
      query = query.where('gate_runs.status', '=', 'IN_PROGRESS');
    } else if (input.status) {
      query = query
        .where('gate_runs.status', '=', 'COMPLETED')
        .where('gate_runs.result', '=', input.status);
    }
    const rows = await query
      .orderBy('gate_runs.started_at', 'desc')
      .orderBy('gate_runs.id', 'desc')
      .offset(offset)
      .limit(input.limit + 1)
      .execute();
    const hasNext = rows.length > input.limit;
    return {
      items: rows.slice(0, input.limit).map((row) => ({
        key: `HISTORY:${row.gate_run_id}`,
        requirementId: row.requirement_id,
        requirementName: row.requirement_name,
        requirementStage: row.requirement_stage,
        stage: row.stage,
        baselineId: row.baseline_id,
        gateRunId: row.gate_run_id,
        mode: row.mode,
        status:
          row.gate_run_status === 'IN_PROGRESS'
            ? ('IN_PROGRESS' as const)
            : (row.result ?? ('UNKNOWN' as const)),
        validity: row.validity,
        ownerId: row.owner_id,
        startedAt: timestamp(row.started_at),
        completedAt: row.completed_at ? timestamp(row.completed_at) : null,
        updatedAt: timestamp(row.requirement_updated_at),
        nextAction: '查看历史记录',
        historyCount: Number(row.history_count ?? 0),
        sensitivity: row.sensitivity,
      })),
      nextCursor: hasNext ? String(offset + input.limit) : null,
    };
  }

  async listMaterialLibraryItems(input: {
    search: string;
    status: MaterialBaseline['status'] | null;
    sourceType: MaterialSourceType | null;
    materialPurpose: MaterialPurpose | null;
    sensitivity: SensitivityLevel | null;
    cursor: string | null;
    limit: number;
  }) {
    const offset = this.listOffset(input.cursor, input.limit);
    const scoped = this.database.withSchema(this.schemaName);
    let query = scoped
      .selectFrom('material_baselines')
      .innerJoin(
        'requirements',
        'requirements.id',
        'material_baselines.requirement_id',
      )
      .leftJoinLateral(
        (expression) =>
          expression
            .selectFrom('material_impact_assessments as pending_source')
            .selectAll('pending_source')
            .whereRef(
              'pending_source.candidate_baseline_id',
              '=',
              'material_baselines.id',
            )
            .where('pending_source.status', '=', 'PENDING')
            .orderBy('pending_source.created_at', 'desc')
            .orderBy('pending_source.id', 'asc')
            .limit(1)
            .as('pending_impact'),
        (join) => join.onTrue(),
      )
      .selectAll('material_baselines')
      .select([
        'requirements.name as requirement_name',
        'requirements.current_stage as requirement_stage',
        'pending_impact.id as impact_id',
        'pending_impact.original_baseline_id as impact_original_baseline_id',
        'pending_impact.candidate_baseline_id as impact_candidate_baseline_id',
        'pending_impact.recommended_stage as impact_recommended_stage',
        'pending_impact.selected_stage as impact_selected_stage',
        'pending_impact.decision as impact_decision',
        'pending_impact.reason as impact_reason',
        'pending_impact.status as impact_status',
        'pending_impact.confirmed_role as impact_confirmed_role',
        'pending_impact.confirmed_by as impact_confirmed_by',
        'pending_impact.confirmed_at as impact_confirmed_at',
        'pending_impact.invalidated_gate_run_ids as impact_invalidated_gate_run_ids',
        'pending_impact.created_at as impact_created_at',
      ]);
    const search = input.search.trim();
    if (search)
      query = query.where('requirements.name', 'ilike', `%${search}%`);
    if (input.status)
      query = query.where('material_baselines.status', '=', input.status);
    if (input.sourceType)
      query = query.where(
        'material_baselines.source_type',
        '=',
        input.sourceType,
      );
    if (input.materialPurpose)
      query = query.where(
        'material_baselines.material_purpose',
        '=',
        input.materialPurpose,
      );
    if (input.sensitivity)
      query = query.where(
        'material_baselines.sensitivity',
        '=',
        input.sensitivity,
      );
    const rows = await query
      .orderBy('material_baselines.created_at', 'desc')
      .orderBy('material_baselines.id', 'asc')
      .offset(offset)
      .limit(input.limit + 1)
      .execute();
    const hasNext = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const baselineIds = pageRows.map((row) => row.id);
    const materialRefs = baselineIds.length
      ? await scoped
          .selectFrom('material_refs')
          .select([
            'id',
            'baseline_id',
            'reference_type',
            'source',
            'version',
            'sensitivity',
            'validity',
          ])
          .where('baseline_id', 'in', baselineIds)
          .orderBy('created_at', 'asc')
          .orderBy('id', 'asc')
          .execute()
      : [];
    return {
      items: pageRows.map((row) => ({
        baselineId: row.id,
        requirementId: row.requirement_id,
        requirementName: row.requirement_name,
        requirementStage: row.requirement_stage,
        versionNumber: row.version_number,
        status: row.status,
        sourceType: row.source_type,
        sourceDescription: row.source_description,
        materialPurpose: row.material_purpose,
        sensitivity: row.sensitivity,
        confirmedBy: row.confirmed_by,
        confirmedAt: timestamp(row.confirmed_at),
        createdAt: timestamp(row.created_at),
        materialRefs: materialRefs
          .filter((item) => item.baseline_id === row.id)
          .map((item) => ({
            id: item.id,
            referenceType: item.reference_type,
            source: item.source,
            version: item.version,
            sensitivity: item.sensitivity,
            validity: item.validity,
          })),
        pendingImpact:
          row.impact_id &&
          row.impact_original_baseline_id &&
          row.impact_candidate_baseline_id &&
          row.impact_recommended_stage &&
          row.impact_status &&
          row.impact_created_at
            ? mapMaterialImpact({
                id: row.impact_id,
                requirement_id: row.requirement_id,
                original_baseline_id: row.impact_original_baseline_id,
                candidate_baseline_id: row.impact_candidate_baseline_id,
                recommended_stage: row.impact_recommended_stage,
                selected_stage: row.impact_selected_stage,
                decision: row.impact_decision,
                reason: row.impact_reason,
                status: row.impact_status,
                confirmed_role: row.impact_confirmed_role,
                confirmed_by: row.impact_confirmed_by,
                confirmed_at: row.impact_confirmed_at,
                invalidated_gate_run_ids: row.impact_invalidated_gate_run_ids,
                created_at: row.impact_created_at,
              })
            : null,
      })),
      nextCursor: hasNext ? String(offset + input.limit) : null,
    };
  }

  private listOffset(cursor: string | null, limit: number): number {
    const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    if (
      (cursor !== null && !/^\d+$/.test(cursor)) ||
      !Number.isInteger(offset) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Operations list cursor or limit is invalid.',
      );
    }
    return offset;
  }

  async findRequirementAccessMetadata(id: string) {
    const row = await this.database
      .withSchema(this.schemaName)
      .selectFrom('requirements')
      .leftJoin(
        'material_baselines',
        'material_baselines.id',
        'requirements.current_baseline_id',
      )
      .select([
        'requirements.id',
        'requirements.draft_sensitivity',
        'material_baselines.sensitivity as baseline_sensitivity',
      ])
      .where('requirements.id', '=', id)
      .executeTakeFirst();
    return row
      ? {
          id: row.id,
          sensitivity:
            row.baseline_sensitivity ?? row.draft_sensitivity ?? 'RESTRICTED',
        }
      : null;
  }

  async findRequirementRecordById(id: string) {
    const row = await this.database
      .withSchema(this.schemaName)
      .selectFrom('requirements')
      .leftJoin(
        'material_baselines',
        'material_baselines.id',
        'requirements.current_baseline_id',
      )
      .selectAll('requirements')
      .select([
        'material_baselines.id as baseline_id',
        'material_baselines.version_number as baseline_version_number',
        'material_baselines.status as baseline_status',
        'material_baselines.source_type as baseline_source_type',
        'material_baselines.source_description as baseline_source_description',
        'material_baselines.material_purpose as baseline_material_purpose',
        'material_baselines.sensitivity as baseline_sensitivity',
        'material_baselines.confirmed_by as baseline_confirmed_by',
        'material_baselines.confirmed_at as baseline_confirmed_at',
        'material_baselines.created_at as baseline_created_at',
      ])
      .where('requirements.id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      requirement: mapRequirement(row),
      currentBaseline: row.baseline_id
        ? mapMaterialBaseline({
            id: row.baseline_id,
            requirement_id: row.id,
            version_number: row.baseline_version_number!,
            status: row.baseline_status!,
            source_type: row.baseline_source_type!,
            source_description: row.baseline_source_description,
            material_purpose: row.baseline_material_purpose!,
            sensitivity: row.baseline_sensitivity!,
            confirmed_by: row.baseline_confirmed_by!,
            confirmed_at: row.baseline_confirmed_at!,
            created_at: row.baseline_created_at!,
          })
        : null,
    };
  }

  async listMaterialBaselinesByRequirement(requirementId: string) {
    const rows = await this.database
      .withSchema(this.schemaName)
      .selectFrom('material_baselines')
      .selectAll()
      .where('requirement_id', '=', requirementId)
      .orderBy('version_number', 'desc')
      .execute();
    return rows.map(mapMaterialBaseline);
  }

  async listMaterialImpactsByRequirement(requirementId: string) {
    const rows = await this.database
      .withSchema(this.schemaName)
      .selectFrom('material_impact_assessments')
      .selectAll()
      .where('requirement_id', '=', requirementId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map(mapMaterialImpact);
  }

  async findMaterialImpactById(requirementId: string, impactId: string) {
    const row = await this.database
      .withSchema(this.schemaName)
      .selectFrom('material_impact_assessments')
      .selectAll()
      .where('requirement_id', '=', requirementId)
      .where('id', '=', impactId)
      .executeTakeFirst();
    return row ? mapMaterialImpact(row) : null;
  }

  async findRequirementById(id: string): Promise<Requirement | null> {
    const record = await this.findRequirementRecordById(id);
    return record?.requirement ?? null;
  }

  async listQuestionRecordsByRequirement(
    requirementId: string,
    baselineId: string,
  ): Promise<readonly QuestionRecordWrite[]> {
    const scoped = this.database.withSchema(this.schemaName);
    const questionRows = await scoped
      .selectFrom('questions')
      .selectAll()
      .where('requirement_id', '=', requirementId)
      .where('baseline_id', '=', baselineId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    if (questionRows.length === 0) return [];
    const ids = questionRows.map((row) => row.id);
    const decisionRows = await scoped
      .selectFrom('decisions')
      .selectAll()
      .where('question_id', 'in', ids)
      .orderBy('version_number')
      .orderBy('id')
      .execute();
    return questionRows.map((questionRow) => ({
      question: mapQuestion(questionRow),
      decisions: decisionRows
        .filter((decision) => decision.question_id === questionRow.id)
        .map(mapDecision),
    }));
  }

  async findQuestionRecordById(requirementId: string, questionId: string) {
    const scoped = this.database.withSchema(this.schemaName);
    const questionRow = await scoped
      .selectFrom('questions')
      .selectAll()
      .where('id', '=', questionId)
      .where('requirement_id', '=', requirementId)
      .executeTakeFirst();
    if (!questionRow) return null;
    const decisionRows = await scoped
      .selectFrom('decisions')
      .selectAll()
      .where('question_id', '=', questionId)
      .orderBy('version_number')
      .orderBy('id')
      .execute();
    return {
      question: mapQuestion(questionRow),
      decisions: decisionRows.map(mapDecision),
    };
  }

  async mutateQuestionIdempotently(
    command: IdempotentQuestionWrite,
  ): Promise<IdempotentRequirementWriteResult> {
    const { write } = command;
    validateIdempotency(command.idempotency, write.resultQuestionId);
    if (
      write.question.id !== write.previousQuestionId ||
      write.question.requirementId !== write.requirementId ||
      write.question.rowVersion !== write.previousRowVersion + 1 ||
      write.timelineEvent.requirementId !== write.requirementId ||
      write.timelineEvent.aggregateId !== write.previousQuestionId ||
      write.timelineEvent.aggregateVersion !== write.question.rowVersion ||
      write.outboxEvent.aggregateId !== write.previousQuestionId ||
      write.outboxEvent.aggregateVersion !== write.question.rowVersion
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Question mutation bindings are invalid.',
      );
    }
    const validatedOutboxEvent = createOutboxEvent({
      id: write.outboxEvent.id,
      type: write.outboxEvent.type,
      aggregateType: write.outboxEvent.aggregateType,
      aggregateId: write.outboxEvent.aggregateId,
      aggregateVersion: write.outboxEvent.aggregateVersion,
      occurredAt: write.outboxEvent.occurredAt,
      summary: write.outboxEvent.summary,
    });

    return this.database.transaction().execute(async (transaction) => {
      const scoped = transaction.withSchema(this.schemaName);
      const claim = await claimIdempotency(scoped, command.idempotency);
      if (!claim.claimed) {
        return {
          status:
            claim.existing.requestHash === command.idempotency.requestHash
              ? 'REPLAYED'
              : 'CONFLICT',
          resourceId: claim.existing.resultReference ?? write.resultQuestionId,
        };
      }
      const current = await scoped
        .selectFrom('questions')
        .select(['id', 'requirement_id', 'row_version'])
        .where('id', '=', write.previousQuestionId)
        .forUpdate()
        .executeTakeFirst();
      if (!current || current.requirement_id !== write.requirementId) {
        throw new DomainRuleViolation('NOT_FOUND', 'Question was not found.');
      }
      if (current.row_version !== write.previousRowVersion) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Question row version does not match.',
          { currentVersion: current.row_version },
        );
      }

      if (write.decisionToUpdate) {
        const updated = await scoped
          .updateTable('decisions')
          .set({
            confirmed_role: write.decisionToUpdate.confirmedRole,
            confirmed_by: write.decisionToUpdate.confirmedBy,
            confirmed_at: write.decisionToUpdate.confirmedAt,
            validity: write.decisionToUpdate.validity,
          })
          .where('id', '=', write.decisionToUpdate.id)
          .where('question_id', '=', write.previousQuestionId)
          .executeTakeFirst();
        if (Number(updated.numUpdatedRows) !== 1) {
          throw new DomainRuleViolation('NOT_FOUND', 'Decision was not found.');
        }
      }
      if (write.decisionToInsert) {
        await insertDecision(scoped, write.decisionToInsert);
      }
      const questionUpdated = await scoped
        .updateTable('questions')
        .set({
          status: write.question.status,
          current_decision_id: write.question.currentDecisionId,
          row_version: write.question.rowVersion,
          updated_at: write.question.updatedAt,
        })
        .where('id', '=', write.previousQuestionId)
        .where('row_version', '=', write.previousRowVersion)
        .executeTakeFirst();
      if (Number(questionUpdated.numUpdatedRows) !== 1) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Question row version does not match.',
        );
      }

      if (write.newQuestion) {
        if (
          write.newQuestion.question.requirementId !== write.requirementId ||
          write.newQuestion.decisions.length !== 1 ||
          write.newQuestion.question.currentDecisionId !==
            write.newQuestion.decisions[0]?.id
        ) {
          throw new DomainRuleViolation(
            'VALIDATION_FAILED',
            'Replacement Question bindings are invalid.',
          );
        }
        await insertQuestion(scoped, write.newQuestion.question);
        await insertDecision(scoped, write.newQuestion.decisions[0]);
        await scoped
          .updateTable('questions')
          .set({
            current_decision_id: write.newQuestion.question.currentDecisionId,
          })
          .where('id', '=', write.newQuestion.question.id)
          .executeTakeFirstOrThrow();
      }
      await insertTimelineAndOutbox(scoped, write, validatedOutboxEvent);
      return { status: 'CREATED', resourceId: write.resultQuestionId };
    });
  }

  async listGateRunRecordsByRequirement(
    requirementId: string,
  ): Promise<readonly GateRunRecordWrite[]> {
    const scoped = this.database.withSchema(this.schemaName);
    const rows = await scoped
      .selectFrom('gate_runs')
      .select('id')
      .where('requirement_id', '=', requirementId)
      .orderBy('started_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return Promise.all(
      rows.map(async ({ id }) => {
        const record = await loadGateRunRecord(scoped, requirementId, id);
        if (!record) {
          throw new DomainRuleViolation('NOT_FOUND', 'GateRun was not found.');
        }
        return record;
      }),
    );
  }

  async findGateRunRecordById(requirementId: string, gateRunId: string) {
    return loadGateRunRecord(
      this.database.withSchema(this.schemaName),
      requirementId,
      gateRunId,
    );
  }

  async startGateRunIdempotently(
    command: IdempotentGateRunStartWrite,
  ): Promise<GateRunStartWriteResult> {
    const { write } = command;
    const { gateRun } = write;
    validateIdempotency(command.idempotency, gateRun.id);
    if (
      gateRun.requirementId !== write.requirementId ||
      gateRun.status !== 'IN_PROGRESS' ||
      gateRun.result !== null ||
      write.timelineEvent.requirementId !== write.requirementId ||
      write.timelineEvent.aggregateId !== gateRun.id ||
      write.outboxEvent.aggregateId !== gateRun.id
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'GateRun start bindings are invalid.',
      );
    }
    assertSafeEventSummary(write.timelineEvent.afterSummary);
    const validatedOutbox = createOutboxEvent({
      id: write.outboxEvent.id,
      type: write.outboxEvent.type,
      aggregateType: write.outboxEvent.aggregateType,
      aggregateId: write.outboxEvent.aggregateId,
      aggregateVersion: write.outboxEvent.aggregateVersion,
      occurredAt: write.outboxEvent.occurredAt,
      summary: write.outboxEvent.summary,
    });

    return this.database.transaction().execute(async (transaction) => {
      const scoped = transaction.withSchema(this.schemaName);
      const claim = await claimIdempotency(scoped, command.idempotency);
      if (!claim.claimed) {
        return {
          status:
            claim.existing.requestHash === command.idempotency.requestHash
              ? 'REPLAYED'
              : 'CONFLICT',
          resourceId: claim.existing.resultReference ?? gateRun.id,
        };
      }
      const requirement = await scoped
        .selectFrom('requirements')
        .select(['id', 'current_stage', 'current_baseline_id', 'row_version'])
        .where('id', '=', write.requirementId)
        .forUpdate()
        .executeTakeFirst();
      if (!requirement) {
        throw new DomainRuleViolation(
          'NOT_FOUND',
          'Requirement was not found.',
        );
      }
      if (requirement.row_version !== write.expectedRequirementRowVersion) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Requirement row version does not match.',
          { currentVersion: requirement.row_version },
        );
      }
      if (
        requirement.current_stage !== gateRun.stage ||
        requirement.current_baseline_id !== gateRun.baselineId
      ) {
        throw new DomainRuleViolation(
          'INVALID_STATE_TRANSITION',
          'GateRun is not bound to the current stage and baseline.',
        );
      }
      const inProgress = await scoped
        .selectFrom('gate_runs')
        .select('id')
        .where('requirement_id', '=', gateRun.requirementId)
        .where('baseline_id', '=', gateRun.baselineId)
        .where('stage', '=', gateRun.stage)
        .where('status', '=', 'IN_PROGRESS')
        .executeTakeFirst();
      if (inProgress) {
        await scoped
          .updateTable('idempotency_records')
          .set({
            result_reference: inProgress.id,
            response_summary: { gateRunId: inProgress.id },
          })
          .where('id', '=', command.idempotency.id)
          .executeTakeFirstOrThrow();
        return {
          status: 'REUSED_IN_PROGRESS',
          resourceId: inProgress.id,
        };
      }
      await scoped
        .insertInto('gate_runs')
        .values({
          id: gateRun.id,
          requirement_id: gateRun.requirementId,
          baseline_id: gateRun.baselineId,
          stage: gateRun.stage,
          mode: gateRun.mode,
          status: gateRun.status,
          result: gateRun.result,
          validity: gateRun.validity,
          owner_id: gateRun.ownerId,
          confirmed_role: gateRun.confirmedRole,
          confirmed_by: gateRun.confirmedBy,
          confirmed_at: gateRun.confirmedAt,
          started_at: gateRun.startedAt,
          completed_at: gateRun.completedAt,
          failure_reason: gateRun.failureReason,
          unknown_reason: gateRun.unknownReason,
          registration_note: gateRun.registrationNote,
          created_at: gateRun.startedAt,
        })
        .execute();
      await insertTimelineAndOutbox(scoped, write, validatedOutbox);
      return { status: 'CREATED', resourceId: gateRun.id };
    });
  }

  async completeGateRun(command: CompleteGateRunWrite) {
    assertGateCheckConsistency(command.result, command.checks);
    if (
      command.checks.some((check) => check.gateRunId !== command.gateRunId) ||
      command.evidence.some((item) => item.gateRunId !== command.gateRunId)
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'GateRun child records are bound to another run.',
      );
    }
    const replayed = await this.database
      .transaction()
      .execute(async (transaction) => {
        const scoped = transaction.withSchema(this.schemaName);
        const gateRow = await scoped
          .selectFrom('gate_runs')
          .selectAll()
          .where('id', '=', command.gateRunId)
          .where('requirement_id', '=', command.requirementId)
          .forUpdate()
          .executeTakeFirst();
        if (!gateRow) {
          throw new DomainRuleViolation('NOT_FOUND', 'GateRun was not found.');
        }
        const requirementRow = await scoped
          .selectFrom('requirements')
          .selectAll()
          .where('id', '=', command.requirementId)
          .forUpdate()
          .executeTakeFirst();
        if (!requirementRow) {
          throw new DomainRuleViolation(
            'NOT_FOUND',
            'Requirement was not found.',
          );
        }
        const advancementRow = await scoped
          .selectFrom('stage_advancements')
          .selectAll()
          .where('gate_run_id', '=', command.gateRunId)
          .executeTakeFirst();
        const wasCompleted = gateRow.status === 'COMPLETED';
        const completed = applyGateResult({
          requirement: mapRequirement(requirementRow),
          gateRun: mapGateRun(gateRow),
          result: command.result,
          completedAt: command.completedAt,
          existingAdvancement: advancementRow
            ? mapStageAdvancement(advancementRow)
            : null,
          failureReason: command.failureReason,
          unknownReason: command.unknownReason,
        });
        if (wasCompleted) return true;

        await scoped
          .updateTable('gate_runs')
          .set({
            status: completed.gateRun.status,
            result: completed.gateRun.result,
            validity: completed.gateRun.validity,
            completed_at: completed.gateRun.completedAt,
            failure_reason: completed.gateRun.failureReason,
            unknown_reason: completed.gateRun.unknownReason,
          })
          .where('id', '=', command.gateRunId)
          .where('status', '=', 'IN_PROGRESS')
          .executeTakeFirstOrThrow();
        if (command.checks.length > 0) {
          await scoped
            .insertInto('gate_checks')
            .values(
              command.checks.map((check) => ({
                id: check.id,
                gate_run_id: check.gateRunId,
                check_key: check.checkKey,
                result: check.result,
                reason: check.reason,
                owner_id: check.ownerId,
                close_point: check.closePoint,
                created_at: check.createdAt,
              })),
            )
            .execute();
        }
        if (command.evidence.length > 0) {
          await scoped
            .insertInto('gate_run_evidence')
            .values(
              command.evidence.map((item) => ({
                gate_run_id: item.gateRunId,
                baseline_id: completed.gateRun.baselineId,
                evidence_ref_id: item.evidenceRefId,
                access_decision: item.accessDecision,
                action_authorization_ref: item.actionAuthorizationRef,
                created_at: item.createdAt,
              })),
            )
            .execute();
        }
        if (completed.advancement) {
          await scoped
            .insertInto('stage_advancements')
            .values({
              id: completed.advancement.id,
              gate_run_id: completed.advancement.gateRunId,
              requirement_id: completed.advancement.requirementId,
              baseline_id: completed.advancement.baselineId,
              from_stage: completed.advancement.fromStage,
              to_stage: completed.advancement.toStage,
              advanced_at: completed.advancement.advancedAt,
            })
            .execute();
          await scoped
            .updateTable('requirements')
            .set({
              current_stage: completed.requirement.currentStage,
              row_version: completed.requirement.rowVersion,
              updated_at: completed.requirement.updatedAt,
            })
            .where('id', '=', command.requirementId)
            .where('row_version', '=', requirementRow.row_version)
            .executeTakeFirstOrThrow();
        }

        const gateSummary = {
          gateRunId: completed.gateRun.id,
          stage: completed.gateRun.stage,
          result: command.result,
          validity: completed.gateRun.validity,
        };
        await insertTimelineAndOutbox(
          scoped,
          {
            timelineEvent: {
              id: command.gateTimelineEventId,
              requirementId: command.requirementId,
              aggregateType: 'gateRun',
              aggregateId: command.gateRunId,
              eventType: 'gateRun.completed',
              actorId: command.actorId,
              beforeSummary: { status: 'IN_PROGRESS' },
              afterSummary: gateSummary,
              aggregateVersion: 1,
              occurredAt: command.completedAt,
            },
            outboxEvent: createOutboxEvent({
              id: command.gateOutboxEventId,
              type: 'gateRun.completed',
              aggregateType: 'gateRun',
              aggregateId: command.gateRunId,
              aggregateVersion: 1,
              occurredAt: command.completedAt,
              summary: gateSummary,
            }),
          },
          createOutboxEvent({
            id: command.gateOutboxEventId,
            type: 'gateRun.completed',
            aggregateType: 'gateRun',
            aggregateId: command.gateRunId,
            aggregateVersion: 1,
            occurredAt: command.completedAt,
            summary: gateSummary,
          }),
        );
        if (completed.advancement) {
          const advancementSummary = {
            gateRunId: completed.advancement.gateRunId,
            fromStage: completed.advancement.fromStage,
            toStage: completed.advancement.toStage,
          };
          const advancementOutbox = createOutboxEvent({
            id: command.advancementOutboxEventId,
            type: 'requirement.advanced',
            aggregateType: 'requirement',
            aggregateId: command.requirementId,
            aggregateVersion: completed.requirement.rowVersion,
            occurredAt: command.completedAt,
            summary: advancementSummary,
          });
          await insertTimelineAndOutbox(
            scoped,
            {
              timelineEvent: {
                id: command.advancementTimelineEventId,
                requirementId: command.requirementId,
                aggregateType: 'requirement',
                aggregateId: command.requirementId,
                eventType: 'requirement.advanced',
                actorId: command.actorId,
                beforeSummary: {
                  stage: completed.advancement.fromStage,
                },
                afterSummary: advancementSummary,
                aggregateVersion: completed.requirement.rowVersion,
                occurredAt: command.completedAt,
              },
              outboxEvent: advancementOutbox,
            },
            advancementOutbox,
          );
        }
        return false;
      });

    const [gateRun, requirement] = await Promise.all([
      this.findGateRunRecordById(command.requirementId, command.gateRunId),
      this.findRequirementRecordById(command.requirementId),
    ]);
    if (!gateRun || !requirement) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'GateRun completion result is unknown.',
      );
    }
    return { replayed, gateRun, requirement };
  }

  async createMaterialImpactIdempotently(
    command: IdempotentMaterialImpactWrite<CreateMaterialImpactWrite>,
  ): Promise<IdempotentRequirementWriteResult> {
    validateIdempotency(command.idempotency, command.write.assessment.id);
    assertSafeEventSummary(command.write.timelineEvent.afterSummary);
    const validatedOutbox = createOutboxEvent({
      id: command.write.outboxEvent.id,
      type: command.write.outboxEvent.type,
      aggregateType: command.write.outboxEvent.aggregateType,
      aggregateId: command.write.outboxEvent.aggregateId,
      aggregateVersion: command.write.outboxEvent.aggregateVersion,
      occurredAt: command.write.outboxEvent.occurredAt,
      summary: command.write.outboxEvent.summary,
    });
    return this.database.transaction().execute(async (transaction) => {
      const scoped = transaction.withSchema(this.schemaName);
      const claim = await claimIdempotency(scoped, command.idempotency);
      if (!claim.claimed) {
        return {
          status:
            claim.existing.requestHash === command.idempotency.requestHash
              ? 'REPLAYED'
              : 'CONFLICT',
          resourceId:
            claim.existing.resultReference ?? command.write.assessment.id,
        };
      }
      const current = await scoped
        .selectFrom('requirements')
        .select(['id', 'current_baseline_id', 'row_version'])
        .where('id', '=', command.write.requirementId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) {
        throw new DomainRuleViolation(
          'NOT_FOUND',
          'Requirement was not found.',
        );
      }
      if (
        current.current_baseline_id !== command.write.expectedCurrentBaselineId
      ) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'The current baseline changed before impact registration.',
          { currentVersion: current.row_version },
        );
      }
      const pending = await scoped
        .selectFrom('material_impact_assessments')
        .select('id')
        .where('requirement_id', '=', command.write.requirementId)
        .where('status', '=', 'PENDING')
        .executeTakeFirst();
      if (pending) {
        throw new DomainRuleViolation(
          'INVALID_STATE_TRANSITION',
          'A material impact is already pending.',
          { existingResourceId: pending.id },
        );
      }
      const maxVersion = await scoped
        .selectFrom('material_baselines')
        .select(({ fn }) => fn.max<number>('version_number').as('version'))
        .where('requirement_id', '=', command.write.requirementId)
        .executeTakeFirstOrThrow();
      if (
        command.write.candidateBaseline.versionNumber !==
        Number(maxVersion.version ?? 0) + 1
      ) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Candidate baseline version is stale.',
          { currentVersion: current.row_version },
        );
      }
      const baseline = command.write.candidateBaseline;
      await scoped
        .insertInto('material_baselines')
        .values({
          id: baseline.id,
          requirement_id: baseline.requirementId,
          version_number: baseline.versionNumber,
          status: baseline.status,
          source_type: baseline.sourceType,
          source_description: baseline.sourceDescription,
          material_purpose: baseline.materialPurpose,
          sensitivity: baseline.sensitivity,
          confirmed_by: baseline.confirmedBy,
          confirmed_at: baseline.confirmedAt,
          created_at: baseline.createdAt,
        })
        .execute();
      const assessment = command.write.assessment;
      await scoped
        .insertInto('material_impact_assessments')
        .values({
          id: assessment.id,
          requirement_id: assessment.requirementId,
          original_baseline_id: assessment.originalBaselineId,
          candidate_baseline_id: assessment.candidateBaselineId,
          recommended_stage: assessment.recommendedStage,
          selected_stage: assessment.selectedStage,
          decision: assessment.decision,
          reason: assessment.reason,
          status: assessment.status,
          confirmed_role: assessment.confirmedRole,
          confirmed_by: assessment.confirmedBy,
          confirmed_at: assessment.confirmedAt,
          created_at: assessment.createdAt,
        })
        .execute();
      await insertTimelineAndOutbox(scoped, command.write, validatedOutbox);
      return { status: 'CREATED', resourceId: assessment.id };
    });
  }

  async confirmMaterialImpactIdempotently(
    command: IdempotentMaterialImpactWrite<ConfirmMaterialImpactWrite>,
  ): Promise<IdempotentRequirementWriteResult> {
    validateIdempotency(command.idempotency, command.write.assessment.id);
    assertSafeEventSummary(command.write.timelineEvent.afterSummary);
    const validatedOutbox = createOutboxEvent({
      id: command.write.outboxEvent.id,
      type: command.write.outboxEvent.type,
      aggregateType: command.write.outboxEvent.aggregateType,
      aggregateId: command.write.outboxEvent.aggregateId,
      aggregateVersion: command.write.outboxEvent.aggregateVersion,
      occurredAt: command.write.outboxEvent.occurredAt,
      summary: command.write.outboxEvent.summary,
    });
    return this.database.transaction().execute(async (transaction) => {
      const scoped = transaction.withSchema(this.schemaName);
      const claim = await claimIdempotency(scoped, command.idempotency);
      if (!claim.claimed) {
        return {
          status:
            claim.existing.requestHash === command.idempotency.requestHash
              ? 'REPLAYED'
              : 'CONFLICT',
          resourceId:
            claim.existing.resultReference ?? command.write.assessment.id,
        };
      }
      if (command.write.invalidatedGateRunIds.length > 0) {
        await scoped
          .selectFrom('gate_runs')
          .select('id')
          .where('id', 'in', [...command.write.invalidatedGateRunIds])
          .orderBy('id')
          .forUpdate()
          .execute();
      }
      const current = await scoped
        .selectFrom('requirements')
        .select(['id', 'current_baseline_id', 'row_version'])
        .where('id', '=', command.write.requirement.id)
        .forUpdate()
        .executeTakeFirst();
      const impact = await scoped
        .selectFrom('material_impact_assessments')
        .selectAll()
        .where('id', '=', command.write.assessment.id)
        .where('requirement_id', '=', command.write.requirement.id)
        .forUpdate()
        .executeTakeFirst();
      if (!current || !impact) {
        throw new DomainRuleViolation(
          'NOT_FOUND',
          'Material impact was not found.',
        );
      }
      if (
        current.row_version !== command.write.previousRowVersion ||
        current.current_baseline_id !== command.write.previousBaseline.id ||
        impact.status !== 'PENDING' ||
        impact.original_baseline_id !== command.write.previousBaseline.id ||
        impact.candidate_baseline_id !== command.write.currentBaseline.id
      ) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Material impact is no longer pending on the current baseline.',
          { currentVersion: current.row_version },
        );
      }
      await scoped
        .updateTable('material_baselines')
        .set({ status: 'HISTORICAL' })
        .where('id', '=', command.write.previousBaseline.id)
        .where('status', '=', 'CURRENT')
        .executeTakeFirstOrThrow();
      await scoped
        .updateTable('material_baselines')
        .set({
          status: 'CURRENT',
          confirmed_by: command.write.currentBaseline.confirmedBy,
          confirmed_at: command.write.currentBaseline.confirmedAt,
        })
        .where('id', '=', command.write.currentBaseline.id)
        .where('status', '=', 'CANDIDATE')
        .executeTakeFirstOrThrow();
      if (command.write.invalidatedGateRunIds.length > 0) {
        const updated = await scoped
          .updateTable('gate_runs')
          .set({ validity: 'INVALIDATED' })
          .where('requirement_id', '=', command.write.requirement.id)
          .where('baseline_id', '=', command.write.previousBaseline.id)
          .where('id', 'in', [...command.write.invalidatedGateRunIds])
          .where('validity', '=', 'CURRENT')
          .executeTakeFirst();
        if (
          Number(updated.numUpdatedRows) !==
          command.write.invalidatedGateRunIds.length
        ) {
          throw new DomainRuleViolation(
            'VERSION_CONFLICT',
            'GateRun invalidation scope changed during baseline switch.',
            { currentVersion: current.row_version },
          );
        }
      }
      await scoped
        .updateTable('material_impact_assessments')
        .set({
          selected_stage: command.write.assessment.selectedStage,
          decision: command.write.assessment.decision,
          reason: command.write.assessment.reason,
          status: command.write.assessment.status,
          confirmed_role: command.write.assessment.confirmedRole,
          confirmed_by: command.write.assessment.confirmedBy,
          confirmed_at: command.write.assessment.confirmedAt,
          invalidated_gate_run_ids: JSON.stringify(
            command.write.assessment.invalidatedGateRunIds,
          ),
        })
        .where('id', '=', command.write.assessment.id)
        .where('status', '=', 'PENDING')
        .executeTakeFirstOrThrow();
      await scoped
        .updateTable('requirements')
        .set({
          current_baseline_id: command.write.requirement.currentBaselineId,
          current_stage: command.write.requirement.currentStage,
          row_version: command.write.requirement.rowVersion,
          updated_at: command.write.requirement.updatedAt,
        })
        .where('id', '=', command.write.requirement.id)
        .where('row_version', '=', command.write.previousRowVersion)
        .executeTakeFirstOrThrow();
      await insertTimelineAndOutbox(scoped, command.write, validatedOutbox);
      return { status: 'CREATED', resourceId: command.write.assessment.id };
    });
  }

  async listTimelineEvents(input: {
    requirementId: string;
    cursor: number | null;
    afterSequence: number | null;
    limit: number;
  }) {
    let query = this.database
      .withSchema(this.schemaName)
      .selectFrom('timeline_events')
      .selectAll()
      .where('requirement_id', '=', input.requirementId);
    if (input.afterSequence !== null) {
      query = query.where('sequence', '>', input.afterSequence);
    } else if (input.cursor !== null) {
      query = query.where('sequence', '<', input.cursor);
    }
    const rows = await query
      .orderBy('sequence', input.afterSequence === null ? 'desc' : 'asc')
      .limit(input.limit + 1)
      .execute();
    const hasNext = input.afterSequence === null && rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((row) => ({
        sequence: row.sequence,
        event: {
          id: row.id,
          requirementId: row.requirement_id,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          eventType: row.event_type,
          actorId: row.actor_id,
          beforeSummary: row.before_summary as EventSummary | null,
          afterSummary: row.after_summary as EventSummary,
          aggregateVersion: row.aggregate_version,
          occurredAt: timestamp(row.occurred_at),
        } satisfies TimelineEvent,
      })),
      nextCursor: hasNext ? (page.at(-1)?.sequence ?? null) : null,
    };
  }

  async hasTimelineEvent(input: { requirementId: string; sequence: number }) {
    const row = await this.database
      .withSchema(this.schemaName)
      .selectFrom('timeline_events')
      .select('id')
      .where('requirement_id', '=', input.requirementId)
      .where('sequence', '=', input.sequence)
      .executeTakeFirst();
    return Boolean(row);
  }

  async findIdempotencyRecord(input: {
    actorId: string;
    route: string;
    idempotencyKey: string;
  }): Promise<IdempotencyRecord | null> {
    const row = await this.database
      .withSchema(this.schemaName)
      .selectFrom('idempotency_records')
      .selectAll()
      .where('actor_id', '=', input.actorId)
      .where('route', '=', input.route)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();
    return row
      ? {
          id: row.id,
          actorId: row.actor_id,
          route: row.route,
          idempotencyKey: row.idempotency_key,
          requestHash: row.request_hash,
          resultReference: row.result_reference,
          responseSummary: row.response_summary,
          createdAt: timestamp(row.created_at),
        }
      : null;
  }

  async listPendingOutbox(limit: number): Promise<readonly OutboxEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('OUTBOX_LIMIT_OUT_OF_RANGE');
    }
    const rows = await this.database
      .withSchema(this.schemaName)
      .selectFrom('outbox_events')
      .selectAll()
      .where('status', '=', 'PENDING')
      .orderBy('sequence')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      type: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_version,
      occurredAt: timestamp(row.occurred_at),
      summary: row.payload_summary,
      status: row.status,
    }));
  }
}
