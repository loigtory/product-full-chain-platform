import {
  GATE_CONFIRMATION_ROLES,
  GATE_RUN_RESULTS,
  type GateConfirmationRole,
  type GateRunResult,
  type LifecycleStage,
} from '@pfc/contracts';

import { DomainRuleViolation } from './errors.ts';
import type { GateRun, Requirement, StageAdvancement } from './types.ts';
import type { GateCheck } from './types.ts';

function nonBlank(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized || normalized.length > 2_000) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      `${field} is required and must not exceed 2000 characters.`,
      { field },
    );
  }
  return normalized;
}

export function createGateRun(input: {
  id: string;
  requirementId: string;
  baselineId: string;
  stage: LifecycleStage;
  mode: 'AUTOMATIC' | 'MANUAL';
  ownerId: string;
  confirmedRole?: GateConfirmationRole;
  confirmedBy?: string;
  registrationNote?: string;
  now: string;
}): GateRun {
  const manualFieldsPresent =
    input.confirmedRole !== undefined ||
    input.confirmedBy !== undefined ||
    input.registrationNote !== undefined;
  if (input.mode === 'MANUAL') {
    if (
      !input.confirmedRole ||
      !GATE_CONFIRMATION_ROLES.includes(input.confirmedRole)
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'A manual GateRun requires a lifecycle responsibility role.',
      );
    }
    nonBlank(input.confirmedBy, 'confirmedBy');
    nonBlank(input.registrationNote, 'registrationNote');
  } else if (manualFieldsPresent) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'An automatic GateRun cannot contain manual confirmation fields.',
    );
  }

  return {
    id: nonBlank(input.id, 'id'),
    requirementId: nonBlank(input.requirementId, 'requirementId'),
    baselineId: nonBlank(input.baselineId, 'baselineId'),
    stage: input.stage,
    mode: input.mode,
    status: 'IN_PROGRESS',
    result: null,
    validity: 'CURRENT',
    ownerId: nonBlank(input.ownerId, 'ownerId'),
    confirmedRole: input.confirmedRole ?? null,
    confirmedBy: input.confirmedBy?.trim() || null,
    confirmedAt: input.mode === 'MANUAL' ? input.now : null,
    startedAt: input.now,
    completedAt: null,
    failureReason: null,
    unknownReason: null,
    registrationNote: input.registrationNote?.trim() || null,
  };
}

export function assertGateCheckConsistency(
  result: GateRunResult,
  checks: readonly GateCheck[],
): void {
  if (checks.length === 0) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'A completed GateRun requires at least one GateCheck.',
    );
  }
  const keys = new Set<string>();
  for (const check of checks) {
    const key = nonBlank(check.checkKey, 'checkKey');
    if (keys.has(key)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'GateCheck keys must be unique within a GateRun.',
      );
    }
    keys.add(key);
    if (
      (check.result === 'NOT_APPLICABLE' || check.result === 'UNKNOWN') &&
      !check.reason?.trim()
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        `${check.result} GateCheck requires a reason.`,
      );
    }
  }

  const has = (value: GateCheck['result']) =>
    checks.some((check) => check.result === value);
  const consistent =
    (result === 'PASS' &&
      has('PASS') &&
      !has('BLOCK') &&
      !has('WARN') &&
      !has('UNKNOWN')) ||
    (result === 'BLOCK' && has('BLOCK')) ||
    (result === 'WARN' && has('WARN') && !has('BLOCK')) ||
    (result === 'UNKNOWN' && has('UNKNOWN'));
  if (!consistent) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'GateRun result is inconsistent with its GateChecks.',
    );
  }
}

const stageIndex = new Map<LifecycleStage, number>([
  ['G0', 0],
  ['G1', 1],
  ['G2', 2],
  ['G3', 3],
  ['G4', 4],
  ['G5', 5],
  ['G6', 6],
  ['G7', 7],
  ['G8', 8],
  ['G9', 9],
  ['G10', 10],
  ['G11', 11],
  ['G12', 12],
]);

export function nextLifecycleStage(
  stage: LifecycleStage,
): LifecycleStage | null {
  const currentIndex = stageIndex.get(stage);
  if (currentIndex === undefined || currentIndex === 12) return null;
  return `G${currentIndex + 1}` as LifecycleStage;
}

export function applyGateResult(input: {
  requirement: Requirement;
  gateRun: GateRun;
  result: GateRunResult;
  completedAt: string;
  existingAdvancement: StageAdvancement | null;
  failureReason?: string;
  unknownReason?: string;
}): Readonly<{
  requirement: Requirement;
  gateRun: GateRun;
  advancement: StageAdvancement | null;
}> {
  if (!GATE_RUN_RESULTS.includes(input.result)) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'NOT_APPLICABLE is only valid for an individual GateCheck.',
    );
  }
  if (input.gateRun.requirementId !== input.requirement.id) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'GateRun does not belong to the Requirement.',
    );
  }

  if (input.existingAdvancement) {
    const expectedToStage = nextLifecycleStage(input.gateRun.stage);
    if (
      input.existingAdvancement.gateRunId !== input.gateRun.id ||
      input.existingAdvancement.requirementId !== input.requirement.id ||
      input.existingAdvancement.baselineId !== input.gateRun.baselineId ||
      input.existingAdvancement.fromStage !== input.gateRun.stage ||
      input.existingAdvancement.toStage !== expectedToStage ||
      input.existingAdvancement.advancedAt !== input.gateRun.completedAt ||
      input.requirement.currentBaselineId !== input.gateRun.baselineId ||
      input.requirement.currentStage !== expectedToStage ||
      input.gateRun.status !== 'COMPLETED' ||
      input.gateRun.validity !== 'CURRENT' ||
      input.gateRun.result !== 'PASS' ||
      input.gateRun.result !== input.result
    ) {
      throw new DomainRuleViolation(
        'INVALID_STATE_TRANSITION',
        'Existing advancement does not match the completed GateRun.',
      );
    }
    return {
      requirement: input.requirement,
      gateRun: input.gateRun,
      advancement: input.existingAdvancement,
    };
  }

  const baselineIsCurrent =
    input.requirement.currentBaselineId === input.gateRun.baselineId;
  const stageIsCurrent = input.requirement.currentStage === input.gateRun.stage;
  let completedGateRun: GateRun;

  if (input.gateRun.status === 'COMPLETED') {
    if (input.gateRun.result !== input.result) {
      throw new DomainRuleViolation(
        'INVALID_STATE_TRANSITION',
        'A completed GateRun cannot be overwritten.',
      );
    }
    completedGateRun = input.gateRun;
  } else {
    if (
      input.result === 'UNKNOWN' &&
      (!input.unknownReason || !input.unknownReason.trim())
    ) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'An UNKNOWN GateRun requires a recovery reason.',
      );
    }
    completedGateRun = {
      ...input.gateRun,
      status: 'COMPLETED',
      result: input.result,
      validity: !baselineIsCurrent
        ? 'STALE_BASELINE'
        : stageIsCurrent
          ? 'CURRENT'
          : 'INVALIDATED',
      completedAt: input.completedAt,
      failureReason: input.failureReason?.trim() || null,
      unknownReason:
        input.result === 'UNKNOWN' ? input.unknownReason!.trim() : null,
    };
  }

  if (
    input.result !== 'PASS' ||
    completedGateRun.validity !== 'CURRENT' ||
    !baselineIsCurrent ||
    !stageIsCurrent
  ) {
    return {
      requirement: input.requirement,
      gateRun: completedGateRun,
      advancement: null,
    };
  }

  const toStage = nextLifecycleStage(input.gateRun.stage);
  if (toStage === null) {
    return {
      requirement: input.requirement,
      gateRun: completedGateRun,
      advancement: null,
    };
  }

  const advancement: StageAdvancement = {
    id: `${input.gateRun.id}:advancement`,
    gateRunId: input.gateRun.id,
    requirementId: input.requirement.id,
    baselineId: input.gateRun.baselineId,
    fromStage: input.gateRun.stage,
    toStage,
    advancedAt: input.completedAt,
  };

  return {
    requirement: {
      ...input.requirement,
      currentStage: toStage,
      rowVersion: input.requirement.rowVersion + 1,
      updatedAt: input.completedAt,
    },
    gateRun: completedGateRun,
    advancement,
  };
}
