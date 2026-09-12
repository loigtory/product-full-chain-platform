import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { pairLocalBridge } from '../apps/bridge/src/pairing-client.ts';
import type { RegistryConfig } from '../apps/bridge/src/local-registry.ts';
import { normalizeDetectedToolVersion } from '../apps/bridge/src/tool-version.ts';
import { m2R2AcceptancePaths } from './m2-r2-local-acceptance/local-files.ts';

const executeFile = promisify(execFile);

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`M2_R2_PAIRING_${key}_REQUIRED`);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('M2_R2_PAIRING_DATA_INVALID');
  }
  return value as Record<string, unknown>;
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

async function failWithResponse(code: string, response: Response) {
  const body = record(await response.json().catch(() => ({})));
  const platformCode =
    typeof body.code === 'string' ? body.code : 'UNKNOWN_RESPONSE';
  throw new Error(`${code} status=${response.status} code=${platformCode}`);
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const paths = m2R2AcceptancePaths(projectRoot);
const accounts = record(JSON.parse(await readFile(paths.accountsFile, 'utf8')));
const approver = record(accounts.approver);
const registry = JSON.parse(
  await readFile(paths.registryFile, 'utf8'),
) as RegistryConfig;
if (
  typeof approver.loginName !== 'string' ||
  typeof approver.password !== 'string' ||
  typeof accounts.teamId !== 'string'
) {
  throw new Error('M2_R2_PAIRING_ACCOUNTS_INVALID');
}
const serverUrl = required('PFC_BRIDGE_SERVER_URL');
const sessionResponse = await fetch(`${serverUrl}/api/v1/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    loginName: approver.loginName,
    password: approver.password,
  }),
});
if (!sessionResponse.ok) {
  await failWithResponse('M2_R2_PAIRING_LOGIN_FAILED', sessionResponse);
}
const session = record(await sessionResponse.json());
const actor = record(session.actor);
if (typeof actor.csrfToken !== 'string') {
  throw new Error('M2_R2_PAIRING_SESSION_INVALID');
}
const cookies = sessionResponse.headers
  .getSetCookie()
  .map((value) => value.split(';', 1)[0])
  .join('; ');
const pairingResponse = await fetch(
  `${serverUrl}/api/v1/teams/${encodeURIComponent(accounts.teamId)}/bridge-pairings`,
  {
    method: 'POST',
    headers: {
      Cookie: cookies,
      'Idempotency-Key': `CODEx_TEST_M2_R2_${String(accounts.runId)}_PAIR`,
      'X-CSRF-Token': actor.csrfToken,
    },
  },
);
if (!pairingResponse.ok) {
  await failWithResponse('M2_R2_PAIRING_CREATE_FAILED', pairingResponse);
}
const pairing = record(await pairingResponse.json());
if (typeof pairing.pairingCode !== 'string') {
  throw new Error('M2_R2_PAIRING_CODE_UNAVAILABLE');
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
    status: 'M2_R2_LOCAL_BRIDGE_PAIRED',
    pairingId: pairing.pairingId,
    bridgeId: result.bridgeId,
    teamId: result.teamId,
    credential: 'stored',
  }),
);
