import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseBridgeCommand } from '@pfc/protocol';

import { HttpBridgeGateway } from '../apps/bridge/src/http-gateway.ts';
import {
  M2_R2_SKILL_KEY,
  M2_R2_SKILL_VERSION,
} from './m2-r2-skill-manifest.ts';
import {
  asRecord,
  createLocalSession,
  platformRequest,
} from './m2-r2-local-acceptance/http-client.ts';
import {
  m2R2AcceptancePaths,
  writeNewPrivateJson,
} from './m2-r2-local-acceptance/local-files.ts';

const baseUrl = 'http://127.0.0.1:3001';
const projectRoot = path.resolve(import.meta.dirname, '..');
const paths = m2R2AcceptancePaths(projectRoot);
const accounts = asRecord(
  JSON.parse(await readFile(paths.accountsFile, 'utf8')),
);
const requesterAccount = asRecord(accounts.requester);
const approverAccount = asRecord(accounts.approver);
const credential = asRecord(
  JSON.parse(await readFile(paths.credentialFile, 'utf8')),
);
for (const [field, value] of [
  ['requirementId', accounts.requirementId],
  ['baselineId', accounts.baselineId],
  ['workspaceId', accounts.workspaceId],
  ['runId', accounts.runId],
  ['requesterLogin', requesterAccount.loginName],
  ['requesterPassword', requesterAccount.password],
  ['approverLogin', approverAccount.loginName],
  ['approverPassword', approverAccount.password],
  ['bridgeId', credential.bridgeId],
  ['bridgeCredential', credential.credential],
] as const) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`M2_R2_UNKNOWN_INPUT_INVALID field=${field}`);
  }
}
if (credential.serverUrl !== baseUrl) {
  throw new Error('M2_R2_UNKNOWN_SERVER_TARGET_INVALID');
}

const [requester, approver] = await Promise.all([
  createLocalSession({
    baseUrl,
    loginName: requesterAccount.loginName as string,
    password: requesterAccount.password as string,
  }),
  createLocalSession({
    baseUrl,
    loginName: approverAccount.loginName as string,
    password: approverAccount.password as string,
  }),
]);
const runKey = String(accounts.runId);
const created = await platformRequest({
  baseUrl,
  path: `/api/v1/requirements/${encodeURIComponent(String(accounts.requirementId))}/agent-runs`,
  session: requester,
  method: 'POST',
  idempotencyKey: `CODEx_TEST_M2_R2_${runKey}_UNKNOWN_FINAL_CREATE`,
  body: {
    baselineId: accounts.baselineId,
    workspaceId: accounts.workspaceId,
    skillKey: M2_R2_SKILL_KEY,
    skillVersion: M2_R2_SKILL_VERSION,
    operation: 'CONTROLLED_ARTIFACT_EDIT',
    accessMode: 'WORKSPACE_WRITE',
    writeScope: {
      allowedRelativePaths: [
        'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01/evaluation.md',
      ],
      allowedActions: ['EDIT_FILES'],
      maxChangedFiles: 1,
      maxChangedBytes: 65_536,
    },
  },
});
const run = asRecord(created.body.run);
if (typeof run.id !== 'string' || run.status !== 'WAITING_APPROVAL') {
  throw new Error('M2_R2_UNKNOWN_RUN_CREATE_INVALID');
}

const approvals = await platformRequest({
  baseUrl,
  path: '/api/v1/agent-approvals?limit=100',
  session: approver,
});
const approval = Array.isArray(approvals.body.items)
  ? approvals.body.items
      .map(asRecord)
      .find((item) => item.runId === run.id && item.decision === 'PENDING')
  : undefined;
if (
  !approval ||
  typeof approval.id !== 'string' ||
  typeof approval.rowVersion !== 'number'
) {
  throw new Error('M2_R2_UNKNOWN_APPROVAL_INVALID');
}
await platformRequest({
  baseUrl,
  path: `/api/v1/agent-approvals/${encodeURIComponent(approval.id)}/decision`,
  session: approver,
  method: 'POST',
  idempotencyKey: `CODEx_TEST_M2_R2_${runKey}_UNKNOWN_FINAL_APPROVE`,
  ifMatch: approval.rowVersion,
  body: {
    decision: 'APPROVED',
    reasonCode: 'R2_UNKNOWN_SCOPE_REVIEWED',
    approvedScope: approval.requestedScope,
  },
});

const gateway = new HttpBridgeGateway({
  baseUrl,
  bridgeId: credential.bridgeId as string,
  credential: credential.credential as string,
});
const command = parseBridgeCommand(
  await gateway.claimNext({
    bridgeId: credential.bridgeId as string,
    leaseSeconds: 30,
  }),
);
if (
  command.runId !== run.id ||
  command.commandType !== 'START_WORKSPACE_WRITE_RUN'
) {
  throw new Error('M2_R2_UNKNOWN_COMMAND_MISMATCH');
}
const occurredAt = new Date().toISOString();
const threadId = `CODEx_TEST_M2_R2_${runKey}_UNKNOWN_THREAD`;
const turnId = `CODEx_TEST_M2_R2_${runKey}_UNKNOWN_TURN`;
await gateway.submitEvent({
  bridgeId: credential.bridgeId as string,
  commandId: command.commandId,
  runId: command.runId,
  sourceEventId: `${command.commandId}-unknown-started`,
  expectedSequence: command.afterSequence + 1,
  event: {
    eventType: 'TURN_STARTED',
    summary: { threadId, turnId },
  },
  occurredAt,
});
await gateway.acknowledge({
  bridgeId: credential.bridgeId as string,
  commandId: command.commandId,
  runId: command.runId,
  status: 'UNKNOWN',
  reasonCode: 'CONTROLLED_ACCEPTANCE_RESULT_UNKNOWN',
  threadId,
  turnId,
  acknowledgedAt: new Date().toISOString(),
});
const readback = (
  await platformRequest({
    baseUrl,
    path: `/api/v1/agent-runs/${encodeURIComponent(run.id)}`,
    session: requester,
  })
).body;
if (
  readback.status !== 'UNKNOWN' ||
  readback.resultOutcome !== 'UNKNOWN' ||
  readback.failureReason !== 'CONTROLLED_ACCEPTANCE_RESULT_UNKNOWN'
) {
  throw new Error('M2_R2_UNKNOWN_FINAL_READBACK_INVALID');
}
const result = {
  status: 'PASS',
  runId: readback.id,
  runStatus: readback.status,
  resultOutcome: readback.resultOutcome,
  reasonCode: readback.failureReason,
  hasThreadId: Boolean(asRecord(readback.externalIds).threadId),
  hasTurnId: Boolean(asRecord(readback.externalIds).turnId),
  source: 'BRIDGE_PROTOCOL_CONTROLLED_UNKNOWN',
  retained: true,
} as const;
await writeNewPrivateJson(paths.unknownFinalResultFile, result);
console.log(JSON.stringify(result));
