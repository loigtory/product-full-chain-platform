import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createDatabase } from '@pfc/persistence';

import { HttpBridgeGateway } from '../apps/bridge/src/http-gateway.ts';
import {
  m2R2AcceptancePaths,
  writeNewPrivateJson,
} from './m2-r2-local-acceptance/local-files.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('M2_R2_UNKNOWN_DATABASE_TARGET_INVALID');
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const paths = m2R2AcceptancePaths(projectRoot);
const credential = JSON.parse(
  await readFile(paths.credentialFile, 'utf8'),
) as Record<string, unknown>;
if (
  typeof credential.bridgeId !== 'string' ||
  typeof credential.credential !== 'string' ||
  credential.serverUrl !== 'http://127.0.0.1:3001'
) {
  throw new Error('M2_R2_UNKNOWN_BRIDGE_CREDENTIAL_INVALID');
}

const database = createDatabase({ connectionString, maxConnections: 1 });
try {
  const db = database.withSchema('pfc');
  const candidates = await db
    .selectFrom('agent_runs')
    .innerJoin(
      'agent_run_commands',
      'agent_run_commands.run_id',
      'agent_runs.id',
    )
    .select([
      'agent_runs.id as run_id',
      'agent_runs.bridge_id',
      'agent_run_commands.id as command_id',
      'agent_run_commands.lease_owner',
    ])
    .where(
      'agent_runs.id',
      'like',
      'CODEx_TEST_M2_R2_REAL_20260907_A_agent-run-%',
    )
    .where('agent_runs.status', '=', 'RUNNING')
    .where('agent_run_commands.command_type', '=', 'START_WORKSPACE_WRITE_RUN')
    .where('agent_run_commands.status', '=', 'LEASED')
    .execute();
  if (
    candidates.length !== 1 ||
    candidates[0]?.bridge_id !== credential.bridgeId ||
    candidates[0].lease_owner !== credential.bridgeId
  ) {
    throw new Error('M2_R2_UNKNOWN_CANDIDATE_NOT_UNIQUE');
  }
  const candidate = candidates[0];
  await new HttpBridgeGateway({
    baseUrl: credential.serverUrl,
    bridgeId: credential.bridgeId,
    credential: credential.credential,
  }).acknowledge({
    bridgeId: credential.bridgeId,
    commandId: candidate.command_id,
    runId: candidate.run_id,
    status: 'UNKNOWN',
    reasonCode: 'BRIDGE_SESSION_RELEASE_FAILED',
    acknowledgedAt: new Date().toISOString(),
  });
  const readback = await db
    .selectFrom('agent_runs')
    .innerJoin(
      'agent_run_commands',
      'agent_run_commands.run_id',
      'agent_runs.id',
    )
    .select([
      'agent_runs.id as run_id',
      'agent_runs.status',
      'agent_runs.result_outcome',
      'agent_runs.failure_reason',
      'agent_run_commands.status as command_status',
    ])
    .where('agent_runs.id', '=', candidate.run_id)
    .where('agent_run_commands.id', '=', candidate.command_id)
    .executeTakeFirstOrThrow();
  if (
    readback.status !== 'UNKNOWN' ||
    readback.result_outcome !== 'UNKNOWN' ||
    readback.command_status !== 'UNKNOWN'
  ) {
    throw new Error('M2_R2_UNKNOWN_READBACK_INVALID');
  }
  const result = {
    status: 'PASS',
    runId: readback.run_id,
    runStatus: readback.status,
    resultOutcome: readback.result_outcome,
    reasonCode: readback.failure_reason,
    commandStatus: readback.command_status,
    source: 'BRIDGE_ACKNOWLEDGEMENT_API',
    retained: true,
  } as const;
  await writeNewPrivateJson(paths.unknownResultFile, result);
  console.log(JSON.stringify(result));
} finally {
  await database.destroy();
}
