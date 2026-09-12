import { createHash } from 'node:crypto';
import {
  readFile as readFileFromDisk,
  realpath as resolveRealPath,
} from 'node:fs/promises';
import path from 'node:path';

import type { ArtifactInspectorPort } from './ports.ts';

type FileArtifactInspectorDependencies = Readonly<{
  realpath: (input: string) => Promise<string>;
  readFile: (input: string) => Promise<Buffer>;
}>;

export class FileArtifactInspector implements ArtifactInspectorPort {
  constructor(
    private readonly dependencies: FileArtifactInspectorDependencies = {
      realpath: resolveRealPath,
      readFile: readFileFromDisk,
    },
  ) {}

  async inspectWithinScope(input: {
    workspacePath: string;
    scopePath: string;
    artifactPath: string;
  }): ReturnType<ArtifactInspectorPort['inspectWithinScope']> {
    try {
      const canonicalWorkspace = await this.dependencies.realpath(
        input.workspacePath,
      );
      const canonicalScope = await this.dependencies.realpath(input.scopePath);
      const canonicalArtifact = await this.dependencies.realpath(
        input.artifactPath,
      );
      const pathApi = /^[A-Za-z]:[\\/]/.test(canonicalWorkspace)
        ? path.win32
        : path.posix;
      const scopeRelative = pathApi.relative(
        canonicalWorkspace,
        canonicalScope,
      );
      const artifactRelative = pathApi.relative(
        canonicalScope,
        canonicalArtifact,
      );
      if (
        !scopeRelative ||
        scopeRelative === '..' ||
        scopeRelative.startsWith(`..${pathApi.sep}`) ||
        pathApi.isAbsolute(scopeRelative) ||
        !artifactRelative ||
        artifactRelative === '..' ||
        artifactRelative.startsWith(`..${pathApi.sep}`) ||
        pathApi.isAbsolute(artifactRelative)
      ) {
        return { status: 'OUTSIDE_SCOPE' };
      }
      const content = await this.dependencies.readFile(canonicalArtifact);
      return {
        status: 'VERIFIED',
        contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      };
    } catch {
      return { status: 'UNREADABLE' };
    }
  }
}
