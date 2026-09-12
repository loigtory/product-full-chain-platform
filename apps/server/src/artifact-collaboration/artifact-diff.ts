import { diffLines } from 'diff';

import type { ArtifactDiffChangeDto, ArtifactDiffDto } from '@pfc/contracts';

const DEFAULT_MAX_CHANGED_LINES = 2_000;
const DEFAULT_MAX_HUNKS = 200;
const DEFAULT_TIMEOUT_MS = 2_000;

function lines(value: string): readonly string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function createArtifactTextDiff(
  input: {
    artifactId: string;
    from: Readonly<{
      versionId: string;
      contentHash: string;
      content: string;
    }>;
    to: Readonly<{
      versionId: string;
      contentHash: string;
      content: string;
    }>;
    ignoreWhitespace: boolean;
  },
  options: Readonly<{
    maxChangedLines?: number;
    maxHunks?: number;
    timeoutMs?: number;
  }> = {},
): ArtifactDiffDto {
  const maxChangedLines = options.maxChangedLines ?? DEFAULT_MAX_CHANGED_LINES;
  const maxHunks = options.maxHunks ?? DEFAULT_MAX_HUNKS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (maxChangedLines < 1 || maxHunks < 1 || timeoutMs < 1) {
    throw new Error('ARTIFACT_DIFF_LIMIT_INVALID');
  }
  const rawChanges = diffLines(input.from.content, input.to.content, {
    ignoreWhitespace: input.ignoreWhitespace,
    stripTrailingCr: true,
    timeout: timeoutMs,
  });
  if (!rawChanges) throw new Error('ARTIFACT_DIFF_TIMEOUT');

  let totalChangedLineCount = 0;
  let totalHunkCount = 0;
  let insideHunk = false;
  for (const change of rawChanges) {
    if (change.added || change.removed) {
      totalChangedLineCount += lines(change.value).length;
      if (!insideHunk) totalHunkCount += 1;
      insideHunk = true;
    } else {
      insideHunk = false;
    }
  }

  let remainingChangedLines = maxChangedLines;
  let returnedHunkCount = 0;
  insideHunk = false;
  const changes: ArtifactDiffChangeDto[] = [];
  for (const change of rawChanges) {
    const changeLines = lines(change.value);
    if (!change.added && !change.removed) {
      insideHunk = false;
      changes.push({ kind: 'UNCHANGED', lines: changeLines });
      continue;
    }
    if (!insideHunk) {
      if (returnedHunkCount === maxHunks || remainingChangedLines === 0) break;
      returnedHunkCount += 1;
    }
    insideHunk = true;
    const returnedLines = changeLines.slice(0, remainingChangedLines);
    remainingChangedLines -= returnedLines.length;
    changes.push({
      kind: change.added ? 'ADDED' : 'REMOVED',
      lines: returnedLines,
    });
  }
  const returnedChangedLineCount = Math.min(
    totalChangedLineCount,
    maxChangedLines,
  );
  return {
    schemaVersion: 'artifact-diff/1',
    artifactId: input.artifactId,
    fromVersionId: input.from.versionId,
    fromContentHash: input.from.contentHash,
    toVersionId: input.to.versionId,
    toContentHash: input.to.contentHash,
    ignoreWhitespace: input.ignoreWhitespace,
    changes,
    totalChangedLineCount,
    returnedChangedLineCount,
    totalHunkCount,
    returnedHunkCount,
    truncated:
      returnedChangedLineCount < totalChangedLineCount ||
      returnedHunkCount < totalHunkCount,
  };
}
