import { createHash } from 'node:crypto';

import type { ActorContext } from '@pfc/contracts';
import {
  createInitialMaterialRef,
  createMaterialImpactAssessment,
  type Decision,
  type Question,
} from '@pfc/domain';
import type { LifecycleKysely } from '@pfc/persistence';
import type {
  GateRunRecord,
  RequirementWrite,
} from '../../../apps/server/src/requirements/repository-port.ts';

import { createT3Fixture } from './t3-fixture.ts';
import { createT5Fixture } from './t5-fixture.ts';
import { createT6Fixture } from './t6-fixture.ts';

const idPrefix = 'CODEx_TEST_EXPERIENCE_' as const;
const actorId = `${idPrefix}ACTOR_FULL_ACCESS` as const;

function rewriteRequirement(
  write: RequirementWrite,
  name: string,
  originalIdea: string,
): RequirementWrite {
  const requirement = {
    ...write.requirement,
    name,
    originalIdea,
    initiatorId: actorId,
    businessOwnerId: write.materialBaseline ? actorId : null,
  };
  const materialBaseline = write.materialBaseline
    ? { ...write.materialBaseline, confirmedBy: actorId }
    : null;
  return {
    ...write,
    requirement,
    materialBaseline,
    materialRefs: materialBaseline
      ? [
          createInitialMaterialRef({
            id:
              write.materialRefs[0]?.id ??
              `${materialBaseline.id}_ORIGINAL_IDEA`,
            requirement,
            baseline: materialBaseline,
            contentHash: `sha256:${createHash('sha256')
              .update(originalIdea)
              .digest('hex')}`,
          }),
        ]
      : [],
    timelineEvent: { ...write.timelineEvent, actorId },
  };
}

function rewriteQuestion(record: {
  question: Question;
  decisions: readonly Decision[];
}) {
  return {
    question: { ...record.question, ownerId: actorId },
    decisions: record.decisions.map((decision) => ({
      ...decision,
      confirmedBy: decision.confirmedBy ? actorId : null,
    })),
  };
}

function rewriteGateRun(record: GateRunRecord): GateRunRecord {
  return {
    ...record,
    gateRun: {
      ...record.gateRun,
      ownerId: actorId,
      confirmedBy: record.gateRun.confirmedBy ? actorId : null,
    },
  };
}

export function createLocalExperienceFixture() {
  const draft = createT3Fixture('EXPERIENCE_SEED_DRAFT');
  const gate = createT5Fixture('EXPERIENCE_SEED_GATE');
  const rich = createT6Fixture('EXPERIENCE_SEED_RICH');
  const pendingImpact = createMaterialImpactAssessment({
    assessmentId: `${idPrefix}PENDING_IMPACT_1`,
    candidateBaselineId: `${idPrefix}CANDIDATE_BASELINE_1`,
    requirement: rich.requirementWrite.requirement,
    currentBaseline: rich.requirementWrite.materialBaseline!,
    registration: {
      ...rich.createRequest.candidateBaseline,
      businessOwnerId: actorId,
    },
    recommendedStage: rich.createRequest.recommendedStage,
    actorId,
    now: rich.now,
  });
  const draftWrite = draft.seedWrites.find(
    (item) => item.requirement.id === draft.requirementIds.incomplete,
  );
  if (!draftWrite) throw new Error('EXPERIENCE_DRAFT_FIXTURE_REQUIRED');

  const actor: ActorContext = {
    actorId,
    roles: [
      'PRODUCT_MANAGER',
      'PRODUCT_OWNER',
      'BUSINESS_OWNER',
      'ENGINEERING_OWNER',
      'TEST_OWNER',
      'RELEASE_OWNER',
      'TEAM_ADMIN',
    ],
    teamIds: [`${idPrefix}TEAM_FULL_ACCESS`],
    authenticationStatus: 'AUTHENTICATED',
  };

  return {
    actor,
    requirementWrites: [
      rewriteRequirement(
        draftWrite,
        '体验：待补齐登记的渠道需求',
        '统一渠道需求的登记信息与责任归属。',
      ),
      rewriteRequirement(
        gate.requirementWrite,
        '体验：可执行门禁的结算规则',
        '明确结算口径，并在 G0 门禁留下可审计记录。',
      ),
      rewriteRequirement(
        rich.requirementWrite,
        '体验：材料变更影响评估',
        '新增访谈材料后，评估影响阶段并保留历史门禁。',
      ),
    ],
    questionRecords: gate.questionRecords.map(rewriteQuestion),
    gateRuns: rich.gateRuns.map(rewriteGateRun),
    additionalMaterialBaselines: [pendingImpact.candidateBaseline],
    materialImpacts: [pendingImpact.assessment],
    materialRefs: [
      {
        id: gate.evidenceRefId,
        baselineId: gate.baselineId,
        referenceType: 'PRODUCT_SPEC',
      },
      {
        id: rich.evidenceRefId,
        baselineId: rich.baselineId,
        referenceType: 'USER_INTERVIEW_NOTE',
      },
    ],
  } as const;
}

type LocalExperienceFixture = ReturnType<typeof createLocalExperienceFixture>;

function assertExperienceSeedScope(
  schemaName: string,
  fixture: LocalExperienceFixture,
): void {
  if (
    schemaName !== 'pfc_experience' &&
    !schemaName.startsWith('codex_test_')
  ) {
    throw new Error('EXPERIENCE_SEED_SCHEMA_FORBIDDEN');
  }
  const ids = [
    fixture.actor.actorId,
    ...fixture.requirementWrites.flatMap((write) => [
      write.requirement.id,
      write.requirement.initiatorId,
      write.materialBaseline?.id ?? idPrefix,
      write.timelineEvent.id,
      write.timelineEvent.actorId,
      write.outboxEvent.id,
    ]),
    ...fixture.questionRecords.flatMap((record) => [
      record.question.id,
      record.question.ownerId,
      ...record.decisions.flatMap((decision) => [
        decision.id,
        decision.confirmedBy ?? actorId,
      ]),
    ]),
    ...fixture.gateRuns.flatMap((record) => [
      record.gateRun.id,
      record.gateRun.ownerId,
    ]),
    ...fixture.materialRefs.map((materialRef) => materialRef.id),
    ...fixture.additionalMaterialBaselines.flatMap((baseline) => [
      baseline.id,
      baseline.confirmedBy,
    ]),
    ...fixture.materialImpacts.map((impact) => impact.id),
  ];
  if (ids.some((id) => !id.startsWith(idPrefix))) {
    throw new Error('EXPERIENCE_SEED_ID_FORBIDDEN');
  }
}

export async function seedLocalExperienceDatabase(
  database: LifecycleKysely,
  schemaName: string,
  fixture: LocalExperienceFixture = createLocalExperienceFixture(),
) {
  assertExperienceSeedScope(schemaName, fixture);
  return database.transaction().execute(async (transaction) => {
    const scoped = transaction.withSchema(schemaName);

    for (const write of fixture.requirementWrites) {
      const {
        requirement,
        materialBaseline,
        materialRefs,
        timelineEvent,
        outboxEvent,
      } = write;
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
        await scoped
          .updateTable('requirements')
          .set({ current_baseline_id: materialBaseline.id })
          .where('id', '=', requirement.id)
          .executeTakeFirstOrThrow();
      }
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
    for (const materialRef of fixture.materialRefs) {
      await scoped
        .insertInto('material_refs')
        .values({
          id: materialRef.id,
          baseline_id: materialRef.baselineId,
          reference_type: materialRef.referenceType,
          source: 'SYNTHETIC_LOCAL_EXPERIENCE',
          version: '1',
          content_hash: null,
          location: `experience://${materialRef.id}`,
          sensitivity: 'INTERNAL',
          validity: 'VALID',
        })
        .execute();
    }
    for (const baseline of fixture.additionalMaterialBaselines) {
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
    }
    for (const impact of fixture.materialImpacts) {
      await scoped
        .insertInto('material_impact_assessments')
        .values({
          id: impact.id,
          requirement_id: impact.requirementId,
          original_baseline_id: impact.originalBaselineId,
          candidate_baseline_id: impact.candidateBaselineId,
          recommended_stage: impact.recommendedStage,
          selected_stage: impact.selectedStage,
          decision: impact.decision,
          reason: impact.reason,
          status: impact.status,
          confirmed_role: impact.confirmedRole,
          confirmed_by: impact.confirmedBy,
          confirmed_at: impact.confirmedAt,
          invalidated_gate_run_ids: JSON.stringify(
            impact.invalidatedGateRunIds,
          ),
          created_at: impact.createdAt,
        })
        .execute();
    }
    for (const record of fixture.questionRecords) {
      const { question } = record;
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
      for (const decision of record.decisions) {
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
      if (question.currentDecisionId) {
        await scoped
          .updateTable('questions')
          .set({ current_decision_id: question.currentDecisionId })
          .where('id', '=', question.id)
          .executeTakeFirstOrThrow();
      }
    }
    for (const { gateRun } of fixture.gateRuns) {
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
        })
        .execute();
    }
    return {
      requirements: fixture.requirementWrites.length,
      questions: fixture.questionRecords.length,
      gateRuns: fixture.gateRuns.length,
    };
  });
}
