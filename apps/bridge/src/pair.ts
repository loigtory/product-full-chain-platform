import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { RegistryConfig } from './local-registry.ts';
import { pairLocalBridge } from './pairing-client.ts';
import { resolveIgnoredLocalPath } from './runtime-config.ts';
import { normalizeDetectedToolVersion } from './tool-version.ts';

const executeFile = promisify(execFile);

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`BRIDGE_PAIRING_${key}_REQUIRED`);
  return value;
}

async function detectVersion(binary: string | undefined) {
  if (!binary?.trim()) return null;
  try {
    const result = await executeFile(binary, ['--version'], {
      shell: false,
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 16 * 1024,
    });
    return normalizeDetectedToolVersion(result.stdout);
  } catch {
    return null;
  }
}

try {
  const projectRoot = process.cwd();
  const registryFile = resolveIgnoredLocalPath(
    required('PFC_BRIDGE_REGISTRY_FILE'),
    projectRoot,
  );
  const registry = JSON.parse(
    await readFile(registryFile, 'utf8'),
  ) as RegistryConfig;
  const result = await pairLocalBridge({
    pairingCode: required('PFC_BRIDGE_PAIRING_CODE'),
    serverUrl: required('PFC_BRIDGE_SERVER_URL'),
    credentialFile: required('PFC_BRIDGE_CREDENTIAL_FILE'),
    registry,
    versions: {
      bridgeVersion: '0.0.0',
      nodeVersion: process.version,
      codexVersion: await detectVersion(required('PFC_CODEX_BINARY')),
      zedVersion: await detectVersion(process.env.PFC_ZED_BINARY),
    },
  });
  console.log(
    `PFC_BRIDGE_PAIRED bridgeId=${result.bridgeId} teamId=${result.teamId} credential=stored`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const code = /^[A-Z][A-Z0-9_]*$/.test(message)
    ? message
    : 'BRIDGE_PAIRING_FAILED';
  console.error(`PFC_BRIDGE_PAIRING_STOPPED code=${code}`);
  process.exitCode = 1;
}
