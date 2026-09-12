import { describe, expect, it } from 'vitest';

import { createArtifactTextDiff } from '../../apps/server/src/artifact-collaboration/artifact-diff.ts';

describe('M2 R3 artifact text diff', () => {
  it('normalizes CRLF for comparison without changing the source hashes', () => {
    const result = createArtifactTextDiff({
      artifactId: 'CODEx_TEST_M2R3_ARTIFACT_001',
      from: {
        versionId: 'CODEx_TEST_M2R3_VERSION_001',
        contentHash: `sha256:${'1'.repeat(64)}`,
        content: '第一行\r\n第二行\r\n',
      },
      to: {
        versionId: 'CODEx_TEST_M2R3_VERSION_002',
        contentHash: `sha256:${'2'.repeat(64)}`,
        content: '第一行\n第二行\n第三行\n',
      },
      ignoreWhitespace: false,
    });

    expect(result.fromContentHash).toBe(`sha256:${'1'.repeat(64)}`);
    expect(result.toContentHash).toBe(`sha256:${'2'.repeat(64)}`);
    expect(result.changes).toEqual([
      expect.objectContaining({
        kind: 'UNCHANGED',
        lines: ['第一行\n', '第二行\n'],
      }),
      expect.objectContaining({ kind: 'ADDED', lines: ['第三行\n'] }),
    ]);
  });

  it('returns bounded output and marks truncation', () => {
    const result = createArtifactTextDiff(
      {
        artifactId: 'CODEx_TEST_M2R3_ARTIFACT_001',
        from: {
          versionId: 'CODEx_TEST_M2R3_VERSION_001',
          contentHash: `sha256:${'1'.repeat(64)}`,
          content: 'a\nb\nc\n',
        },
        to: {
          versionId: 'CODEx_TEST_M2R3_VERSION_002',
          contentHash: `sha256:${'2'.repeat(64)}`,
          content: 'x\ny\nz\n',
        },
        ignoreWhitespace: false,
      },
      { maxChangedLines: 2, timeoutMs: 100 },
    );

    expect(result.truncated).toBe(true);
    expect(result.returnedChangedLineCount).toBe(2);
    expect(result.totalChangedLineCount).toBe(6);
  });

  it('caps independent change hunks as well as changed lines', () => {
    const from = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0 ? `before-${index}` : `same-${index}`,
    ).join('\n');
    const to = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0 ? `after-${index}` : `same-${index}`,
    ).join('\n');

    const result = createArtifactTextDiff(
      {
        artifactId: 'CODEx_TEST_M2R3_ARTIFACT_001',
        from: {
          versionId: 'CODEx_TEST_M2R3_VERSION_001',
          contentHash: `sha256:${'1'.repeat(64)}`,
          content: from,
        },
        to: {
          versionId: 'CODEx_TEST_M2R3_VERSION_002',
          contentHash: `sha256:${'2'.repeat(64)}`,
          content: to,
        },
        ignoreWhitespace: false,
      },
      { maxChangedLines: 2_000, maxHunks: 2, timeoutMs: 100 },
    );

    expect(result.totalHunkCount).toBeGreaterThan(2);
    expect(result.returnedHunkCount).toBe(2);
    expect(result.truncated).toBe(true);
  });
});
