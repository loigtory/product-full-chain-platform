import type {
  ArtifactSourceType,
  ArtifactStatus,
  LifecycleStage,
  SensitivityLevel,
} from '@pfc/contracts';

import { assertAllowedRelativePath } from './workspace.ts';

export type ArtifactVersion = Readonly<{
  id: string;
  versionLabel: string;
  sourceType: ArtifactSourceType;
  sourceRef: string;
  contentHash: string;
  sensitivity: SensitivityLevel;
  createdBy: string;
  createdAt: string;
}>;

export type ArtifactCatalogEntry = Readonly<{
  id: string;
  requirementId: string;
  capId: string;
  stage: LifecycleStage;
  artifactType: string;
  title: string;
  status: ArtifactStatus;
  currentVersionId: string;
  rowVersion: number;
  versions: readonly ArtifactVersion[];
  createdAt: string;
  updatedAt: string;
}>;

function nonBlank(value: string, code: string): string {
  const result = value.trim();
  if (!result) throw new Error(code);
  return result;
}

function validateVersion(version: ArtifactVersion): ArtifactVersion {
  const sourceRef =
    version.sourceType === 'WORKSPACE_RELATIVE'
      ? assertAllowedRelativePath(version.sourceRef)
      : nonBlank(version.sourceRef, 'INVALID_ARTIFACT_SOURCE_REF');
  if (!/^sha256:[a-f0-9]{32,64}$/i.test(version.contentHash)) {
    throw new Error('INVALID_ARTIFACT_CONTENT_HASH');
  }
  return {
    ...version,
    id: nonBlank(version.id, 'INVALID_ARTIFACT_VERSION_ID'),
    versionLabel: nonBlank(
      version.versionLabel,
      'INVALID_ARTIFACT_VERSION_LABEL',
    ),
    sourceRef,
  };
}

export function createArtifactCatalogEntry(
  input: Omit<
    ArtifactCatalogEntry,
    'currentVersionId' | 'rowVersion' | 'versions' | 'updatedAt'
  > & { version: ArtifactVersion },
): ArtifactCatalogEntry {
  const version = validateVersion(input.version);
  return {
    id: nonBlank(input.id, 'INVALID_ARTIFACT_ID'),
    requirementId: nonBlank(
      input.requirementId,
      'INVALID_ARTIFACT_REQUIREMENT_ID',
    ),
    capId: nonBlank(input.capId, 'INVALID_ARTIFACT_CAP_ID'),
    stage: input.stage,
    artifactType: nonBlank(input.artifactType, 'INVALID_ARTIFACT_TYPE'),
    title: nonBlank(input.title, 'INVALID_ARTIFACT_TITLE'),
    status: input.status,
    currentVersionId: version.id,
    rowVersion: 0,
    versions: [version],
    createdAt: input.createdAt,
    updatedAt: version.createdAt,
  };
}

export function appendArtifactVersion(
  artifact: ArtifactCatalogEntry,
  candidate: ArtifactVersion,
): ArtifactCatalogEntry {
  const version = validateVersion(candidate);
  if (
    artifact.versions.some(
      (item) =>
        item.id === version.id || item.versionLabel === version.versionLabel,
    )
  ) {
    throw new Error('ARTIFACT_VERSION_ALREADY_EXISTS');
  }
  return {
    ...artifact,
    currentVersionId: version.id,
    rowVersion: artifact.rowVersion + 1,
    versions: [...artifact.versions, version],
    updatedAt: version.createdAt,
  };
}
