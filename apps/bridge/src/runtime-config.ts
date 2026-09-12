import { readFile } from 'node:fs/promises';
import path from 'node:path';

type ReadText = (filePath: string, encoding: BufferEncoding) => Promise<string>;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`BRIDGE_CONFIG_${key}_REQUIRED`);
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function resolveIgnoredLocalPath(
  filePath: string,
  projectRoot = process.cwd(),
): string {
  const localRoot = path.resolve(projectRoot, '.local');
  const resolved = path.resolve(filePath);
  const relative = path.relative(localRoot, resolved);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('BRIDGE_CONFIG_FILE_MUST_BE_LOCAL_IGNORED');
  }
  return resolved;
}

export function normalizeLoopbackServerUrl(value: string): string {
  const serverUrl = new URL(value);
  if (
    serverUrl.protocol !== 'http:' ||
    serverUrl.hostname !== '127.0.0.1' ||
    !serverUrl.port ||
    serverUrl.username ||
    serverUrl.password
  ) {
    throw new Error('BRIDGE_CONFIG_LOOPBACK_SERVER_REQUIRED');
  }
  return serverUrl.origin;
}

export type BridgeRuntimeConfig = Readonly<{
  bridgeId: string;
  credential: string;
  serverUrl: string;
  registryFile: string;
  codexBinary: string;
  pollIntervalMs: number;
  runTimeoutMs: number;
}>;

export async function loadBridgeRuntimeConfig(
  env: NodeJS.ProcessEnv,
  projectRoot = process.cwd(),
  readText: ReadText = readFile,
): Promise<BridgeRuntimeConfig> {
  const credentialFile = resolveIgnoredLocalPath(
    required(env, 'PFC_BRIDGE_CREDENTIAL_FILE'),
    projectRoot,
  );
  let credentials: unknown;
  try {
    credentials = JSON.parse(await readText(credentialFile, 'utf8'));
  } catch {
    throw new Error('BRIDGE_CONFIG_CREDENTIAL_FILE_INVALID');
  }
  if (
    !record(credentials) ||
    Object.keys(credentials).sort().join(',') !==
      'bridgeId,credential,serverUrl' ||
    typeof credentials.bridgeId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(credentials.bridgeId) ||
    typeof credentials.credential !== 'string' ||
    credentials.credential.length < 20 ||
    credentials.credential.length > 400 ||
    typeof credentials.serverUrl !== 'string'
  ) {
    throw new Error('BRIDGE_CONFIG_CREDENTIAL_FILE_INVALID');
  }
  const registryFile = resolveIgnoredLocalPath(
    required(env, 'PFC_BRIDGE_REGISTRY_FILE'),
    projectRoot,
  );
  const pollIntervalMs = Number(env.PFC_BRIDGE_POLL_INTERVAL_MS ?? '1000');
  if (
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 250 ||
    pollIntervalMs > 10_000
  ) {
    throw new Error('BRIDGE_CONFIG_POLL_INTERVAL_INVALID');
  }
  const runTimeoutMs = Number(env.PFC_CODEX_RUN_TIMEOUT_MS ?? '180000');
  if (
    !Number.isInteger(runTimeoutMs) ||
    runTimeoutMs < 30_000 ||
    runTimeoutMs > 600_000
  ) {
    throw new Error('BRIDGE_CONFIG_CODEX_RUN_TIMEOUT_INVALID');
  }
  return {
    bridgeId: credentials.bridgeId,
    credential: credentials.credential,
    serverUrl: normalizeLoopbackServerUrl(credentials.serverUrl),
    registryFile,
    codexBinary: required(env, 'PFC_CODEX_BINARY'),
    pollIntervalMs,
    runTimeoutMs,
  };
}
