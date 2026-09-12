import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { FileArtifactInspector } from '../../apps/bridge/src/file-artifact-inspector.ts';

describe('M2 file artifact inspector', () => {
  it('hashes an artifact only after its canonical path remains inside the canonical scope', async () => {
    const content = Buffer.from('CODEx_TEST_M2_ARTIFACT');
    const readFile = vi.fn(async () => content);
    const inspector = new FileArtifactInspector({
      realpath: vi.fn(async (value: string) => value),
      readFile,
    });

    await expect(
      inspector.inspectWithinScope({
        workspacePath: 'C:\\CODEx_TEST_M2\\repo',
        scopePath: 'C:\\CODEx_TEST_M2\\repo\\standards',
        artifactPath: 'C:\\CODEx_TEST_M2\\repo\\standards\\requirement.md',
      }),
    ).resolves.toEqual({
      status: 'VERIFIED',
      contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    });
    expect(readFile).toHaveBeenCalledWith(
      'C:\\CODEx_TEST_M2\\repo\\standards\\requirement.md',
    );
  });

  it('rejects a lexical in-scope path whose canonical target escapes through a link', async () => {
    const readFile = vi.fn(async () => Buffer.from('secret'));
    const inspector = new FileArtifactInspector({
      realpath: vi.fn(async (value: string) =>
        value.endsWith('requirement.md')
          ? 'C:\\CODEx_TEST_M2\\outside\\secret.md'
          : value,
      ),
      readFile,
    });

    await expect(
      inspector.inspectWithinScope({
        workspacePath: 'C:\\CODEx_TEST_M2\\repo',
        scopePath: 'C:\\CODEx_TEST_M2\\repo\\standards',
        artifactPath:
          'C:\\CODEx_TEST_M2\\repo\\standards\\link\\requirement.md',
      }),
    ).resolves.toEqual({ status: 'OUTSIDE_SCOPE' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('returns a bounded unreadable result when canonicalization fails', async () => {
    const inspector = new FileArtifactInspector({
      realpath: vi.fn(async () => {
        throw new Error('CODEx_TEST_M2_LOCAL_PATH_SHOULD_NOT_ESCAPE');
      }),
      readFile: vi.fn(async () => Buffer.from('unused')),
    });

    await expect(
      inspector.inspectWithinScope({
        workspacePath: 'C:\\CODEx_TEST_M2\\repo',
        scopePath: 'C:\\CODEx_TEST_M2\\repo\\standards',
        artifactPath: 'C:\\CODEx_TEST_M2\\repo\\standards\\requirement.md',
      }),
    ).resolves.toEqual({ status: 'UNREADABLE' });
  });

  it('rejects an authorized scope whose canonical target escapes the registered workspace', async () => {
    const readFile = vi.fn(async () => Buffer.from('secret'));
    const inspector = new FileArtifactInspector({
      realpath: vi.fn(async (value: string) => {
        if (value.endsWith('repo')) return value;
        return value.endsWith('standards')
          ? 'C:\\CODEx_TEST_M2\\outside'
          : 'C:\\CODEx_TEST_M2\\outside\\requirement.md';
      }),
      readFile,
    });

    await expect(
      inspector.inspectWithinScope({
        workspacePath: 'C:\\CODEx_TEST_M2\\repo',
        scopePath: 'C:\\CODEx_TEST_M2\\repo\\standards',
        artifactPath: 'C:\\CODEx_TEST_M2\\repo\\standards\\requirement.md',
      }),
    ).resolves.toEqual({ status: 'OUTSIDE_SCOPE' });
    expect(readFile).not.toHaveBeenCalled();
  });
});
