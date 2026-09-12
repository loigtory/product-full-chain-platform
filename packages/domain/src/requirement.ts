import type { MaterialSourceType } from '@pfc/contracts';

import { DomainRuleViolation } from './errors.ts';
import type {
  G0Registration,
  G0RegistrationField,
  MaterialBaseline,
  Requirement,
} from './types.ts';

export type G0RegistrationEvaluation = Readonly<{
  complete: boolean;
  missingFields: readonly G0RegistrationField[];
}>;

export type RequirementDraftInput = Readonly<{
  id: string;
  name: string;
  originalIdea: string;
  initiatorId: string;
  now: string;
  registration?: G0Registration;
  initialBaselineId?: string;
  confirmedBy?: string;
}>;

type G0Result = Readonly<{
  requirement: Requirement;
  materialBaseline: MaterialBaseline | null;
  missingFields: readonly G0RegistrationField[];
  gateProjection: 'BLOCK' | 'NOT_STARTED';
}>;

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireText(value: string, field: string): string {
  if (!hasText(value)) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      `${field} must not be blank.`,
      { field },
    );
  }
  return value;
}

function normalizeRegistration(registration: G0Registration): G0Registration {
  return {
    ...registration,
    sourceDescription:
      registration.sourceType === 'OTHER'
        ? registration.sourceDescription?.trim()
        : null,
  };
}

function mergeRegisteredValue<T>(
  field: G0RegistrationField,
  current: T | null | undefined,
  supplied: T | null | undefined,
): T | null | undefined {
  if (current !== null && current !== undefined) {
    if (supplied !== null && supplied !== undefined && supplied !== current) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Existing G0 registration values cannot be overwritten.',
        { field },
      );
    }
    return current;
  }
  return supplied;
}

function mergeRegisteredText(
  field: G0RegistrationField,
  current: string | null | undefined,
  supplied: string | null | undefined,
): string | null | undefined {
  const normalizedCurrent = current?.trim();
  const normalizedSupplied = supplied?.trim();
  if (normalizedCurrent) {
    if (normalizedSupplied && normalizedSupplied !== normalizedCurrent) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Existing G0 registration values cannot be overwritten.',
        { field },
      );
    }
    return normalizedCurrent;
  }
  return normalizedSupplied || null;
}

function mergeMissingRegistration(
  current: G0Registration,
  supplied: G0Registration,
): G0Registration {
  const sourceType = mergeRegisteredValue(
    'sourceType',
    current.sourceType,
    supplied.sourceType,
  );
  return normalizeRegistration({
    sourceType,
    sourceDescription: mergeRegisteredText(
      'sourceDescription',
      current.sourceDescription,
      supplied.sourceDescription,
    ),
    businessOwnerId: mergeRegisteredText(
      'businessOwnerId',
      current.businessOwnerId,
      supplied.businessOwnerId,
    ),
    materialPurpose: mergeRegisteredValue(
      'materialPurpose',
      current.materialPurpose,
      supplied.materialPurpose,
    ),
    sensitivity: mergeRegisteredValue(
      'sensitivity',
      current.sensitivity,
      supplied.sensitivity,
    ),
  });
}

export function evaluateG0Registration(
  registration: G0Registration,
): G0RegistrationEvaluation {
  const missingFields: G0RegistrationField[] = [];
  if (!registration.sourceType) missingFields.push('sourceType');
  if (
    registration.sourceType === 'OTHER' &&
    !hasText(registration.sourceDescription)
  ) {
    missingFields.push('sourceDescription');
  }
  if (!hasText(registration.businessOwnerId)) {
    missingFields.push('businessOwnerId');
  }
  if (!registration.materialPurpose) missingFields.push('materialPurpose');
  if (!registration.sensitivity) missingFields.push('sensitivity');

  return { complete: missingFields.length === 0, missingFields };
}

function createBaseline(input: {
  id: string;
  requirementId: string;
  registration: G0Registration;
  confirmedBy: string;
  now: string;
}): MaterialBaseline {
  const evaluation = evaluateG0Registration(input.registration);
  if (!evaluation.complete) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'G0 registration is incomplete.',
      { missingFields: evaluation.missingFields },
    );
  }

  const sourceType = input.registration.sourceType as MaterialSourceType;
  return {
    id: requireText(input.id, 'baselineId'),
    requirementId: input.requirementId,
    versionNumber: 1,
    status: 'CURRENT',
    sourceType,
    sourceDescription:
      sourceType === 'OTHER'
        ? input.registration.sourceDescription!.trim()
        : null,
    materialPurpose: input.registration.materialPurpose!,
    sensitivity: input.registration.sensitivity!,
    confirmedBy: requireText(input.confirmedBy, 'confirmedBy'),
    confirmedAt: input.now,
    createdAt: input.now,
  };
}

export function createRequirementDraft(input: RequirementDraftInput): G0Result {
  const registration = normalizeRegistration(input.registration ?? {});
  const evaluation = evaluateG0Registration(registration);
  const requirement: Requirement = {
    id: requireText(input.id, 'id'),
    name: requireText(input.name, 'name'),
    originalIdea: requireText(input.originalIdea, 'originalIdea'),
    initiatorId: requireText(input.initiatorId, 'initiatorId'),
    businessOwnerId: hasText(registration.businessOwnerId)
      ? registration.businessOwnerId
      : null,
    currentStage: 'G0',
    currentBaselineId: null,
    rowVersion: 0,
    draftRegistration: { ...registration },
    createdAt: input.now,
    updatedAt: input.now,
  };

  if (!evaluation.complete) {
    return {
      requirement,
      materialBaseline: null,
      missingFields: evaluation.missingFields,
      gateProjection: 'BLOCK',
    };
  }

  const materialBaseline = createBaseline({
    id: requireText(input.initialBaselineId ?? '', 'initialBaselineId'),
    requirementId: requirement.id,
    registration,
    confirmedBy: requireText(input.confirmedBy ?? '', 'confirmedBy'),
    now: input.now,
  });

  return {
    requirement: {
      ...requirement,
      currentBaselineId: materialBaseline.id,
      rowVersion: 1,
    },
    materialBaseline,
    missingFields: [],
    gateProjection: 'NOT_STARTED',
  };
}

export function completeG0Registration(input: {
  requirement: Requirement;
  baselineId: string;
  registration: G0Registration;
  confirmedBy: string;
  now: string;
  expectedRowVersion: number;
}): G0Result {
  if (input.requirement.rowVersion !== input.expectedRowVersion) {
    throw new DomainRuleViolation(
      'VERSION_CONFLICT',
      'Requirement row version does not match.',
      {
        expectedVersion: input.expectedRowVersion,
        currentVersion: input.requirement.rowVersion,
      },
    );
  }
  if (
    input.requirement.currentStage !== 'G0' ||
    input.requirement.currentBaselineId !== null
  ) {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      'G0 registration can only complete an incomplete G0 draft.',
    );
  }

  const registration = mergeMissingRegistration(
    input.requirement.draftRegistration ?? {},
    input.registration,
  );
  const materialBaseline = createBaseline({
    id: input.baselineId,
    requirementId: input.requirement.id,
    registration,
    confirmedBy: input.confirmedBy,
    now: input.now,
  });

  return {
    requirement: {
      ...input.requirement,
      businessOwnerId: registration.businessOwnerId!,
      currentBaselineId: materialBaseline.id,
      rowVersion: input.requirement.rowVersion + 1,
      draftRegistration: registration,
      updatedAt: input.now,
    },
    materialBaseline,
    missingFields: [],
    gateProjection: 'NOT_STARTED',
  };
}
