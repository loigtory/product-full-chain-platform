import type {
  AppendArtifactVersionRequest,
  ArtifactDiffDto,
  ArtifactDto,
  ArtifactReviewDto,
  ArtifactVersionContentDto,
  CreateArtifactReviewRequest,
  TraceLinkDto,
  TraceSubjectDto,
} from '@pfc/contracts';

import { createUiIdempotencyKey } from '../idempotency.ts';
import { platformRequest } from '../platform/api-client.ts';

export type ArtifactTraceGraphDto = Readonly<{
  subject: TraceSubjectDto;
  subjects: readonly TraceSubjectDto[];
  links: readonly TraceLinkDto[];
}>;

export const artifactCollaborationApi = {
  getArtifact: (artifactId: string) =>
    platformRequest<ArtifactDto>(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
    ),
  getContent: (artifactId: string, versionId: string) =>
    platformRequest<ArtifactVersionContentDto>(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}/content`,
    ),
  getDiff: (artifactId: string, fromVersionId: string, toVersionId: string) =>
    platformRequest<ArtifactDiffDto>(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/diff?fromVersionId=${encodeURIComponent(fromVersionId)}&toVersionId=${encodeURIComponent(toVersionId)}`,
    ),
  listReviews: (versionId: string) =>
    platformRequest<readonly ArtifactReviewDto[]>(
      `/api/v1/artifact-versions/${encodeURIComponent(versionId)}/reviews`,
    ),
  review: (
    versionId: string,
    artifactRowVersion: number,
    input: CreateArtifactReviewRequest,
  ) =>
    platformRequest<{ replayed: boolean; review: ArtifactReviewDto }>(
      `/api/v1/artifact-versions/${encodeURIComponent(versionId)}/reviews`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createUiIdempotencyKey('REVIEW_ARTIFACT_VERSION'),
          'If-Match': `"${artifactRowVersion}"`,
        },
        body: JSON.stringify(input),
      },
    ),
  appendVersion: (
    artifactId: string,
    artifactRowVersion: number,
    input: AppendArtifactVersionRequest,
  ) =>
    platformRequest<{ replayed: boolean; artifact: ArtifactDto }>(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/versions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createUiIdempotencyKey('APPEND_ARTIFACT_CONTENT'),
          'If-Match': `"${artifactRowVersion}"`,
        },
        body: JSON.stringify(input),
      },
    ),
  getTraceGraphForVersion: (requirementId: string, versionId: string) =>
    platformRequest<ArtifactTraceGraphDto | null>(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/traces?subjectType=ARTIFACT_VERSION&nativeId=${encodeURIComponent(versionId)}&direction=BOTH`,
    ),
};
