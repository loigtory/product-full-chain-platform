import {
  mkdtemp,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RunCapsuleManager } from '../../apps/bridge/src/run-capsule.ts';

const roots: string[] = [];

async function testRoot(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'CODEx_TEST_M2_R2_CAPSULE_'),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('M2 isolated run capsule', () => {
  it('materializes only allowed relative paths and verifies a bounded diff', async () => {
    const root = await testRoot();
    const source = path.join(root, 'source');
    const capsules = path.join(root, 'capsules');
    await mkdir(path.join(source, 'docs', 'requirements'), { recursive: true });
    await writeFile(
      path.join(source, 'docs', 'requirements', 'acceptance.md'),
      '# Acceptance\n\nPending.\n',
      'utf8',
    );
    await writeFile(path.join(source, 'secret.txt'), 'not copied', 'utf8');
    const manager = new RunCapsuleManager({ capsuleRoot: capsules });

    const capsule = await manager.materialize({
      runId: 'CODEx_TEST_M2_R2_RUN_001',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_001',
      sourceWorkspacePath: source,
      sourceGitBaseline: '0123456789abcdef0123456789abcdef01234567',
      scope: {
        allowedRelativePaths: ['docs/requirements/acceptance.md'],
        allowedActions: ['EDIT_FILES'],
        networkAccess: false,
        maxChangedFiles: 1,
        maxChangedBytes: 10_000,
        expiresAt: '2026-09-07T00:00:00.000Z',
      },
    });

    await expect(
      readFile(
        path.join(capsule.path, 'docs', 'requirements', 'acceptance.md'),
        'utf8',
      ),
    ).resolves.toContain('Pending');
    await expect(
      readFile(path.join(capsule.path, 'secret.txt')),
    ).rejects.toThrow();
    await writeFile(
      path.join(capsule.path, 'docs', 'requirements', 'acceptance.md'),
      '# Acceptance\n\nAccepted locally.\n',
      'utf8',
    );

    const verified = await manager.verify(capsule);

    expect(verified).toMatchObject({
      status: 'VERIFIED',
      changedFiles: 1,
      changedPaths: ['docs/requirements/acceptance.md'],
    });
    expect(verified.beforeManifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(verified.afterManifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(
      readFile(
        path.join(source, 'docs', 'requirements', 'acceptance.md'),
        'utf8',
      ),
    ).resolves.toContain('Pending');
  });

  it('rejects linked source content and path escape before copying', async () => {
    const root = await testRoot();
    const source = path.join(root, 'source');
    const outside = path.join(root, 'outside');
    const capsules = path.join(root, 'capsules');
    await mkdir(source, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.md'), 'secret', 'utf8');
    await symlink(outside, path.join(source, 'linked'), 'junction');
    const manager = new RunCapsuleManager({ capsuleRoot: capsules });
    const base = {
      runId: 'CODEx_TEST_M2_R2_RUN_002',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_002',
      sourceWorkspacePath: source,
      sourceGitBaseline: '0123456789abcdef0123456789abcdef01234567',
      scope: {
        allowedRelativePaths: ['linked/secret.md'],
        allowedActions: ['EDIT_FILES'] as const,
        networkAccess: false as const,
        maxChangedFiles: 1,
        maxChangedBytes: 1_000,
        expiresAt: '2026-09-07T00:00:00.000Z',
      },
    };

    await expect(manager.materialize(base)).rejects.toThrow(
      'CAPSULE_SOURCE_LINK_FORBIDDEN',
    );
    await expect(
      manager.materialize({
        ...base,
        executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_003',
        scope: {
          ...base.scope,
          allowedRelativePaths: ['../outside/secret.md'],
        },
      }),
    ).rejects.toThrow('CAPSULE_SCOPE_INVALID');
  });

  it('fails closed when the changed file or byte limit is exceeded and cleans exactly one capsule', async () => {
    const root = await testRoot();
    const source = path.join(root, 'source');
    const capsules = path.join(root, 'capsules');
    await mkdir(path.join(source, 'docs'), { recursive: true });
    await writeFile(path.join(source, 'docs', 'a.md'), 'a', 'utf8');
    await writeFile(path.join(source, 'docs', 'b.md'), 'b', 'utf8');
    const manager = new RunCapsuleManager({ capsuleRoot: capsules });
    const capsule = await manager.materialize({
      runId: 'CODEx_TEST_M2_R2_RUN_003',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_004',
      sourceWorkspacePath: source,
      sourceGitBaseline: '0123456789abcdef0123456789abcdef01234567',
      scope: {
        allowedRelativePaths: ['docs'],
        allowedActions: ['EDIT_FILES'],
        networkAccess: false,
        maxChangedFiles: 1,
        maxChangedBytes: 2,
        expiresAt: '2026-09-07T00:00:00.000Z',
      },
    });
    await writeFile(path.join(capsule.path, 'docs', 'a.md'), 'changed', 'utf8');
    await writeFile(path.join(capsule.path, 'docs', 'b.md'), 'changed', 'utf8');

    await expect(manager.verify(capsule)).rejects.toThrow(
      'CAPSULE_CHANGE_LIMIT_EXCEEDED',
    );
    await manager.cleanup(capsule);
    await expect(
      readFile(path.join(capsule.path, 'docs', 'a.md')),
    ).rejects.toThrow();
    await expect(lstat(path.dirname(capsule.path))).rejects.toThrow();
    await expect(
      readFile(path.join(source, 'docs', 'a.md'), 'utf8'),
    ).resolves.toBe('a');
  });
});
