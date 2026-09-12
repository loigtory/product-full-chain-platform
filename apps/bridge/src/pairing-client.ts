import { access, mkdir, open } from 'node:fs/promises';
import path from 'node:path';

import { GitWorkspaceInspector } from './git-workspace-inspector.ts';
import { LocalBridgeRegistry, type RegistryConfig } from './local-registry.ts';
import type { PairingWorkspaceInspectorPort } from './ports.ts';
import {
  normalizeLoopbackServerUrl,
  resolveIgnoredLocalPath,
} from './runtime-config.ts';

export type BridgeCredentialFile = Readonly<{
  bridgeId: string;
  credential: string;
  serverUrl: string;
}>;

type PersistCredential = (
  filePath: string,
  value: BridgeCredentialFile,
) => Promise<void>;

type PrepareCredentialTarget = (filePath: string) => Promise<void>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function persistBridgeCredential(
  filePath: string,
  value: BridgeCredentialFile,
  projectRoot = process.cwd(),
): Promise<void> {
  const target = resolveIgnoredLocalPath(filePath, projectRoot);
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

export async function assertBridgeCredentialTargetAvailable(
  filePath: string,
  projectRoot = process.cwd(),
): Promise<void> {
  const target = resolveIgnoredLocalPath(filePath, projectRoot);
  try {
    await access(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('BRIDGE_CREDENTIAL_TARGET_UNREADABLE', { cause: error });
  }
  throw new Error('BRIDGE_CREDENTIAL_FILE_EXISTS');
}

export async function pairLocalBridge(
  input: {
    pairingCode: string;
    serverUrl: string;
    credentialFile: string;
    versions: Readonly<{
      bridgeVersion: string;
      nodeVersion: string;
      codexVersion: string | null;
      zedVersion: string | null;
    }>;
    registry: RegistryConfig;
  },
  dependencies: {
    fetcher?: typeof fetch;
    persistCredential?: PersistCredential;
    prepareCredentialTarget?: PrepareCredentialTarget;
    workspaceInspector?: PairingWorkspaceInspectorPort;
  } = {},
): Promise<{ bridgeId: string; teamId: string }> {
  if (input.pairingCode.length < 20 || input.pairingCode.length > 400) {
    throw new Error('BRIDGE_PAIRING_CODE_INVALID');
  }
  const serverUrl = normalizeLoopbackServerUrl(input.serverUrl);
  const registry = new LocalBridgeRegistry(input.registry);
  await (
    dependencies.prepareCredentialTarget ??
    assertBridgeCredentialTargetAvailable
  )(input.credentialFile);
  const workspaces = await registry.verifyPairingWorkspaces(
    dependencies.workspaceInspector ?? new GitWorkspaceInspector(),
  );
  if (!workspaces.length) throw new Error('BRIDGE_PAIRING_WORKSPACE_REQUIRED');
  const response = await (dependencies.fetcher ?? fetch)(
    `${serverUrl}/bridge/v1/pairings/exchange`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pairingCode: input.pairingCode,
        ...input.versions,
        workspaces,
      }),
    },
  );
  if (!response.ok) throw new Error('BRIDGE_PAIRING_EXCHANGE_FAILED');
  const result: unknown = await response.json();
  if (
    !record(result) ||
    Object.keys(result).sort().join(',') !== 'bridgeId,credential,teamId' ||
    typeof result.bridgeId !== 'string' ||
    typeof result.teamId !== 'string' ||
    typeof result.credential !== 'string' ||
    result.credential.length < 20 ||
    result.credential.length > 400
  ) {
    throw new Error('BRIDGE_PAIRING_RESPONSE_INVALID');
  }
  await (dependencies.persistCredential ?? persistBridgeCredential)(
    input.credentialFile,
    {
      bridgeId: result.bridgeId,
      credential: result.credential,
      serverUrl,
    },
  );
  return { bridgeId: result.bridgeId, teamId: result.teamId };
}
