import { access, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';

import { resolveIgnoredLocalPath } from '../../apps/bridge/src/runtime-config.ts';

export function m2R2AcceptancePaths(projectRoot: string) {
  const root = resolveIgnoredLocalPath(
    path.resolve(projectRoot, '.local/m2-r2-acceptance'),
    projectRoot,
  );
  return {
    root,
    accountsFile: path.join(root, 'accounts.json'),
    registryFile: path.join(root, 'registry.json'),
    credentialFile: path.join(root, 'credential.json'),
    apiResultFile: path.join(root, 'api-result.json'),
    unknownResultFile: path.join(root, 'unknown-result.json'),
    unknownFinalResultFile: path.join(root, 'unknown-final-result.json'),
    browserResultFile: path.join(root, 'browser-result.json'),
    readbackFile: path.join(root, 'readback.json'),
  } as const;
}

export async function assertNewPrivateTarget(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('M2_R2_ACCEPTANCE_FILE_UNREADABLE', { cause: error });
  }
  throw new Error('M2_R2_ACCEPTANCE_FILE_EXISTS');
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
