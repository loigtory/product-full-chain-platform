import { describe, expect, it } from 'vitest';

import {
  appendArtifactVersion,
  assertAllowedRelativePath,
  createArtifactCatalogEntry,
  normalizeLoginName,
} from '../../packages/domain/src/index.ts';

describe('M1 collaboration domain', () => {
  it('normalizes application login names without accepting display text', () => {
    expect(normalizeLoginName(' Product.Owner ')).toBe('product.owner');
    expect(() => normalizeLoginName('产品负责人')).toThrowError(
      'INVALID_LOGIN_NAME',
    );
  });

  it.each(['C:\\work\\repo', '/srv/repo', '../secrets', 'docs/../../secrets'])(
    'rejects unsafe requirement workspace path %s',
    (path) => {
      expect(() => assertAllowedRelativePath(path)).toThrowError(
        'INVALID_WORKSPACE_RELATIVE_PATH',
      );
    },
  );

  it('normalizes a safe relative path', () => {
    expect(assertAllowedRelativePath(' docs\\requirements/current ')).toBe(
      'docs/requirements/current',
    );
  });

  it('appends immutable artifact versions and switches the current version', () => {
    const artifact = createArtifactCatalogEntry({
      id: 'artifact-1',
      requirementId: 'requirement-1',
      capId: 'CAP-PFC-02',
      stage: 'G1',
      artifactType: 'PRD',
      title: '需求规格',
      status: 'ACTIVE',
      version: {
        id: 'version-1',
        versionLabel: 'V0.1',
        sourceType: 'WORKSPACE_RELATIVE',
        sourceRef: 'docs/requirements/spec.md',
        contentHash: 'sha256:11111111111111111111111111111111',
        sensitivity: 'INTERNAL',
        createdBy: 'account-1',
        createdAt: '2026-09-06T00:00:00.000Z',
      },
      createdAt: '2026-09-06T00:00:00.000Z',
    });

    const updated = appendArtifactVersion(artifact, {
      id: 'version-2',
      versionLabel: 'V0.2',
      sourceType: 'CONTROLLED_REFERENCE',
      sourceRef: 'ref:prd-002',
      contentHash: 'sha256:22222222222222222222222222222222',
      sensitivity: 'INTERNAL',
      createdBy: 'account-1',
      createdAt: '2026-09-06T01:00:00.000Z',
    });

    expect(updated.currentVersionId).toBe('version-2');
    expect(updated.rowVersion).toBe(1);
    expect(updated.versions).toHaveLength(2);
    expect(artifact.versions).toHaveLength(1);
    expect(() =>
      appendArtifactVersion(updated, updated.versions[0]!),
    ).toThrowError('ARTIFACT_VERSION_ALREADY_EXISTS');
  });
});
