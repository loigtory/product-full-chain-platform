import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  BridgeLocalRegistryPort,
  PairingWorkspaceInspectorPort,
} from './ports.ts';

export type RegistryConfig = Readonly<{
  workspaceRoot: string;
  skillRoot: string;
  workspaces: readonly Readonly<{
    id: string;
    path: string;
    verified: boolean;
    repositoryFingerprint: string;
    allowedRelativePath: string;
  }>[];
  skills: readonly Readonly<{
    releaseId: string;
    name: string;
    path: string;
    enabled: boolean;
  }>[];
}>;

type ReadFilePort = (
  filePath: string,
  encoding: BufferEncoding,
) => Promise<string>;

function assertWithin(root: string, target: string, code: string): string {
  const normalizedRoot = path.win32.resolve(root);
  const normalizedTarget = path.win32.resolve(target);
  const relative = path.win32.relative(normalizedRoot, normalizedTarget);
  if (
    !path.win32.isAbsolute(normalizedRoot) ||
    !path.win32.isAbsolute(normalizedTarget) ||
    relative === '..' ||
    relative.startsWith(`..${path.win32.sep}`) ||
    path.win32.isAbsolute(relative)
  ) {
    throw new Error(code);
  }
  return normalizedTarget;
}

export class LocalBridgeRegistry implements BridgeLocalRegistryPort {
  private readonly workspaces = new Map<
    string,
    {
      path: string;
      verified: boolean;
      repositoryFingerprint: string;
      allowedRelativePath: string;
    }
  >();
  private readonly skills = new Map<
    string,
    { name: string; path: string; enabled: boolean }
  >();
  private readonly readFile: ReadFilePort;

  constructor(
    config: RegistryConfig,
    dependencies: { readFile?: ReadFilePort } = {},
  ) {
    this.readFile = dependencies.readFile ?? readFile;
    for (const workspace of config.workspaces) {
      if (this.workspaces.has(workspace.id)) {
        throw new Error('BRIDGE_WORKSPACE_ID_DUPLICATE');
      }
      const repositoryFingerprint =
        workspace.repositoryFingerprint.toLowerCase();
      const allowedRelativePath = workspace.allowedRelativePath.trim();
      if (!/^sha256:[a-f\d]{64}$/.test(repositoryFingerprint)) {
        throw new Error('BRIDGE_WORKSPACE_FINGERPRINT_INVALID');
      }
      if (
        !allowedRelativePath ||
        allowedRelativePath.length > 500 ||
        path.win32.isAbsolute(allowedRelativePath) ||
        allowedRelativePath.split(/[\\/]/).includes('..')
      ) {
        throw new Error('BRIDGE_WORKSPACE_ALLOWED_PATH_INVALID');
      }
      this.workspaces.set(workspace.id, {
        path: assertWithin(
          config.workspaceRoot,
          workspace.path,
          'BRIDGE_WORKSPACE_PATH_OUTSIDE_ALLOWLIST',
        ),
        verified: workspace.verified,
        repositoryFingerprint,
        allowedRelativePath,
      });
    }
    for (const skill of config.skills) {
      if (this.skills.has(skill.releaseId)) {
        throw new Error('BRIDGE_SKILL_RELEASE_ID_DUPLICATE');
      }
      this.skills.set(skill.releaseId, {
        name: skill.name,
        path: assertWithin(
          config.skillRoot,
          skill.path,
          'BRIDGE_SKILL_PATH_OUTSIDE_ALLOWLIST',
        ),
        enabled: skill.enabled,
      });
    }
  }

  async resolveWorkspace(workspaceId: string) {
    return this.workspaces.get(workspaceId) ?? null;
  }

  async resolveSkill(skillReleaseId: string) {
    const skill = this.skills.get(skillReleaseId);
    if (!skill) return null;
    const content = await this.readFile(skill.path, 'utf8');
    return {
      ...skill,
      contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    };
  }

  listVerifiedWorkspaces() {
    return [...this.workspaces.entries()]
      .filter(([, workspace]) => workspace.verified)
      .map(([workspaceId, workspace]) => ({
        workspaceId,
        path: workspace.path,
      }));
  }

  listPairingWorkspaces() {
    return [...this.workspaces.entries()]
      .filter(([, workspace]) => workspace.verified)
      .map(([workspaceId, workspace]) => ({
        workspaceId,
        repositoryFingerprint: workspace.repositoryFingerprint,
        allowedRelativePath: workspace.allowedRelativePath,
      }));
  }

  async verifyPairingWorkspaces(inspector: PairingWorkspaceInspectorPort) {
    const workspaces = this.listPairingWorkspaces();
    for (const workspace of workspaces) {
      const local = this.workspaces.get(workspace.workspaceId)!;
      const [repositoryFingerprint] = await Promise.all([
        inspector.repositoryFingerprint(local.path),
        inspector.currentGitBaseline(local.path),
      ]);
      if (repositoryFingerprint !== workspace.repositoryFingerprint) {
        throw new Error('BRIDGE_WORKSPACE_FINGERPRINT_DRIFT');
      }
    }
    return workspaces;
  }

  async listEnabledSkills() {
    const releases = [...this.skills.entries()].filter(
      ([, skill]) => skill.enabled,
    );
    return Promise.all(
      releases.map(async ([releaseId, skill]) => {
        const content = await this.readFile(skill.path, 'utf8');
        return {
          releaseId,
          contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        };
      }),
    );
  }
}
