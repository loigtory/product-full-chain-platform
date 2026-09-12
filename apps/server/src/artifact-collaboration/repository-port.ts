import type {
  ArtifactReviewDto,
  ArtifactVersionContentDto,
  MutationEvidence,
  MutationPersistenceResult,
  TraceLinkDto,
  TraceSubjectDto,
  TraceSubjectType,
} from '@pfc/contracts';

export type ArtifactVersionContext = Readonly<{
  artifactId: string;
  requirementId: string;
  artifactRowVersion: number;
  currentVersionId: string;
  versionId: string;
  contentHash: string;
  sensitivity: 'INTERNAL' | 'RESTRICTED' | 'PUBLIC';
}>;

export interface ArtifactCollaborationRepositoryPort {
  findVersionContent(input: {
    artifactId: string;
    versionId: string;
  }): Promise<ArtifactVersionContentDto | null>;
  findVersionContext(versionId: string): Promise<ArtifactVersionContext | null>;
  createReview(input: {
    review: ArtifactReviewDto;
    evidence: MutationEvidence;
    expectedArtifactRowVersion?: number;
  }): Promise<MutationPersistenceResult<ArtifactReviewDto>>;
  listReviews(versionId: string): Promise<readonly ArtifactReviewDto[]>;
  createTraceLink(input: {
    link: TraceLinkDto;
    evidence: MutationEvidence;
    expectedRequirementRowVersion?: number;
  }): Promise<MutationPersistenceResult<TraceLinkDto>>;
  invalidateTraceLink(input: {
    linkId: string;
    requirementId: string;
    reason: string;
    invalidatedAt: string;
    evidence: MutationEvidence;
    expectedRequirementRowVersion: number;
  }): Promise<MutationPersistenceResult<TraceLinkDto>>;
  findTraceSubject(subjectId: string): Promise<TraceSubjectDto | null>;
  findTraceSubjectByNative(input: {
    requirementId: string;
    subjectType: TraceSubjectType;
    nativeId: string;
  }): Promise<TraceSubjectDto | null>;
  findTraceLink(linkId: string): Promise<TraceLinkDto | null>;
  findRequirementRowVersion(requirementId: string): Promise<number | null>;
  listTraceGraph(input: {
    requirementId: string;
    subjectId: string;
    direction: 'INCOMING' | 'OUTGOING' | 'BOTH';
  }): Promise<{
    subjects: readonly TraceSubjectDto[];
    links: readonly TraceLinkDto[];
  }>;
}
