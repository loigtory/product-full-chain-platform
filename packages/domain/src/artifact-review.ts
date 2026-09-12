import { createHash } from 'node:crypto';

import {
  ARTIFACT_CONTENT_MEDIA_TYPES,
  ARTIFACT_REVIEW_CONCLUSIONS,
  ARTIFACT_REVIEW_RESPONSIBILITIES,
  type ArtifactReviewDto,
  type ArtifactVersionContentDto,
} from '@pfc/contracts';

const MAX_ARTIFACT_CONTENT_BYTES = 512 * 1024;
const MAX_ARTIFACT_CONTENT_LINES = 20_000;
const MAX_REVIEW_COMMENT_LENGTH = 8_000;

function nonBlank(value: string, code: string, max = 200): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(code);
  return normalized;
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function assertTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('ARTIFACT_REVIEW_TIMESTAMP_INVALID');
  }
  return value;
}

export function createArtifactVersionContent(input: {
  artifactVersionId: string;
  mediaType: ArtifactVersionContentDto['mediaType'];
  content: string;
  contentHash: string;
  createdAt: string;
}): ArtifactVersionContentDto {
  if (!ARTIFACT_CONTENT_MEDIA_TYPES.includes(input.mediaType)) {
    throw new Error('ARTIFACT_CONTENT_MEDIA_TYPE_INVALID');
  }
  const byteSize = Buffer.byteLength(input.content, 'utf8');
  if (byteSize > MAX_ARTIFACT_CONTENT_BYTES) {
    throw new Error('ARTIFACT_CONTENT_TOO_LARGE');
  }
  const lineCount = input.content.split('\n').length;
  if (lineCount > MAX_ARTIFACT_CONTENT_LINES) {
    throw new Error('ARTIFACT_CONTENT_TOO_MANY_LINES');
  }
  if (sha256(input.content) !== input.contentHash.toLowerCase()) {
    throw new Error('ARTIFACT_CONTENT_HASH_MISMATCH');
  }
  return {
    schemaVersion: 'artifact-version-content/1',
    artifactVersionId: nonBlank(
      input.artifactVersionId,
      'ARTIFACT_VERSION_ID_INVALID',
      160,
    ),
    mediaType: input.mediaType,
    availability: 'AVAILABLE',
    content: input.content,
    contentHash: input.contentHash.toLowerCase(),
    byteSize,
    lineCount,
    createdAt: assertTimestamp(input.createdAt),
  };
}

export function createArtifactReview(
  input: Omit<ArtifactReviewDto, 'schemaVersion'>,
): ArtifactReviewDto {
  if (!ARTIFACT_REVIEW_CONCLUSIONS.includes(input.conclusion)) {
    throw new Error('ARTIFACT_REVIEW_CONCLUSION_INVALID');
  }
  if (!ARTIFACT_REVIEW_RESPONSIBILITIES.includes(input.responsibility)) {
    throw new Error('ARTIFACT_REVIEW_RESPONSIBILITY_INVALID');
  }
  if (!/^sha256:[a-f\d]{64}$/i.test(input.artifactContentHash)) {
    throw new Error('ARTIFACT_CONTENT_HASH_INVALID');
  }
  const comment = input.comment?.trim() || null;
  if (input.conclusion !== 'APPROVED' && !comment) {
    throw new Error('ARTIFACT_REVIEW_COMMENT_REQUIRED');
  }
  if (comment && comment.length > MAX_REVIEW_COMMENT_LENGTH) {
    throw new Error('ARTIFACT_REVIEW_COMMENT_TOO_LONG');
  }
  return {
    schemaVersion: 'artifact-review/1',
    id: nonBlank(input.id, 'ARTIFACT_REVIEW_ID_INVALID', 160),
    artifactId: nonBlank(input.artifactId, 'ARTIFACT_ID_INVALID', 160),
    artifactVersionId: nonBlank(
      input.artifactVersionId,
      'ARTIFACT_VERSION_ID_INVALID',
      160,
    ),
    artifactContentHash: input.artifactContentHash.toLowerCase(),
    conclusion: input.conclusion,
    responsibility: input.responsibility,
    comment,
    reviewedBy: nonBlank(input.reviewedBy, 'ARTIFACT_REVIEWER_ID_INVALID', 160),
    supersedesReviewId: input.supersedesReviewId
      ? nonBlank(
          input.supersedesReviewId,
          'ARTIFACT_REVIEW_SUPERSEDES_ID_INVALID',
          160,
        )
      : null,
    createdAt: assertTimestamp(input.createdAt),
  };
}
