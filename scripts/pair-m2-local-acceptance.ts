import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { pairLocalBridge } from '../apps/bridge/src/pairing-client.ts';
import type { RegistryConfig } from '../apps/bridge/src/local-registry.ts';
import { normalizeDetectedToolVersion } from '../apps/bridge/src/tool-version.ts';
import { localAcceptancePaths } from './m2-local-acceptance/local-files.ts';

const executeFile = promisify(execFile);

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`M2_PAIRING_${key}_REQUIRED`);
  return value;
}

function pairingAttempt(): string {
  const index = process.argv.indexOf('--attempt');
  const value =
    index >= 0 ? process.argv[index + 1]?.trim().toUpperCase() : 'PRIMARY';
  if (!value || !/^[A-Z0-9][A-Z0-9_]{2,39}$/.test(value)) {
    throw new Error('M2_PAIRING_ATTEMPT_INVALID');
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('M2_PAIRING_RESPONSE_INVALID');
  }
  return value as Record<string, unknown>;
}

async function failWithResponse(
  code: string,
  response: Response,
): Promise<never> {
  const body = asRecord(await response.json().catch(() => ({})));
  const platformCode =
    typeof body.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(body.code)
      ? body.code
      : 'UNKNOWN';
  throw new Error(`${code} status=${response.status} code=${platformCode}`);
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

const projectRoot = path.resolve(import.meta.dirname, '..');
const paths = localAcceptancePaths(projectRoot);
const attempt = pairingAttempt();
const login = asRecord(JSON.parse(await readFile(paths.loginFile, 'utf8')));
const registry = JSON.parse(
  await readFile(paths.registryFile, 'utf8'),
) as RegistryConfig;
if (
  typeof login.loginName !== 'string' ||
  typeof login.password !== 'string' ||
  typeof login.teamId !== 'string'
) {
  throw new Error('M2_PAIRING_LOGIN_FILE_INVALID');
}
const serverUrl = required('PFC_BRIDGE_SERVER_URL');
const sessionResponse = await fetch(`${serverUrl}/api/v1/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    loginName: login.loginName,
    password: login.password,
  }),
});
if (!sessionResponse.ok) {
  await failWithResponse('M2_PAIRING_LOGIN_FAILED', sessionResponse);
}
const session = asRecord(await sessionResponse.json());
const actor = asRecord(session.actor);
if (typeof actor.csrfToken !== 'string') {
  throw new Error('M2_PAIRING_SESSION_INVALID');
}
const cookies = sessionResponse.headers
  .getSetCookie()
  .map((value) => value.split(';', 1)[0])
  .join('; ');
const sessionStateResponse = await fetch(`${serverUrl}/api/v1/session-state`, {
  headers: { Cookie: cookies },
});
const sessionState = sessionStateResponse.ok
  ? asRecord(await sessionStateResponse.json())
  : null;
if (sessionState?.authenticated !== true) {
  throw new Error('M2_PAIRING_SESSION_READBACK_FAILED');
}
const pairingResponse = await fetch(
  `${serverUrl}/api/v1/teams/${encodeURIComponent(login.teamId)}/bridge-pairings`,
  {
    method: 'POST',
    headers: {
      Cookie: cookies,
      'Idempotency-Key': `CODEx_TEST_${String(login.runId)}_PAIR_${attempt}`,
      'X-CSRF-Token': actor.csrfToken,
    },
  },
);
if (!pairingResponse.ok) {
  await failWithResponse('M2_PAIRING_CREATE_FAILED', pairingResponse);
}
const pairing = asRecord(await pairingResponse.json());
if (typeof pairing.pairingCode !== 'string') {
  throw new Error('M2_PAIRING_CODE_UNAVAILABLE');
}
const result = await pairLocalBridge({
  pairingCode: pairing.pairingCode,
  serverUrl,
  credentialFile: paths.credentialFile,
  registry,
  versions: {
    bridgeVersion: '0.0.0',
    nodeVersion: process.version,
    codexVersion: await detectVersion(required('PFC_CODEX_BINARY')),
    zedVersion: await detectVersion(process.env.PFC_ZED_BINARY),
  },
});
console.log(
  JSON.stringify({
    status: 'M2_LOCAL_BRIDGE_PAIRED',
    pairingId: pairing.pairingId,
    bridgeId: result.bridgeId,
    teamId: result.teamId,
    credential: 'stored',
  }),
);
