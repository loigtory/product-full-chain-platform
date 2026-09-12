import type { SensitivityLevel } from './lifecycle.ts';

export const ARTIFACT_CONTENT_MEDIA_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
] as const;
export const ARTIFACT_CONTENT_AVAILABILITIES = [
  'AVAILABLE',
  'NOT_ARCHIVED',
  'CONTENT_TOO_LARGE',
] as const;
export const ARTIFACT_REVIEW_CONCLUSIONS = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
] as const;
export const ARTIFACT_REVIEW_RESPONSIBILITIES = [
  'PRODUCT',
  'DEVELOPMENT',
  'CODE_REVIEW',
  'TEST',
  'SECURITY',
] as const;
export const TRACE_SUBJECT_TYPES = [
  'REQUIREMENT',
  'CAPABILITY',
  'UNIT',
  'ACCEPTANCE_CRITERION',
  'ARTIFACT_VERSION',
  'AGENT_RUN',
  'EVIDENCE',
] as const;
export const TRACE_RELATION_TYPES = [
  'DECOMPOSES_TO',
  'SATISFIES',
  'PRODUCED_BY',
  'IMPLEMENTS',
  'EVIDENCED_BY',
  'VERIFIED_BY',
] as const;
export const TRACE_VALIDITIES = ['VALID', 'INVALIDATED'] as const;

export type ArtifactContentMediaType =
  (typeof ARTIFACT_CONTENT_MEDIA_TYPES)[number];
export type ArtifactContentAvailability =
  (typeof ARTIFACT_CONTENT_AVAILABILITIES)[number];
export type ArtifactReviewConclusion =
  (typeof ARTIFACT_REVIEW_CONCLUSIONS)[number];
export type ArtifactReviewResponsibility =
  (typeof ARTIFACT_REVIEW_RESPONSIBILITIES)[number];
export type TraceSubjectType = (typeof TRACE_SUBJECT_TYPES)[number];
export type TraceRelationType = (typeof TRACE_RELATION_TYPES)[number];
export type TraceValidity = (typeof TRACE_VALIDITIES)[number];

export type ArtifactVersionContentDto = Readonly<{
  schemaVersion: 'artifact-version-content/1';
  artifactVersionId: string;
  mediaType: ArtifactContentMediaType;
  availability: ArtifactContentAvailability;
  content: string | null;
  contentHash: string;
  byteSize: number;
  lineCount: number;
  createdAt: string;
}>;

export type ArtifactReviewDto = Readonly<{
  schemaVersion: 'artifact-review/1';
  id: string;
  artifactId: string;
  artifactVersionId: string;
  artifactContentHash: string;
  conclusion: ArtifactReviewConclusion;
  responsibility: ArtifactReviewResponsibility;
  comment: string | null;
  reviewedBy: string;
  supersedesReviewId: string | null;
  createdAt: string;
}>;

export type ArtifactDiffChangeDto = Readonly<{
  kind: 'UNCHANGED' | 'ADDED' | 'REMOVED';
  lines: readonly string[];
}>;

export type ArtifactDiffDto = Readonly<{
  schemaVersion: 'artifact-diff/1';
  artifactId: string;
  fromVersionId: string;
  fromContentHash: string;
  toVersionId: string;
  toContentHash: string;
  ignoreWhitespace: boolean;
  changes: readonly ArtifactDiffChangeDto[];
  totalChangedLineCount: number;
  returnedChangedLineCount: number;
  totalHunkCount: number;
  returnedHunkCount: number;
  truncated: boolean;
}>;

export type TraceSubjectDto = Readonly<{
  schemaVersion: 'trace-subject/1';
  id: string;
  requirementId: string;
  subjectType: TraceSubjectType;
  nativeId: string;
  nativeVersion: string;
  contentHash: string;
  authorityArtifactVersionId: string | null;
  locator: string;
  validity: TraceValidity;
  createdAt: string;
}>;

export type TraceLinkDto = Readonly<{
  schemaVersion: 'trace-link/1';
  id: string;
  requirementId: string;
  sourceSubjectId: string;
  targetSubjectId: string;
  relationType: TraceRelationType;
  validity: TraceValidity;
  createdBy: string;
  createdAt: string;
  invalidatedAt: string | null;
  invalidationReason: string | null;
}>;

export type CreateArtifactReviewRequest = Readonly<{
  conclusion: ArtifactReviewConclusion;
  responsibility: ArtifactReviewResponsibility;
  comment?: string;
  supersedesReviewId?: string;
}>;

export type CreateArtifactVersionContentRequest = Readonly<{
  versionLabel: string;
  sourceType: 'WORKSPACE_RELATIVE' | 'CONTROLLED_REFERENCE';
  sourceRef: string;
  sensitivity: SensitivityLevel;
  mediaType: ArtifactContentMediaType;
  content: string;
}>;

export type CreateTraceSubjectRequest = Readonly<{
  subjectType: TraceSubjectType;
  nativeId: string;
  nativeVersion: string;
  contentHash: string;
  authorityArtifactVersionId?: string;
  locator: string;
}>;

export type CreateTraceLinkRequest = Readonly<{
  sourceSubjectId: string;
  targetSubjectId: string;
  relationType: TraceRelationType;
}>;
