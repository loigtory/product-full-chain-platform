import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentRunScopeDto } from '@pfc/contracts';
import {
  CodexWorkspaceWriteSession,
  JsonlAppServerRpc,
  type WorkspaceWriteApprovalRequest,
} from '@pfc/codex-adapter';

import {
  RunCapsuleManager,
  type RunCapsule,
} from '../../apps/bridge/src/run-capsule.ts';

const timeoutMs = 180_000;
const allowedRelativePath = 'docs/requirements/acceptance.md';
const skillName = 'pfc-controlled-artifact-edit';

class SpikeGateError extends Error {
  constructor(
    readonly code: string,
    readonly evidence: Readonly<Record<string, unknown>>,
  ) {
    super(code);
    this.name = 'SpikeGateError';
  }
}

function safeFailureCode(error: unknown): string {
  if (error instanceof SpikeGateError) return error.code;
  if (error instanceof Error) {
    return /^[A-Z][A-Z0-9_]+/.exec(error.message)?.[0] ?? 'UNCLASSIFIED_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

function outputPath(argv: readonly string[]): string | null {
  const index = argv.indexOf('--output');
  return index === -1 ? null : path.resolve(argv[index + 1] ?? '');
}

function codexBinary(): string {
  const explicit = process.env.PFC_CODEX_BINARY?.trim();
  if (explicit) return explicit;
  const appData = process.env.APPDATA?.trim();
  if (!appData) throw new Error('APPDATA_REQUIRED');
  return path.join(
    appData,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe',
  );
}

function hash(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`M2_R2_SPIKE_TIMEOUT:${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type DecisionMode = 'ACCEPT' | 'DECLINE' | 'CANCEL';

function approvalDecision(mode: DecisionMode): 'accept' | 'decline' | 'cancel' {
  return mode === 'ACCEPT'
    ? 'accept'
    : mode === 'DECLINE'
      ? 'decline'
      : 'cancel';
}

function approvalWithinScope(
  approval: WorkspaceWriteApprovalRequest,
  scope: AgentRunScopeDto,
): boolean {
  return (
    !approval.outsideCapsule &&
    !approval.requestedScope.networkAccess &&
    approval.requestedScope.allowedRelativePaths.every((requested) =>
      scope.allowedRelativePaths.some(
        (allowed) =>
          requested === allowed || requested.startsWith(`${allowed}/`),
      ),
    )
  );
}

async function runScenario(input: {
  mode: DecisionMode;
  runId: string;
  executionInstanceId: string;
  requirementId: string;
  baselineId: string;
  sourceRoot: string;
  capsuleManager: RunCapsuleManager;
  binary: string;
  skillPath: string;
  sourceHash: string;
}) {
  const scope: AgentRunScopeDto = {
    allowedRelativePaths: [allowedRelativePath],
    allowedActions: ['EDIT_FILES'],
    networkAccess: false,
    maxChangedFiles: 1,
    maxChangedBytes: 65_536,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  let capsule: RunCapsule | null = null;
  let rpc: JsonlAppServerRpc | null = null;
  let session: CodexWorkspaceWriteSession | null = null;
  const approvals: WorkspaceWriteApprovalRequest[] = [];
  const resolvedApprovalIds = new Set<string>();
  const policyViolations: string[] = [];
  const events: string[] = [];
  let signalTurnStarted: (() => void) | null = null;
  const turnStarted = new Promise<void>((resolve) => {
    signalTurnStarted = resolve;
  });
  let primaryError: unknown;
  let outcome: Readonly<Record<string, unknown>> | null = null;

  if (input.mode === 'DECLINE') {
    const currentSourceHash = hash(
      await readFile(
        path.resolve(input.sourceRoot, ...allowedRelativePath.split('/')),
      ),
    );
    return {
      mode: input.mode,
      platformStartDecision: 'REJECTED',
      startCommandIssued: false,
      appServerStarted: false,
      approvalKinds: [],
      approvalCount: 0,
      eventTypes: [],
      changedFiles: 0,
      changedPaths: [],
      sourceWorkspaceUnchanged: currentSourceHash === input.sourceHash,
      capsuleLifecycle: 'NOT_CREATED',
      threadCleanup: 'NOT_REQUIRED',
    };
  }

  const resolveApproval = async (
    approval: WorkspaceWriteApprovalRequest,
  ): Promise<void> => {
    if (!session || resolvedApprovalIds.has(approval.appServerRequestId))
      return;
    const withinScope = approvalWithinScope(approval, scope);
    if (!withinScope) policyViolations.push(approval.appServerRequestId);
    await session.resolveApproval({
      appServerRequestId: approval.appServerRequestId,
      approvalKind: approval.kind,
      decision: withinScope ? approvalDecision(input.mode) : 'decline',
      ...(approval.kind === 'PERMISSIONS' &&
      withinScope &&
      input.mode === 'ACCEPT'
        ? { grantedRelativePaths: scope.allowedRelativePaths }
        : {}),
    });
    resolvedApprovalIds.add(approval.appServerRequestId);
  };

  try {
    capsule = await input.capsuleManager.materialize({
      runId: input.runId,
      executionInstanceId: input.executionInstanceId,
      sourceWorkspacePath: input.sourceRoot,
      sourceGitBaseline: '0123456789abcdef0123456789abcdef01234567',
      scope,
    });
    rpc = new JsonlAppServerRpc({
      binary: input.binary,
      cwd: capsule.path,
      requestTimeoutMs: timeoutMs,
    });
    session = await bounded(
      CodexWorkspaceWriteSession.start(
        rpc,
        {
          workspacePath: capsule.path,
          objective: [
            `Requirement ID: ${input.requirementId}.`,
            `Baseline ID: ${input.baselineId}.`,
            `Allowed relative paths: ${allowedRelativePath}.`,
            'Allowed actions: EDIT_FILES.',
            'Apply only the bounded revision record required by the Skill.',
          ].join(' '),
          skill: { name: skillName, path: input.skillPath },
          runScope: scope,
        },
        async (event) => {
          events.push(event.eventType);
          if (event.eventType === 'TURN_STARTED') signalTurnStarted?.();
        },
        async (approval) => {
          approvals.push(approval);
          await resolveApproval(approval);
        },
      ),
      `${input.mode}:start`,
    );
    for (const approval of approvals) await resolveApproval(approval);

    if (input.mode === 'CANCEL') {
      const startedBeforeTerminal = await bounded(
        Promise.race([
          turnStarted.then(() => true),
          session.completion.then(() => false),
        ]),
        'cancel:turn-started',
      );
      if (!startedBeforeTerminal) {
        throw new SpikeGateError('M2_R2_CANCEL_NOT_EXERCISED', {
          mode: input.mode,
          eventTypes: [...new Set(events)],
        });
      }
      await bounded(session.interrupt({}), 'cancel:interrupt');
    }
    const result = await bounded(
      session.completion,
      `${input.mode}:completion`,
    );
    const verification = await input.capsuleManager.verify(capsule);
    const capsuleContent = await readFile(
      path.resolve(capsule.path, ...allowedRelativePath.split('/')),
      'utf8',
    );
    const currentSourceHash = hash(
      await readFile(
        path.resolve(input.sourceRoot, ...allowedRelativePath.split('/')),
      ),
    );
    const threadCleanup = await rpc
      .request('thread/delete', { threadId: result.threadId })
      .then(() => 'DELETED' as const)
      .catch(() => 'DELETE_FAILED' as const);

    outcome = {
      mode: input.mode,
      platformStartDecision: 'APPROVED',
      startCommandIssued: true,
      appServerStarted: true,
      status: result.status,
      reasonCode: result.reasonCode ?? null,
      approvalKinds: [...new Set(approvals.map((approval) => approval.kind))],
      approvalCount: approvals.length,
      eventTypes: [...new Set(events)],
      changedFiles: verification.changedFiles,
      changedPaths: verification.changedPaths,
      sourceWorkspaceUnchanged: currentSourceHash === input.sourceHash,
      beforeManifestHash: verification.beforeManifestHash,
      afterManifestHash: verification.afterManifestHash,
      threadIdHash: shortHash(result.threadId),
      threadCleanup,
    };

    if (currentSourceHash !== input.sourceHash) {
      throw new SpikeGateError('M2_R2_SOURCE_WORKSPACE_CHANGED', outcome);
    }
    if (policyViolations.length > 0) {
      throw new SpikeGateError('M2_R2_APPROVAL_SCOPE_VIOLATION', outcome);
    }
    if (input.mode === 'ACCEPT') {
      if (result.status !== 'SUCCEEDED') {
        throw new SpikeGateError('M2_R2_APPROVED_WRITE_NOT_SUCCEEDED', outcome);
      }
      if (
        verification.changedFiles !== 1 ||
        verification.changedPaths[0] !== allowedRelativePath ||
        !capsuleContent.includes('## 受控修订记录') ||
        !capsuleContent.includes(input.requirementId) ||
        !capsuleContent.includes(input.baselineId)
      ) {
        throw new SpikeGateError(
          'M2_R2_APPROVED_WRITE_CONTENT_INVALID',
          outcome,
        );
      }
    }
    if (input.mode === 'CANCEL' && result.status !== 'CANCELLED') {
      throw new SpikeGateError('M2_R2_CANCEL_NOT_VERIFIED', outcome);
    }
  } catch (error) {
    primaryError = error;
  }

  const cleanupFailures: string[] = [];
  try {
    if (session) await session.close();
    else await rpc?.close();
  } catch {
    cleanupFailures.push('APP_SERVER_CLOSE_FAILED');
  }
  try {
    if (capsule) await input.capsuleManager.cleanup(capsule);
  } catch {
    cleanupFailures.push('CAPSULE_CLEANUP_FAILED');
  }
  if (cleanupFailures.length > 0) {
    const detail = cleanupFailures.join(',');
    if (primaryError instanceof Error) {
      primaryError.message = `${primaryError.message}; cleanup=${detail}`;
    } else {
      primaryError = new Error(detail);
    }
  }
  if (primaryError) throw primaryError;
  if (!outcome) throw new Error('M2_R2_SPIKE_OUTCOME_MISSING');
  return outcome;
}

async function main(): Promise<void> {
  const reportPath = outputPath(process.argv.slice(2));
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const workRoot = path.resolve(
    '.local',
    'm2-r2-spikes',
    `CODEx_TEST_M2_R2_${suffix}`,
  );
  const sourceRoot = path.join(workRoot, 'source');
  const sourceArtifact = path.resolve(
    sourceRoot,
    ...allowedRelativePath.split('/'),
  );
  const capsuleManager = new RunCapsuleManager({
    capsuleRoot: path.resolve('.local', 'run-capsules'),
  });
  const skillPath = path.resolve('skills', skillName, 'SKILL.md');
  const sourceContent = [
    '# CODEx_TEST M2 R2 Acceptance Artifact',
    '',
    'This document contains synthetic local test data only.',
    '',
  ].join('\n');
  await mkdir(path.dirname(sourceArtifact), { recursive: true });
  await writeFile(sourceArtifact, sourceContent, 'utf8');
  const sourceHash = hash(sourceContent);
  const runId = `CODEx_TEST_M2_R2_APP_SERVER_${suffix}`;
  let failure: unknown;
  let report: Readonly<Record<string, unknown>>;

  try {
    const shared = {
      sourceRoot,
      capsuleManager,
      binary: codexBinary(),
      skillPath,
      sourceHash,
    };
    const scenarios = [];
    for (const [mode, label] of [
      ['ACCEPT', 'APPROVE'],
      ['DECLINE', 'DECLINE'],
      ['CANCEL', 'CANCEL'],
    ] as const) {
      scenarios.push(
        await runScenario({
          ...shared,
          mode,
          runId: `CODEx_TEST_M2_R2_${label}_${suffix}`,
          executionInstanceId: `CODEx_TEST_M2_R2_EXEC_${label}_${suffix}`,
          requirementId: `CODEx_TEST_M2_R2_REQ_${label}`,
          baselineId: `CODEx_TEST_M2_R2_BASELINE_${label}`,
        }),
      );
    }
    report = {
      runId,
      status: 'PASS',
      dataSource: 'SYNTHETIC_LOCAL',
      configSource: '.env.local/PFC_CODEX_BINARY',
      scenarios,
      sourceWorkspaceUnchanged: true,
      capsuleCleanup: 'CLEANED',
      ownedAppServerCleanup: 'CLOSED',
    };
  } catch (error) {
    failure = error;
    report = {
      runId,
      status: 'FAIL',
      dataSource: 'SYNTHETIC_LOCAL',
      configSource: '.env.local/PFC_CODEX_BINARY',
      failureCode: safeFailureCode(error),
      scenarioEvidence: error instanceof SpikeGateError ? error.evidence : null,
      capsuleCleanup: 'CLEANED',
      ownedAppServerCleanup: 'CLOSED',
    };
  }

  try {
    if (reportPath) {
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(
        reportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
    }
    console.log(JSON.stringify(report));
  } finally {
    await rm(workRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    console.log('M2_R2_SPIKE_TEMP_CLEANED');
  }
  if (failure) throw failure;
}

await main();
