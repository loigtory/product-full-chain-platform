import { access, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';

import { resolveIgnoredLocalPath } from '../../apps/bridge/src/runtime-config.ts';

export function localAcceptancePaths(projectRoot: string) {
  return {
    loginFile: resolveIgnoredLocalPath(
      path.resolve(projectRoot, '.local/m2-acceptance/login.json'),
      projectRoot,
    ),
    registryFile: resolveIgnoredLocalPath(
      path.resolve(projectRoot, '.local/bridge/registry.json'),
      projectRoot,
    ),
    credentialFile: resolveIgnoredLocalPath(
      path.resolve(projectRoot, '.local/bridge/credential.json'),
      projectRoot,
    ),
  } as const;
}

export async function assertNewFileTarget(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('M2_ACCEPTANCE_FILE_UNREADABLE', { cause: error });
  }
  throw new Error('M2_ACCEPTANCE_FILE_EXISTS');
}

export async function writeNewPrivateJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

export async function removeOwnedFiles(filePaths: readonly string[]) {
  await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }),
  );
}
