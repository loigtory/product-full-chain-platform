import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  M2_R2_SKILL_KEY,
  M2_R2_SKILL_VERSION,
} from './m2-r2-skill-manifest.ts';
import {
  asRecord,
  createLocalSession,
  platformRequest,
  type LocalSession,
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
const unknownSeed = asRecord(
  JSON.parse(await readFile(paths.unknownFinalResultFile, 'utf8')),
);
for (const [label, value] of [
  ['requirementId', accounts.requirementId],
  ['baselineId', accounts.baselineId],
  ['workspaceId', accounts.workspaceId],
  ['runId', accounts.runId],
  ['requester.loginName', requesterAccount.loginName],
  ['requester.password', requesterAccount.password],
  ['approver.loginName', approverAccount.loginName],
  ['approver.password', approverAccount.password],
] as const) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`M2_R2_ACCEPTANCE_INPUT_INVALID field=${label}`);
  }
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
if (requester.actorId === approver.actorId) {
  throw new Error('M2_R2_FOUR_EYES_ACTORS_NOT_DISTINCT');
}

const requirementId = accounts.requirementId as string;
const baselineId = accounts.baselineId as string;
const workspaceId = accounts.workspaceId as string;
const runId = accounts.runId as string;
const artifactSourceRef =
  'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01/evaluation.md';
const terminalStatuses = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
]);

async function waitForLaunchContext() {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const response = await platformRequest({
      baseUrl,
      path: `/api/v1/requirements/${encodeURIComponent(requirementId)}/agent-run-options`,
      session: requester,
    }).catch(() => null);
    if (response) {
      const workspaces = response.body.workspaces;
      const skills = response.body.skills;
      if (
        Array.isArray(workspaces) &&
        workspaces.some((item) => asRecord(item).id === workspaceId) &&
        Array.isArray(skills) &&
        skills.some((item) => asRecord(item).skillKey === M2_R2_SKILL_KEY)
      ) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('M2_R2_LAUNCH_CONTEXT_TIMEOUT');
}

async function createWriteRun(label: string) {
  const response = await platformRequest({
    baseUrl,
    path: `/api/v1/requirements/${encodeURIComponent(requirementId)}/agent-runs`,
    session: requester,
    method: 'POST',
    idempotencyKey: `CODEx_TEST_M2_R2_${runId}_${label}_CREATE`,
    body: {
      baselineId,
      workspaceId,
      skillKey: M2_R2_SKILL_KEY,
      skillVersion: M2_R2_SKILL_VERSION,
      operation: 'CONTROLLED_ARTIFACT_EDIT',
      accessMode: 'WORKSPACE_WRITE',
      writeScope: {
        allowedRelativePaths: [artifactSourceRef],
        allowedActions: ['EDIT_FILES'],
        maxChangedFiles: 1,
        maxChangedBytes: 65_536,
      },
    },
  });
  return asRecord(response.body.run);
}

async function approvalForRun(session: LocalSession, agentRunId: string) {
  const response = await platformRequest({
    baseUrl,
    path: '/api/v1/agent-approvals?limit=100',
    session,
  });
  const items = response.body.items;
  if (!Array.isArray(items)) throw new Error('M2_R2_APPROVAL_LIST_INVALID');
  const approval = items
    .map(asRecord)
    .find((item) => item.runId === agentRunId && item.decision === 'PENDING');
  if (!approval) throw new Error('M2_R2_APPROVAL_NOT_FOUND');
  return approval;
}

async function decideApproval(input: {
  session: LocalSession;
  approval: Record<string, unknown>;
  decision: 'APPROVED' | 'REJECTED';
  key: string;
  expectedStatus?: number;
}) {
  if (
    typeof input.approval.id !== 'string' ||
    typeof input.approval.rowVersion !== 'number'
  ) {
    throw new Error('M2_R2_APPROVAL_SHAPE_INVALID');
  }
  return platformRequest({
    baseUrl,
    path: `/api/v1/agent-approvals/${encodeURIComponent(input.approval.id)}/decision`,
    session: input.session,
    method: 'POST',
    idempotencyKey: `CODEx_TEST_M2_R2_${runId}_${input.key}`,
    ifMatch: input.approval.rowVersion,
    expectedStatus: input.expectedStatus,
    body: {
      decision: input.decision,
      reasonCode:
        input.decision === 'APPROVED'
          ? 'R2_ACCEPTANCE_SCOPE_REVIEWED'
          : 'R2_ACCEPTANCE_REJECTED',
      ...(input.decision === 'APPROVED'
        ? { approvedScope: input.approval.requestedScope }
        : {}),
    },
  });
}

async function getRun(agentRunId: string) {
  return (
    await platformRequest({
      baseUrl,
      path: `/api/v1/agent-runs/${encodeURIComponent(agentRunId)}`,
      session: requester,
    })
  ).body;
}

async function waitForTerminalWithApprovals(agentRunId: string) {
  const approved = new Set<string>();
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const run = await getRun(agentRunId);
    if (terminalStatuses.has(String(run.status))) return { run, approved };
    const pending = await platformRequest({
      baseUrl,
      path: '/api/v1/agent-approvals?limit=100',
      session: approver,
    });
    const items = Array.isArray(pending.body.items)
      ? pending.body.items.map(asRecord)
      : [];
    for (const approval of items.filter(
      (item) => item.runId === agentRunId && item.decision === 'PENDING',
    )) {
      const approvalId = String(approval.id);
      if (approved.has(approvalId)) continue;
      await decideApproval({
        session: approver,
        approval,
        decision: 'APPROVED',
        key: `APPROVE_${approved.size}`,
      });
      approved.add(approvalId);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('M2_R2_AGENT_RUN_TIMEOUT');
}

await waitForLaunchContext();

if (typeof unknownSeed.runId !== 'string') {
  throw new Error('M2_R2_UNKNOWN_EVIDENCE_INVALID');
}
let unknownRun = await getRun(unknownSeed.runId);
if (unknownRun.status === 'UNKNOWN') {
  const verification = await platformRequest({
    baseUrl,
    path: `/api/v1/agent-runs/${encodeURIComponent(unknownSeed.runId)}/controls`,
    session: approver,
    method: 'POST',
    idempotencyKey: `CODEx_TEST_M2_R2_${runId}_VERIFY_UNKNOWN`,
    ifMatch: Number(unknownRun.rowVersion),
    body: {
      action: 'VERIFY_UNKNOWN',
      reasonCode: 'R2_ACCEPTANCE_VERIFY_UNKNOWN',
    },
  });
  unknownRun = asRecord(verification.body.run);
}
if (unknownRun.status === 'VERIFYING') {
  unknownRun = (await waitForTerminalWithApprovals(unknownSeed.runId)).run;
}
if (unknownRun.status !== 'UNKNOWN' || unknownRun.resultOutcome !== 'UNKNOWN') {
  throw new Error('M2_R2_UNKNOWN_VERIFICATION_INVALID');
}

const approvedRun = await createWriteRun('APPROVE_FINAL');
let selfApprovalEvidence: Readonly<Record<string, unknown>> = {
  status: 'PREVIOUSLY_VERIFIED',
  code: 'PERMISSION_DENIED',
};
if (approvedRun.status === 'WAITING_APPROVAL') {
  const approvedStart = await approvalForRun(approver, String(approvedRun.id));
  const selfApproval = await decideApproval({
    session: requester,
    approval: approvedStart,
    decision: 'APPROVED',
    key: 'SELF_APPROVE',
    expectedStatus: 403,
  });
  if (selfApproval.body.code !== 'PERMISSION_DENIED') {
    throw new Error('M2_R2_SELF_APPROVAL_NOT_DENIED');
  }
  selfApprovalEvidence = {
    status: selfApproval.status,
    code: selfApproval.body.code,
  };
  await decideApproval({
    session: approver,
    approval: approvedStart,
    decision: 'APPROVED',
    key: 'START_APPROVE',
  });
}
const approvedTerminal = await waitForTerminalWithApprovals(
  String(approvedRun.id),
);
if (approvedTerminal.run.status !== 'SUCCEEDED') {
  throw new Error(
    `M2_R2_APPROVED_RUN_NOT_SUCCEEDED status=${String(approvedTerminal.run.status)}`,
  );
}

const rejectedRun = await createWriteRun('REJECT');
if (rejectedRun.status === 'WAITING_APPROVAL') {
  const rejectedApproval = await approvalForRun(
    approver,
    String(rejectedRun.id),
  );
  await decideApproval({
    session: approver,
    approval: rejectedApproval,
    decision: 'REJECTED',
    key: 'START_REJECT',
  });
}
const rejectedReadback = await getRun(String(rejectedRun.id));
if (
  rejectedReadback.status !== 'CANCELLED' ||
  rejectedReadback.resultOutcome !== 'BLOCKED'
) {
  throw new Error('M2_R2_REJECT_READBACK_INVALID');
}

const cancelledRun = await createWriteRun('CANCEL');
const cancelledReadback =
  cancelledRun.status === 'WAITING_APPROVAL'
    ? asRecord(
        (
          await platformRequest({
            baseUrl,
            path: `/api/v1/agent-runs/${encodeURIComponent(String(cancelledRun.id))}/controls`,
            session: requester,
            method: 'POST',
            idempotencyKey: `CODEx_TEST_M2_R2_${runId}_CANCEL`,
            ifMatch: Number(cancelledRun.rowVersion),
            body: {
              action: 'CANCEL',
              reasonCode: 'R2_ACCEPTANCE_CANCELLED',
            },
          })
        ).body.run,
      )
    : await getRun(String(cancelledRun.id));
if (cancelledReadback.status !== 'CANCELLED') {
  throw new Error('M2_R2_CANCEL_READBACK_INVALID');
}

const result = {
  status: 'PASS',
  runId,
  actors: {
    distinct: true,
    requesterId: requester.actorId,
    approverId: approver.actorId,
  },
  selfApproval: selfApprovalEvidence,
  approved: {
    runId: approvedTerminal.run.id,
    status: approvedTerminal.run.status,
    resultOutcome: approvedTerminal.run.resultOutcome,
    approvalCount: approvedTerminal.approved.size + 1,
    hasThreadId: Boolean(asRecord(approvedTerminal.run.externalIds).threadId),
    hasTurnId: Boolean(asRecord(approvedTerminal.run.externalIds).turnId),
  },
  rejected: {
    runId: rejectedReadback.id,
    status: rejectedReadback.status,
    resultOutcome: rejectedReadback.resultOutcome,
  },
  cancelled: {
    runId: cancelledReadback.id,
    status: cancelledReadback.status,
  },
  unknown: {
    runId: unknownRun.id,
    status: unknownRun.status,
    resultOutcome: unknownRun.resultOutcome,
    reasonCode: unknownRun.failureReason,
    verificationAttempted: true,
  },
  dataSource: 'STANDARD_LOCAL_POSTGRESQL',
  credentials: 'stored-only',
  retained: true,
} as const;
await writeNewPrivateJson(paths.apiResultFile, result);
console.log(JSON.stringify(result));
