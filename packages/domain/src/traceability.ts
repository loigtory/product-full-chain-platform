import {
  TRACE_RELATION_TYPES,
  TRACE_SUBJECT_TYPES,
  type TraceLinkDto,
  type TraceSubjectDto,
} from '@pfc/contracts';

const AUTHORITY_REQUIRED = new Set<TraceSubjectDto['subjectType']>([
  'CAPABILITY',
  'UNIT',
  'ACCEPTANCE_CRITERION',
]);

function nonBlank(value: string, code: string, max = 240): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(code);
  return normalized;
}

function contentHash(value: string): string {
  if (!/^sha256:[a-f\d]{64}$/i.test(value)) {
    throw new Error('TRACE_CONTENT_HASH_INVALID');
  }
  return value.toLowerCase();
}

function timestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('TRACE_TIMESTAMP_INVALID');
  }
  return value;
}

export function createTraceSubject(
  input: Omit<TraceSubjectDto, 'schemaVersion' | 'validity'>,
): TraceSubjectDto {
  if (!TRACE_SUBJECT_TYPES.includes(input.subjectType)) {
    throw new Error('TRACE_SUBJECT_TYPE_INVALID');
  }
  if (
    AUTHORITY_REQUIRED.has(input.subjectType) &&
    !input.authorityArtifactVersionId?.trim()
  ) {
    throw new Error('TRACE_AUTHORITY_VERSION_REQUIRED');
  }
  return {
    schemaVersion: 'trace-subject/1',
    id: nonBlank(input.id, 'TRACE_SUBJECT_ID_INVALID', 160),
    requirementId: nonBlank(
      input.requirementId,
      'TRACE_REQUIREMENT_ID_INVALID',
      160,
    ),
    subjectType: input.subjectType,
    nativeId: nonBlank(input.nativeId, 'TRACE_NATIVE_ID_INVALID', 200),
    nativeVersion: nonBlank(
      input.nativeVersion,
      'TRACE_NATIVE_VERSION_INVALID',
      120,
    ),
    contentHash: contentHash(input.contentHash),
    authorityArtifactVersionId: input.authorityArtifactVersionId
      ? nonBlank(
          input.authorityArtifactVersionId,
          'TRACE_AUTHORITY_VERSION_INVALID',
          160,
        )
      : null,
    locator: nonBlank(input.locator, 'TRACE_LOCATOR_INVALID', 500),
    validity: 'VALID',
    createdAt: timestamp(input.createdAt),
  };
}

export function createTraceLink(input: {
  id: string;
  requirementId: string;
  source: TraceSubjectDto;
  target: TraceSubjectDto;
  relationType: TraceLinkDto['relationType'];
  createdBy: string;
  createdAt: string;
}): TraceLinkDto {
  if (!TRACE_RELATION_TYPES.includes(input.relationType)) {
    throw new Error('TRACE_RELATION_TYPE_INVALID');
  }
  if (
    input.source.requirementId !== input.requirementId ||
    input.target.requirementId !== input.requirementId
  ) {
    throw new Error('TRACE_CROSS_REQUIREMENT_FORBIDDEN');
  }
  if (input.source.validity !== 'VALID' || input.target.validity !== 'VALID') {
    throw new Error('TRACE_SUBJECT_INVALIDATED');
  }
  if (input.source.id === input.target.id) {
    throw new Error('TRACE_SELF_LINK_FORBIDDEN');
  }
  return {
    schemaVersion: 'trace-link/1',
    id: nonBlank(input.id, 'TRACE_LINK_ID_INVALID', 160),
    requirementId: nonBlank(
      input.requirementId,
      'TRACE_REQUIREMENT_ID_INVALID',
      160,
    ),
    sourceSubjectId: input.source.id,
    targetSubjectId: input.target.id,
    relationType: input.relationType,
    validity: 'VALID',
    createdBy: nonBlank(input.createdBy, 'TRACE_CREATED_BY_INVALID', 160),
    createdAt: timestamp(input.createdAt),
    invalidatedAt: null,
    invalidationReason: null,
  };
}
