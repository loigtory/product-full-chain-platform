import { createHash } from 'node:crypto';

import {
  createInitialMaterialRef,
  createOutboxEvent,
  createRequirementDraft,
} from '@pfc/domain';
import type { CreateRequirementWrite } from '@pfc/persistence';

const occurredAt = '2026-09-04T11:00:00.000Z';

function prefixFor(runId: string): string {
  const normalized = runId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 48);
  if (!normalized) throw new Error('TEST_RUN_ID_REQUIRED');
  return `CODEx_TEST_${normalized}`;
}

function createWrite(prefix: string, suffix: string): CreateRequirementWrite {
  const requirementId = `${prefix}_REQ_${suffix}`;
  const baselineId = `${prefix}_BASELINE_${suffix}_1`;
  const draft = createRequirementDraft({
    id: requirementId,
    name: `Synthetic T1 requirement ${suffix}`,
    originalIdea: 'Synthetic local-only lifecycle fixture.',
    initiatorId: `${prefix}_ACTOR_PM`,
    now: occurredAt,
    registration: {
      sourceType: 'INTERNAL_IMPROVEMENT',
      businessOwnerId: `${prefix}_ACTOR_OWNER`,
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
    },
    initialBaselineId: baselineId,
    confirmedBy: `${prefix}_ACTOR_OWNER`,
  });

  return {
    requirement: draft.requirement,
    materialBaseline: draft.materialBaseline!,
    materialRefs: [
      createInitialMaterialRef({
        id: `${prefix}_MATERIAL_REF_${suffix}_1`,
        requirement: draft.requirement,
        baseline: draft.materialBaseline!,
        contentHash: `sha256:${createHash('sha256')
          .update(draft.requirement.originalIdea)
          .digest('hex')}`,
      }),
    ],
    timelineEvent: {
      id: `${prefix}_TIMELINE_${suffix}_1`,
      requirementId,
      aggregateType: 'requirement',
      aggregateId: requirementId,
      eventType: 'requirement.created',
      actorId: `${prefix}_ACTOR_PM`,
      beforeSummary: null,
      afterSummary: { stage: 'G0', incomplete: false },
      aggregateVersion: draft.requirement.rowVersion,
      occurredAt,
    },
    outboxEvent: createOutboxEvent({
      id: `${prefix}_OUTBOX_${suffix}_1`,
      type: 'requirement.created',
      aggregateType: 'requirement',
      aggregateId: requirementId,
      aggregateVersion: draft.requirement.rowVersion,
      occurredAt,
      summary: { stage: 'G0', incomplete: false },
    }),
  };
}

export function createT1Fixture(runId: string) {
  const prefix = prefixFor(runId);
  const primaryWrite = createWrite(prefix, 'PRIMARY');
  const rollbackWrite = createWrite(prefix, 'ROLLBACK');
  const unsafeWrite = createWrite(prefix, 'UNSAFE');
  const invalidBindingWrite = createWrite(prefix, 'INVALID_BINDING');
  const primaryBaseline = primaryWrite.materialBaseline!;

  return {
    prefix,
    primaryWrite,
    rollbackWrite,
    unsafeWrite,
    invalidBindingWrite,
    secondCurrentBaseline: {
      id: `${prefix}_BASELINE_PRIMARY_2`,
      requirement_id: primaryWrite.requirement.id,
      version_number: 2,
      status: 'CURRENT' as const,
      source_type: 'BUSINESS_FEEDBACK' as const,
      source_description: null,
      material_purpose: 'CONSTRAINT' as const,
      sensitivity: 'INTERNAL' as const,
      confirmed_by: `${prefix}_ACTOR_OWNER`,
      confirmed_at: occurredAt,
      created_at: occurredAt,
    },
    inProgressGateRun: {
      id: `${prefix}_GATE_RUN_G0`,
      requirement_id: primaryWrite.requirement.id,
      baseline_id: primaryBaseline.id,
      stage: 'G0' as const,
      mode: 'MANUAL' as const,
      status: 'IN_PROGRESS' as const,
      result: null,
      validity: 'CURRENT' as const,
      owner_id: `${prefix}_ACTOR_OWNER`,
      confirmed_role: 'BUSINESS_OWNER',
      confirmed_by: `${prefix}_ACTOR_OWNER`,
      confirmed_at: occurredAt,
      started_at: occurredAt,
      completed_at: null,
      failure_reason: null,
      unknown_reason: null,
      registration_note: 'Synthetic manual GateRun.',
      created_at: occurredAt,
    },
    completedGateRun: {
      id: `${prefix}_GATE_RUN_G0_COMPLETED`,
      requirement_id: primaryWrite.requirement.id,
      baseline_id: primaryBaseline.id,
      stage: 'G0' as const,
      mode: 'MANUAL' as const,
      status: 'COMPLETED' as const,
      result: 'PASS' as const,
      validity: 'CURRENT' as const,
      owner_id: `${prefix}_ACTOR_OWNER`,
      confirmed_role: 'BUSINESS_OWNER',
      confirmed_by: `${prefix}_ACTOR_OWNER`,
      confirmed_at: occurredAt,
      started_at: occurredAt,
      completed_at: occurredAt,
      failure_reason: null,
      unknown_reason: null,
      registration_note: 'Synthetic manual GateRun.',
      created_at: occurredAt,
    },
    stageAdvancement: {
      id: `${prefix}_ADVANCEMENT_G0_G1`,
      gate_run_id: `${prefix}_GATE_RUN_G0_COMPLETED`,
      requirement_id: primaryWrite.requirement.id,
      baseline_id: primaryBaseline.id,
      from_stage: 'G0' as const,
      to_stage: 'G1' as const,
      advanced_at: occurredAt,
    },
  } as const;
}
