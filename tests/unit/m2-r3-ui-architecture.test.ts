import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('M2 R3 artifact workspace architecture', () => {
  it('keeps routed page, feature panels, and API ownership in separate modules', async () => {
    const featureRoot = path.join(
      root,
      'apps',
      'web',
      'src',
      'artifact-workspace',
    );
    const files = [
      'ArtifactWorkspacePage.tsx',
      'ArtifactContentPanel.tsx',
      'ArtifactReviewPanel.tsx',
      'ArtifactTracePanel.tsx',
      'api.ts',
    ];
    await Promise.all(
      files.map((file) => access(path.join(featureRoot, file))),
    );

    const page = await readFile(path.join(featureRoot, files[0]!), 'utf8');
    expect(page).toContain("from '@pfc/ui'");
    expect(page).toContain("from './ArtifactContentPanel.tsx'");
    expect(page).toContain("from './ArtifactReviewPanel.tsx'");
    expect(page).toContain("from './ArtifactTracePanel.tsx'");
  });

  it('keeps feature CSS free of page-local visual tokens', async () => {
    const css = await readFile(
      path.join(
        root,
        'apps',
        'web',
        'src',
        'artifact-workspace',
        'artifact-workspace.css',
      ),
      'utf8',
    );
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
    const fontFamilies = Array.from(css.matchAll(/font-family:\s*([^;]+);/g));
    expect(
      fontFamilies
        .map((match) => match[1])
        .filter((value) => !value?.startsWith('var(')),
    ).toEqual([]);
    const governedValues = Array.from(
      css.matchAll(
        /(?:font-size|line-height|border-radius|box-shadow):\s*([^;]+);/g,
      ),
    );
    expect(
      governedValues
        .map((match) => match[1])
        .filter((value) => !value?.startsWith('var(')),
    ).toEqual([]);
    expect(css).not.toMatch(
      /^\s*(transition|animation):.*\b\d+(?:\.\d+)?m?s\b/im,
    );
  });
});
