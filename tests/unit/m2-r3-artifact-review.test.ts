import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createArtifactReview,
  createArtifactVersionContent,
} from '../../packages/domain/src/artifact-review.ts';

function sha256(content: string) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

describe('M2 R3 artifact review rules', () => {
  it('creates a bounded immutable text snapshot bound to its exact hash', () => {
    const content = '# 需求规格\n\n首个版本。\n';
    expect(
      createArtifactVersionContent({
        artifactVersionId: 'CODEx_TEST_M2R3_VERSION_001',
        mediaType: 'text/markdown',
        content,
        contentHash: sha256(content),
        createdAt: '2026-09-09T01:00:00.000Z',
      }),
    ).toMatchObject({
      availability: 'AVAILABLE',
      byteSize: Buffer.byteLength(content),
      lineCount: 4,
    });
  });

  it('rejects a content snapshot whose hash does not match its body', () => {
    expect(() =>
      createArtifactVersionContent({
        artifactVersionId: 'CODEx_TEST_M2R3_VERSION_001',
        mediaType: 'text/plain',
        content: '真实正文',
        contentHash: `sha256:${'0'.repeat(64)}`,
        createdAt: '2026-09-09T01:00:00.000Z',
      }),
    ).toThrowError('ARTIFACT_CONTENT_HASH_MISMATCH');
  });

  it('requires a reason for non-approved review conclusions', () => {
    expect(() =>
      createArtifactReview({
        id: 'CODEx_TEST_M2R3_REVIEW_001',
        artifactId: 'CODEx_TEST_M2R3_ARTIFACT_001',
        artifactVersionId: 'CODEx_TEST_M2R3_VERSION_001',
        artifactContentHash: `sha256:${'1'.repeat(64)}`,
        conclusion: 'CHANGES_REQUESTED',
        responsibility: 'PRODUCT',
        comment: ' ',
        reviewedBy: 'CODEx_TEST_M2R3_ACCOUNT_001',
        supersedesReviewId: null,
        createdAt: '2026-09-09T01:00:00.000Z',
      }),
    ).toThrowError('ARTIFACT_REVIEW_COMMENT_REQUIRED');
  });
});
