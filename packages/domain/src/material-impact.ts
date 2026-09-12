import type {
  ActorRole,
  LifecycleStage,
  MaterialImpactConfirmationRole,
  MaterialImpactDecision,
} from '@pfc/contracts';
import { LIFECYCLE_STAGES } from '@pfc/contracts';

import { DomainRuleViolation } from './errors.ts';
import { evaluateG0Registration } from './requirement.ts';
import type {
  G0Registration,
  MaterialBaseline,
  MaterialImpactAssessment,
  Requirement,
} from './types.ts';

function requireText(value: string, field: string): string {
  if (!value.trim()) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      `${field} is required.`,
      {
        field,
      },
    );
  }
  return value.trim();
}

function stageIndex(stage: LifecycleStage): number {
  return LIFECYCLE_STAGES.indexOf(stage);
}

export function createMaterialImpactAssessment(input: {
  assessmentId: string;
  candidateBaselineId: string;
  requirement: Requirement;
  currentBaseline: MaterialBaseline;
  nextVersionNumber?: number;
  registration: G0Registration;
  recommendedStage: LifecycleStage;
  actorId: string;
  now: string;
}): Readonly<{
  requirement: Requirement;
  candidateBaseline: MaterialBaseline;
  assessment: MaterialImpactAssessment;
}> {
  if (input.requirement.currentBaselineId !== input.currentBaseline.id) {
    throw new DomainRuleViolation(
      'VERSION_CONFLICT',
      'The supplied baseline is no longer current.',
      { currentVersion: input.requirement.rowVersion },
    );
  }
  if (
    stageIndex(input.recommendedStage) >
    stageIndex(input.requirement.currentStage)
  ) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'The recommended stage cannot be later than the current stage.',
    );
  }
  const evaluation = evaluateG0Registration({
    ...input.registration,
    businessOwnerId:
      input.registration.businessOwnerId ?? input.requirement.businessOwnerId,
  });
  if (!evaluation.complete) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Candidate baseline metadata is incomplete.',
      { missingFields: evaluation.missingFields },
    );
  }
  const sourceType = input.registration.sourceType!;
  const candidateBaseline: MaterialBaseline = {
    id: requireText(input.candidateBaselineId, 'candidateBaselineId'),
    requirementId: input.requirement.id,
    versionNumber:
      input.nextVersionNumber ?? input.currentBaseline.versionNumber + 1,
    status: 'CANDIDATE',
    sourceType,
    sourceDescription:
      sourceType === 'OTHER'
        ? requireText(
            input.registration.sourceDescription ?? '',
            'sourceDescription',
          )
        : null,
    materialPurpose: input.registration.materialPurpose!,
    sensitivity: input.registration.sensitivity!,
    confirmedBy: requireText(input.actorId, 'actorId'),
    confirmedAt: input.now,
    createdAt: input.now,
  };
  return {
    requirement: input.requirement,
    candidateBaseline,
    assessment: {
      id: requireText(input.assessmentId, 'assessmentId'),
      requirementId: input.requirement.id,
      originalBaselineId: input.currentBaseline.id,
      candidateBaselineId: candidateBaseline.id,
      recommendedStage: input.recommendedStage,
      selectedStage: null,
      decision: null,
      reason: null,
      status: 'PENDING',
      confirmedRole: null,
      confirmedBy: null,
      confirmedAt: null,
      invalidatedGateRunIds: [],
      createdAt: input.now,
    },
  };
}

export function confirmMaterialImpact(input: {
  requirement: Requirement;
  currentBaseline: MaterialBaseline;
  candidateBaseline: MaterialBaseline;
  assessment: MaterialImpactAssessment;
  decision: MaterialImpactDecision;
  selectedStage: LifecycleStage | null;
  reason: string;
  confirmedRole: MaterialImpactConfirmationRole;
  confirmedBy: string;
  actorRoles: readonly ActorRole[];
  expectedRowVersion: number;
  gateRuns: readonly Readonly<{ id: string; stage: LifecycleStage }>[];
  now: string;
}): Readonly<{
  requirement: Requirement;
  previousBaseline: MaterialBaseline;
  currentBaseline: MaterialBaseline;
  assessment: MaterialImpactAssessment;
  invalidatedGateRunIds: readonly string[];
}> {
  if (input.requirement.rowVersion !== input.expectedRowVersion) {
    throw new DomainRuleViolation(
      'VERSION_CONFLICT',
      'Requirement row version does not match.',
      { currentVersion: input.requirement.rowVersion },
    );
  }
  if (
    input.requirement.currentBaselineId !== input.currentBaseline.id ||
    input.assessment.originalBaselineId !== input.currentBaseline.id ||
    input.assessment.candidateBaselineId !== input.candidateBaseline.id ||
    input.candidateBaseline.status !== 'CANDIDATE'
  ) {
    throw new DomainRuleViolation(
      'VERSION_CONFLICT',
      'Material impact baselines no longer match the current requirement.',
      { currentVersion: input.requirement.rowVersion },
    );
  }
  if (input.assessment.status !== 'PENDING') {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      'Only a pending material impact can be confirmed.',
    );
  }
  if (!input.actorRoles.includes(input.confirmedRole)) {
    throw new DomainRuleViolation(
      'PERMISSION_DENIED',
      'The confirming role does not belong to the current actor.',
    );
  }
  const reason = requireText(input.reason, 'reason');
  if (input.decision === 'IMPACTS') {
    if (!input.selectedStage) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'An impacted stage is required.',
      );
    }
    if (
      stageIndex(input.selectedStage) >
      stageIndex(input.requirement.currentStage)
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'The impacted stage cannot be later than the current stage.',
      );
    }
  } else if (input.selectedStage !== null) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'NO_IMPACT cannot select an impacted stage.',
    );
  }

  const selectedStage =
    input.decision === 'IMPACTS' ? input.selectedStage! : null;
  const invalidatedGateRunIds = selectedStage
    ? input.gateRuns
        .filter((run) => stageIndex(run.stage) >= stageIndex(selectedStage))
        .map((run) => run.id)
    : [];
  return {
    requirement: {
      ...input.requirement,
      currentBaselineId: input.candidateBaseline.id,
      currentStage: selectedStage ?? input.requirement.currentStage,
      rowVersion: input.requirement.rowVersion + 1,
      updatedAt: input.now,
    },
    previousBaseline: { ...input.currentBaseline, status: 'HISTORICAL' },
    currentBaseline: {
      ...input.candidateBaseline,
      status: 'CURRENT',
      confirmedBy: input.confirmedBy,
      confirmedAt: input.now,
    },
    assessment: {
      ...input.assessment,
      selectedStage,
      decision: input.decision,
      reason,
      status: 'CONFIRMED',
      confirmedRole: input.confirmedRole,
      confirmedBy: input.confirmedBy,
      confirmedAt: input.now,
      invalidatedGateRunIds,
    },
    invalidatedGateRunIds,
  };
}
