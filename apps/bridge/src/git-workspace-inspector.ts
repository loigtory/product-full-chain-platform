import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import type { PairingWorkspaceInspectorPort } from './ports.ts';

type ExecutePort = (
  file: string,
  args: readonly string[],
  options: Readonly<{
    shell: false;
    windowsHide: true;
    timeout: number;
    maxBuffer: number;
  }>,
) => Promise<{ stdout: string; stderr: string }>;

const executeFile = promisify(execFile) as unknown as ExecutePort;

export class GitWorkspaceInspector implements PairingWorkspaceInspectorPort {
  private readonly execute: ExecutePort;

  constructor(dependencies: { execute?: ExecutePort } = {}) {
    this.execute = dependencies.execute ?? executeFile;
  }

  async currentGitBaseline(workspacePath: string): Promise<string> {
    if (!path.win32.isAbsolute(workspacePath)) {
      throw new Error('BRIDGE_WORKSPACE_PATH_INVALID');
    }
    const result = await this.execute(
      'git',
      ['-C', workspacePath, 'rev-parse', 'HEAD'],
      {
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 16 * 1024,
      },
    );
    const baseline = result.stdout.trim();
    if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(baseline)) {
      throw new Error('BRIDGE_GIT_BASELINE_INVALID');
    }
    return baseline.toLowerCase();
  }

  async repositoryFingerprint(workspacePath: string): Promise<string> {
    if (!path.win32.isAbsolute(workspacePath)) {
      throw new Error('BRIDGE_WORKSPACE_PATH_INVALID');
    }
    const result = await this.execute(
      'git',
      ['-C', workspacePath, 'config', '--get', 'remote.origin.url'],
      {
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 16 * 1024,
      },
    );
    const remote = result.stdout.trim();
    if (!remote || remote.length > 2_048 || /[\r\n\0]/.test(remote)) {
      throw new Error('BRIDGE_GIT_REMOTE_INVALID');
    }
    return `sha256:${createHash('sha256').update(remote).digest('hex')}`;
  }
}
