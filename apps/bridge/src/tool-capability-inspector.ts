import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CapabilityState } from '../../../packages/protocol/src/index.ts';

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

export class LocalToolCapabilityInspector {
  private readonly execute: ExecutePort;

  constructor(dependencies: { execute?: ExecutePort } = {}) {
    this.execute = dependencies.execute ?? executeFile;
  }

  async codexAppServer(binary: string): Promise<CapabilityState> {
    try {
      const result = await this.execute(binary, ['app-server', '--help'], {
        shell: false,
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 16 * 1024,
      });
      return /app-server/i.test(`${result.stdout}\n${result.stderr}`)
        ? 'AVAILABLE'
        : 'UNVERIFIED';
    } catch {
      return 'UNAVAILABLE';
    }
  }
}
