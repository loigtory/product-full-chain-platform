import { createHash } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
} from 'node:fs/promises';
import path from 'node:path';

import type { AgentRunScopeDto } from '../../../packages/contracts/src/index.ts';

type ManifestEntry = Readonly<{
  path: string;
  bytes: number;
  contentHash: string;
}>;

type AllowedEntry = Readonly<{
  path: string;
  kind: 'FILE' | 'DIRECTORY';
}>;

export type RunCapsule = Readonly<{
  id: string;
  runId: string;
  executionInstanceId: string;
  path: string;
  sourceGitBaseline: string;
  scope: AgentRunScopeDto;
  scopeHash: string;
  allowedEntries: readonly AllowedEntry[];
  beforeManifest: readonly ManifestEntry[];
  beforeManifestHash: string;
}>;

export type RunCapsuleVerification = Readonly<{
  status: 'VERIFIED';
  changedFiles: number;
  changedBytes: number;
  changedPaths: readonly string[];
  beforeManifestHash: string;
  afterManifestHash: string;
}>;

function hash(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function identifier(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/.test(normalized)) {
    throw new Error('CAPSULE_ID_INVALID');
  }
  return normalized;
}

function relativePath(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('CAPSULE_SCOPE_INVALID');
  }
  return normalized;
}

function ensureWithin(root: string, target: string, code: string): void {
  const relative = path.relative(root, target);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(code);
  }
}

function canonicalScope(scope: AgentRunScopeDto): string {
  return JSON.stringify({
    allowedRelativePaths: [...scope.allowedRelativePaths].sort(),
    allowedActions: [...scope.allowedActions].sort(),
    networkAccess: scope.networkAccess,
    maxChangedFiles: scope.maxChangedFiles,
    maxChangedBytes: scope.maxChangedBytes,
    expiresAt: scope.expiresAt,
  });
}

function manifestHash(entries: readonly ManifestEntry[]): string {
  return hash(JSON.stringify(entries));
}

async function assertNoLinkedSegment(
  sourceRoot: string,
  relative: string,
): Promise<void> {
  let current = sourceRoot;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) {
      throw new Error('CAPSULE_SOURCE_LINK_FORBIDDEN');
    }
  }
  ensureWithin(
    await realpath(sourceRoot),
    await realpath(current),
    'CAPSULE_SOURCE_ESCAPE',
  );
}

async function copyEntry(
  sourceRoot: string,
  capsulePath: string,
  relative: string,
  counters: { files: number; bytes: number },
  limits: { files: number; bytes: number },
): Promise<'FILE' | 'DIRECTORY'> {
  await assertNoLinkedSegment(sourceRoot, relative);
  const source = path.resolve(sourceRoot, ...relative.split('/'));
  const destination = path.resolve(capsulePath, ...relative.split('/'));
  ensureWithin(sourceRoot, source, 'CAPSULE_SOURCE_ESCAPE');
  ensureWithin(capsulePath, destination, 'CAPSULE_DESTINATION_ESCAPE');
  const stats = await lstat(source);
  if (stats.isSymbolicLink()) throw new Error('CAPSULE_SOURCE_LINK_FORBIDDEN');
  if (stats.isFile()) {
    counters.files += 1;
    counters.bytes += stats.size;
    if (counters.files > limits.files || counters.bytes > limits.bytes) {
      throw new Error('CAPSULE_SOURCE_LIMIT_EXCEEDED');
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return 'FILE';
  }
  if (!stats.isDirectory()) throw new Error('CAPSULE_SOURCE_TYPE_FORBIDDEN');
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.isSymbolicLink()) {
      throw new Error('CAPSULE_SOURCE_LINK_FORBIDDEN');
    }
    await copyEntry(
      sourceRoot,
      capsulePath,
      `${relative}/${entry.name}`,
      counters,
      limits,
    );
  }
  return 'DIRECTORY';
}

async function readManifest(
  capsulePath: string,
  relative = '',
): Promise<readonly ManifestEntry[]> {
  const current = relative
    ? path.resolve(capsulePath, ...relative.split('/'))
    : capsulePath;
  ensureWithin(capsulePath, current, 'CAPSULE_DESTINATION_ESCAPE');
  const entries = await readdir(current, { withFileTypes: true });
  const manifest: ManifestEntry[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.isSymbolicLink()) throw new Error('CAPSULE_LINK_FORBIDDEN');
    const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const entryPath = path.join(current, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) throw new Error('CAPSULE_LINK_FORBIDDEN');
    if (stats.isDirectory()) {
      manifest.push(...(await readManifest(capsulePath, entryRelative)));
      continue;
    }
    if (!stats.isFile()) throw new Error('CAPSULE_CONTENT_TYPE_FORBIDDEN');
    manifest.push({
      path: entryRelative.replaceAll('\\', '/'),
      bytes: stats.size,
      contentHash: hash(await readFile(entryPath)),
    });
  }
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

function pathIsAllowed(
  relative: string,
  allowedEntries: readonly AllowedEntry[],
): boolean {
  return allowedEntries.some((entry) =>
    entry.kind === 'FILE'
      ? relative === entry.path
      : relative.startsWith(`${entry.path}/`),
  );
}

export class RunCapsuleManager {
  private readonly capsuleRoot: string;
  private readonly maxSourceFiles: number;
  private readonly maxSourceBytes: number;

  constructor(input: {
    capsuleRoot: string;
    maxSourceFiles?: number;
    maxSourceBytes?: number;
  }) {
    this.capsuleRoot = path.resolve(input.capsuleRoot);
    this.maxSourceFiles = Math.min(
      Math.max(input.maxSourceFiles ?? 2_000, 1),
      10_000,
    );
    this.maxSourceBytes = Math.min(
      Math.max(input.maxSourceBytes ?? 50_000_000, 1),
      250_000_000,
    );
  }

  async materialize(input: {
    runId: string;
    executionInstanceId: string;
    sourceWorkspacePath: string;
    sourceGitBaseline: string;
    scope: AgentRunScopeDto;
  }): Promise<RunCapsule> {
    const runId = identifier(input.runId);
    const executionInstanceId = identifier(input.executionInstanceId);
    if (!/^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(input.sourceGitBaseline)) {
      throw new Error('CAPSULE_GIT_BASELINE_INVALID');
    }
    if (input.scope.networkAccess) throw new Error('CAPSULE_NETWORK_FORBIDDEN');
    const allowedPaths = input.scope.allowedRelativePaths.map(relativePath);
    if (
      !allowedPaths.length ||
      new Set(allowedPaths).size !== allowedPaths.length
    ) {
      throw new Error('CAPSULE_SCOPE_INVALID');
    }
    const sourceRoot = path.resolve(input.sourceWorkspacePath);
    const sourceRootStats = await lstat(sourceRoot);
    if (sourceRootStats.isSymbolicLink() || !sourceRootStats.isDirectory()) {
      throw new Error('CAPSULE_SOURCE_LINK_FORBIDDEN');
    }
    await mkdir(this.capsuleRoot, { recursive: true });
    const actualCapsuleRoot = await realpath(this.capsuleRoot);
    ensureWithin(
      actualCapsuleRoot,
      path.resolve(actualCapsuleRoot, runId),
      'CAPSULE_DESTINATION_ESCAPE',
    );
    const runRoot = path.resolve(actualCapsuleRoot, runId);
    await mkdir(runRoot, { recursive: true });
    const runRootStats = await lstat(runRoot);
    if (runRootStats.isSymbolicLink())
      throw new Error('CAPSULE_LINK_FORBIDDEN');
    const capsulePath = path.resolve(runRoot, executionInstanceId);
    ensureWithin(actualCapsuleRoot, capsulePath, 'CAPSULE_DESTINATION_ESCAPE');
    await mkdir(capsulePath, { recursive: false });
    const counters = { files: 0, bytes: 0 };
    const allowedEntries: AllowedEntry[] = [];
    try {
      for (const allowedPath of allowedPaths) {
        const kind = await copyEntry(
          sourceRoot,
          capsulePath,
          allowedPath,
          counters,
          { files: this.maxSourceFiles, bytes: this.maxSourceBytes },
        );
        allowedEntries.push({ path: allowedPath, kind });
      }
      const beforeManifest = await readManifest(capsulePath);
      const scope = { ...input.scope, allowedRelativePaths: allowedPaths };
      return {
        id: `${runId}_${executionInstanceId}`,
        runId,
        executionInstanceId,
        path: capsulePath,
        sourceGitBaseline: input.sourceGitBaseline.toLowerCase(),
        scope,
        scopeHash: hash(canonicalScope(scope)),
        allowedEntries,
        beforeManifest,
        beforeManifestHash: manifestHash(beforeManifest),
      };
    } catch (error) {
      await rm(capsulePath, {
        recursive: true,
        force: true,
        maxRetries: 75,
        retryDelay: 200,
      });
      throw error;
    }
  }

  async verify(capsule: RunCapsule): Promise<RunCapsuleVerification> {
    const capsulePath = path.resolve(capsule.path);
    ensureWithin(this.capsuleRoot, capsulePath, 'CAPSULE_DESTINATION_ESCAPE');
    const afterManifest = await readManifest(capsulePath);
    const before = new Map(
      capsule.beforeManifest.map((entry) => [entry.path, entry]),
    );
    const after = new Map(afterManifest.map((entry) => [entry.path, entry]));
    const changedPaths = [...new Set([...before.keys(), ...after.keys()])]
      .filter((entryPath) => {
        const previous = before.get(entryPath);
        const current = after.get(entryPath);
        return (
          !previous ||
          !current ||
          previous.bytes !== current.bytes ||
          previous.contentHash !== current.contentHash
        );
      })
      .sort();
    if (
      changedPaths.some(
        (entryPath) => !pathIsAllowed(entryPath, capsule.allowedEntries),
      )
    ) {
      throw new Error('CAPSULE_SCOPE_VIOLATION');
    }
    const changedBytes = changedPaths.reduce((total, entryPath) => {
      const previous = before.get(entryPath)?.bytes ?? 0;
      const current = after.get(entryPath)?.bytes ?? 0;
      return total + Math.max(previous, current);
    }, 0);
    if (
      changedPaths.length > capsule.scope.maxChangedFiles ||
      changedBytes > capsule.scope.maxChangedBytes
    ) {
      throw new Error('CAPSULE_CHANGE_LIMIT_EXCEEDED');
    }
    return {
      status: 'VERIFIED',
      changedFiles: changedPaths.length,
      changedBytes,
      changedPaths,
      beforeManifestHash: capsule.beforeManifestHash,
      afterManifestHash: manifestHash(afterManifest),
    };
  }

  async cleanup(capsule: RunCapsule): Promise<void> {
    const capsulePath = path.resolve(capsule.path);
    ensureWithin(this.capsuleRoot, capsulePath, 'CAPSULE_DESTINATION_ESCAPE');
    if (capsulePath === this.capsuleRoot) {
      throw new Error('CAPSULE_CLEANUP_TARGET_INVALID');
    }
    await rm(capsulePath, {
      recursive: true,
      force: true,
      maxRetries: 75,
      retryDelay: 200,
    });
    const runRoot = path.dirname(capsulePath);
    ensureWithin(this.capsuleRoot, runRoot, 'CAPSULE_CLEANUP_TARGET_INVALID');
    if (runRoot === this.capsuleRoot) {
      throw new Error('CAPSULE_CLEANUP_TARGET_INVALID');
    }
    await rmdir(runRoot);
  }
}
