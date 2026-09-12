import path from 'node:path';

import {
  parseBridgeCommand,
  type BridgeCommand,
} from '../../../packages/protocol/src/index.ts';
import type { WorkspaceWriteApprovalRequest } from '../../../packages/codex-adapter/src/index.ts';

import type {
  AgentRunnerPort,
  ArtifactInspectorPort,
  BridgeAgentEvent,
  BridgeGatewayPort,
  BridgeLocalRegistryPort,
  WorkspaceInspectorPort,
} from './ports.ts';
import type { RunCapsuleManager } from './run-capsule.ts';
import type {
  BridgeManagedSession,
  BridgeSessionPool,
} from './session-pool.ts';

type StartReadonlyBridgeCommand = Extract<
  BridgeCommand,
  { commandType: 'START_READ_ONLY_RUN' }
>;

function readonlyObjective(
  command: StartReadonlyBridgeCommand,
  allowedRelativePath: string,
  scopedArtifactRef: string,
): string {
  return [
    'Perform the registered artifact structure and evidence check in read-only mode.',
    `Requirement ID: ${command.payload.requirementId}.`,
    `Current baseline ID: ${command.payload.baselineId}.`,
    `Bound artifact version ID: ${command.payload.artifactVersionId}.`,
    `Bound artifact path within the scope: ${scopedArtifactRef}.`,
    `Bound artifact SHA-256: ${command.payload.artifactContentHash}.`,
    `Authorized relative scope: ${allowedRelativePath}.`,
    `Fixed Git baseline: ${command.payload.gitBaseline}.`,
    'Treat the platform-provided requirement, baseline, artifact version, path, hash, and Git baseline as the authoritative machine-readable binding for this check.',
    'Treat the working directory as the scope root. Do not traverse to parent directories or use absolute paths.',
    'Do not modify files or invoke external systems.',
    'The first non-whitespace line of the final report must be exactly status: PASS, status: WARN, or status: BLOCKED.',
  ].join(' ');
}

function workspaceWriteObjective(
  command: Extract<BridgeCommand, { commandType: 'START_WORKSPACE_WRITE_RUN' }>,
): string {
  return [
    'Perform the approved controlled artifact edit in the isolated run capsule.',
    `Requirement ID: ${command.payload.requirementId}.`,
    `Current baseline ID: ${command.payload.baselineId}.`,
    `Bound artifact path: ${command.payload.artifactSourceRef}.`,
    `Fixed Git baseline: ${command.payload.gitBaseline}.`,
    `Allowed relative paths: ${command.payload.runScope.allowedRelativePaths.join(', ')}.`,
    `Allowed action kinds: ${command.payload.runScope.allowedActions.join(', ')}.`,
    `Maximum changed files: ${command.payload.runScope.maxChangedFiles}.`,
    `Maximum changed bytes: ${command.payload.runScope.maxChangedBytes}.`,
    'Do not access the network, parent directories, absolute paths, or the registered source workspace.',
    'The first non-whitespace line of the final report must be exactly status: PASS, status: WARN, or status: BLOCKED.',
  ].join(' ');
}

function scopedWorkspacePath(
  workspacePath: string,
  allowedRelativePath: string,
): string {
  const pathApi = /^[A-Za-z]:[\\/]/.test(workspacePath)
    ? path.win32
    : path.posix;
  const scopedPath = pathApi.resolve(workspacePath, allowedRelativePath);
  const relative = pathApi.relative(workspacePath, scopedPath);
  if (
    relative === '..' ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative)
  ) {
    throw new CommandRejected('WORKSPACE_SCOPE_INVALID');
  }
  return scopedPath;
}

function resolveScopedArtifact(
  workspacePath: string,
  allowedRelativePath: string,
  artifactSourceRef: string,
): { artifactPath: string; scopePath: string; scopedArtifactRef: string } {
  const pathApi = /^[A-Za-z]:[\\/]/.test(workspacePath)
    ? path.win32
    : path.posix;
  const scopePath = scopedWorkspacePath(workspacePath, allowedRelativePath);
  const artifactPath = pathApi.resolve(workspacePath, artifactSourceRef);
  const relative = pathApi.relative(scopePath, artifactPath);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative)
  ) {
    throw new CommandRejected('ARTIFACT_PATH_OUTSIDE_SCOPE');
  }
  return {
    artifactPath,
    scopePath,
    scopedArtifactRef: relative.split(pathApi.sep).join('/'),
  };
}

type BridgeWorkerOptions = Readonly<{
  bridgeId: string;
  gateway: BridgeGatewayPort;
  registry: BridgeLocalRegistryPort;
  workspaceInspector: WorkspaceInspectorPort;
  artifactInspector: ArtifactInspectorPort;
  runnerFactory: () => AgentRunnerPort;
  capsuleManager?: Pick<
    RunCapsuleManager,
    'materialize' | 'verify' | 'cleanup'
  >;
  sessionPool?: BridgeSessionPool;
  workspaceWriteSessionFactory?: (
    input: {
      workspacePath: string;
      objective: string;
      skill: { name: string; path: string };
      runScope: Extract<
        BridgeCommand,
        { commandType: 'START_WORKSPACE_WRITE_RUN' }
      >['payload']['runScope'];
    },
    onEvent: (event: BridgeAgentEvent) => void | Promise<void>,
    onApproval: (
      approval: WorkspaceWriteApprovalRequest,
    ) => void | Promise<void>,
  ) => Promise<BridgeManagedSession>;
  now?: () => string;
  leaseSeconds?: number;
  idFactory?: (prefix: string) => string;
}>;

class CommandRejected extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
  }
}

function executionFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/^BRIDGE_GATEWAY_HTTP_\d{3}$/.test(message)) return message;
  if (
    [
      'APP_SERVER_REQUEST_FAILED',
      'APP_SERVER_EVENT_DELIVERY_FAILED',
      'BRIDGE_EVENT_SEQUENCE_GAP',
    ].includes(message)
  ) {
    return message;
  }
  if (message === 'APP_SERVER_EVENT_BACKPRESSURE') {
    return 'APP_SERVER_EVENT_BACKPRESSURE';
  }
  if (message.startsWith('APP_SERVER_REQUEST_TIMEOUT:')) {
    return 'APP_SERVER_REQUEST_TIMEOUT';
  }
  if (message.startsWith('APP_SERVER_EXITED ')) return 'APP_SERVER_EXITED';
  return 'EXECUTION_RESULT_UNKNOWN';
}

export class BridgeWorker {
  private readonly now: () => string;
  private readonly leaseSeconds: number;
  private readonly completionTasks = new Set<Promise<void>>();

  constructor(private readonly options: BridgeWorkerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.leaseSeconds = Math.min(Math.max(options.leaseSeconds ?? 30, 5), 120);
  }

  private async reject(
    command: BridgeCommand,
    reasonCode: string,
  ): Promise<void> {
    await this.options.gateway.acknowledge({
      bridgeId: this.options.bridgeId,
      commandId: command.commandId,
      runId: command.runId,
      status: 'REJECTED',
      reasonCode,
      acknowledgedAt: this.now(),
    });
  }

  private async resolveExecution(command: BridgeCommand): Promise<{
    workspacePath: string;
    allowedRelativePath: string;
    scopedArtifactRef: string;
    skill: { name: string; path: string };
  }> {
    if (command.commandType !== 'START_READ_ONLY_RUN') {
      throw new CommandRejected('COMMAND_NOT_SUPPORTED_BY_R1_WORKER');
    }
    if (Date.parse(command.leaseUntil) <= Date.parse(this.now())) {
      throw new CommandRejected('COMMAND_LEASE_EXPIRED');
    }
    const workspace = await this.options.registry.resolveWorkspace(
      command.payload.workspaceId,
    );
    if (!workspace?.verified) {
      throw new CommandRejected('WORKSPACE_NOT_VERIFIED');
    }
    const currentGitBaseline =
      await this.options.workspaceInspector.currentGitBaseline(workspace.path);
    if (
      currentGitBaseline.toLowerCase() !==
      command.payload.gitBaseline.toLowerCase()
    ) {
      throw new CommandRejected('WORKSPACE_BASELINE_DRIFT');
    }
    const skill = await this.options.registry.resolveSkill(
      command.payload.skillReleaseId,
    );
    if (!skill?.enabled) throw new CommandRejected('SKILL_NOT_ENABLED');
    if (
      skill.contentHash.toLowerCase() !==
      command.payload.skillContentHash.toLowerCase()
    ) {
      throw new CommandRejected('SKILL_CONTENT_DRIFT');
    }
    const artifact = resolveScopedArtifact(
      workspace.path,
      workspace.allowedRelativePath,
      command.payload.artifactSourceRef,
    );
    const artifactInspection =
      await this.options.artifactInspector.inspectWithinScope({
        workspacePath: workspace.path,
        scopePath: artifact.scopePath,
        artifactPath: artifact.artifactPath,
      });
    if (artifactInspection.status === 'OUTSIDE_SCOPE') {
      throw new CommandRejected('ARTIFACT_PATH_OUTSIDE_SCOPE');
    }
    if (artifactInspection.status === 'UNREADABLE') {
      throw new CommandRejected('ARTIFACT_NOT_READABLE');
    }
    if (
      artifactInspection.contentHash.toLowerCase() !==
      command.payload.artifactContentHash.toLowerCase()
    ) {
      throw new CommandRejected('ARTIFACT_CONTENT_DRIFT');
    }
    return {
      workspacePath: scopedWorkspacePath(
        workspace.path,
        workspace.allowedRelativePath,
      ),
      allowedRelativePath: workspace.allowedRelativePath,
      scopedArtifactRef: artifact.scopedArtifactRef,
      skill: { name: skill.name, path: skill.path },
    };
  }

  private async resolveWriteExecution(
    command: Extract<
      BridgeCommand,
      { commandType: 'START_WORKSPACE_WRITE_RUN' }
    >,
  ): Promise<{
    sourceWorkspacePath: string;
    skill: { name: string; path: string };
  }> {
    if (Date.parse(command.leaseUntil) <= Date.parse(this.now())) {
      throw new CommandRejected('COMMAND_LEASE_EXPIRED');
    }
    if (
      Date.parse(command.payload.runScope.expiresAt) <= Date.parse(this.now())
    ) {
      throw new CommandRejected('RUN_SCOPE_EXPIRED');
    }
    const workspace = await this.options.registry.resolveWorkspace(
      command.payload.workspaceId,
    );
    if (!workspace?.verified) {
      throw new CommandRejected('WORKSPACE_NOT_VERIFIED');
    }
    const currentGitBaseline =
      await this.options.workspaceInspector.currentGitBaseline(workspace.path);
    if (
      currentGitBaseline.toLowerCase() !==
      command.payload.gitBaseline.toLowerCase()
    ) {
      throw new CommandRejected('WORKSPACE_BASELINE_DRIFT');
    }
    const scopePrefix = workspace.allowedRelativePath
      .replaceAll('\\', '/')
      .replace(/\/$/, '');
    if (
      command.payload.runScope.allowedRelativePaths.some(
        (allowedPath) =>
          allowedPath !== scopePrefix &&
          !allowedPath.startsWith(`${scopePrefix}/`),
      )
    ) {
      throw new CommandRejected('RUN_SCOPE_OUTSIDE_WORKSPACE_BINDING');
    }
    const skill = await this.options.registry.resolveSkill(
      command.payload.skillReleaseId,
    );
    if (!skill?.enabled) throw new CommandRejected('SKILL_NOT_ENABLED');
    if (
      skill.contentHash.toLowerCase() !==
      command.payload.skillContentHash.toLowerCase()
    ) {
      throw new CommandRejected('SKILL_CONTENT_DRIFT');
    }
    const artifact = resolveScopedArtifact(
      workspace.path,
      workspace.allowedRelativePath,
      command.payload.artifactSourceRef,
    );
    const artifactInspection =
      await this.options.artifactInspector.inspectWithinScope({
        workspacePath: workspace.path,
        scopePath: artifact.scopePath,
        artifactPath: artifact.artifactPath,
      });
    if (artifactInspection.status !== 'VERIFIED') {
      throw new CommandRejected(
        artifactInspection.status === 'OUTSIDE_SCOPE'
          ? 'ARTIFACT_PATH_OUTSIDE_SCOPE'
          : 'ARTIFACT_NOT_READABLE',
      );
    }
    if (
      artifactInspection.contentHash.toLowerCase() !==
      command.payload.artifactContentHash.toLowerCase()
    ) {
      throw new CommandRejected('ARTIFACT_CONTENT_DRIFT');
    }
    return {
      sourceWorkspacePath: workspace.path,
      skill: { name: skill.name, path: skill.path },
    };
  }

  private submitter(
    command: BridgeCommand,
    cursor: { nextSequence: number },
  ): (event: BridgeAgentEvent) => Promise<void> {
    let delivery = Promise.resolve();
    return (event) => {
      const expectedSequence = cursor.nextSequence++;
      const sourceEventId = `${command.commandId}-event-${expectedSequence}`;
      const task = delivery.then(async () => {
        const result = await this.options.gateway.submitEvent({
          bridgeId: this.options.bridgeId,
          commandId: command.commandId,
          runId: command.runId,
          sourceEventId,
          expectedSequence,
          event,
          occurredAt: this.now(),
        });
        if (result.status === 'SEQUENCE_GAP') {
          throw new Error('BRIDGE_EVENT_SEQUENCE_GAP');
        }
      });
      delivery = task.catch(() => undefined);
      return task;
    };
  }

  private trackCompletion(task: Promise<void>): void {
    this.completionTasks.add(task);
    void task.finally(() => this.completionTasks.delete(task));
  }

  private async startWorkspaceWrite(
    command: Extract<
      BridgeCommand,
      { commandType: 'START_WORKSPACE_WRITE_RUN' }
    >,
  ): Promise<void> {
    const capsuleManager = this.options.capsuleManager;
    const sessionPool = this.options.sessionPool;
    const sessionFactory = this.options.workspaceWriteSessionFactory;
    if (!capsuleManager || !sessionPool || !sessionFactory) {
      throw new CommandRejected('WORKSPACE_WRITE_RUNTIME_UNAVAILABLE');
    }
    const execution = await this.resolveWriteExecution(command);
    const capsule = await capsuleManager.materialize({
      runId: command.runId,
      executionInstanceId: command.payload.executionInstanceId,
      sourceWorkspacePath: execution.sourceWorkspacePath,
      sourceGitBaseline: command.payload.gitBaseline,
      scope: command.payload.runScope,
    });
    if (capsule.scopeHash !== command.payload.runScopeHash.toLowerCase()) {
      await capsuleManager.cleanup(capsule);
      throw new CommandRejected('RUN_SCOPE_HASH_MISMATCH');
    }
    await this.options.gateway.reportCapsule({
      bridgeId: this.options.bridgeId,
      runId: command.runId,
      executionInstanceId: command.payload.executionInstanceId,
      sourceGitBaseline: capsule.sourceGitBaseline,
      scopeHash: capsule.scopeHash,
      beforeManifestHash: capsule.beforeManifestHash,
      afterManifestHash: null,
      lifecycle: 'MATERIALIZED',
      diffSummary: null,
      occurredAt: this.now(),
    });
    const cursor = { nextSequence: command.afterSequence + 1 };
    let rawSession: BridgeManagedSession | null = null;
    try {
      const session = await sessionPool.start({
        runId: command.runId,
        executionInstanceId: command.payload.executionInstanceId,
        create: async () => {
          rawSession = await sessionFactory(
            {
              workspacePath: capsule.path,
              objective: workspaceWriteObjective(command),
              skill: execution.skill,
              runScope: command.payload.runScope,
            },
            this.submitter(command, cursor),
            async (approval) => {
              const result = await this.options.gateway.submitApproval({
                bridgeId: this.options.bridgeId,
                commandId: command.commandId,
                runId: command.runId,
                executionInstanceId: command.payload.executionInstanceId,
                ...approval,
                requestedAt: this.now(),
              });
              cursor.nextSequence = Math.max(
                cursor.nextSequence,
                result.afterSequence + 1,
              );
            },
          );
          const ownedSession = rawSession;
          return {
            completion: ownedSession.completion,
            advanceEventCursor: (afterSequence: number) => {
              cursor.nextSequence = Math.max(
                cursor.nextSequence,
                afterSequence + 1,
              );
              ownedSession.advanceEventCursor(afterSequence);
            },
            resolveApproval: (input) => ownedSession.resolveApproval(input),
            interrupt: (input) => ownedSession.interrupt(input),
            verify: () => ownedSession.verify(),
            close: () => ownedSession.close(),
          };
        },
      });
      const completion = session.completion
        .then(async (result) => {
          const verified = await capsuleManager.verify(capsule);
          await this.options.gateway.reportCapsule({
            bridgeId: this.options.bridgeId,
            runId: command.runId,
            executionInstanceId: command.payload.executionInstanceId,
            sourceGitBaseline: capsule.sourceGitBaseline,
            scopeHash: capsule.scopeHash,
            beforeManifestHash: verified.beforeManifestHash,
            afterManifestHash: verified.afterManifestHash,
            lifecycle: 'VERIFIED',
            diffSummary: {
              changedFiles: verified.changedFiles,
              changedBytes: verified.changedBytes,
              changedPaths: verified.changedPaths,
            },
            occurredAt: this.now(),
          });
          await this.options.gateway.acknowledge({
            bridgeId: this.options.bridgeId,
            commandId: command.commandId,
            runId: command.runId,
            status: result.status,
            reasonCode: result.reasonCode,
            threadId: result.threadId,
            turnId: result.turnId,
            acknowledgedAt: this.now(),
          });
        })
        .catch(async (error: unknown) => {
          await this.options.gateway
            .reportCapsule({
              bridgeId: this.options.bridgeId,
              runId: command.runId,
              executionInstanceId: command.payload.executionInstanceId,
              sourceGitBaseline: capsule.sourceGitBaseline,
              scopeHash: capsule.scopeHash,
              beforeManifestHash: capsule.beforeManifestHash,
              afterManifestHash: null,
              lifecycle: 'UNKNOWN',
              diffSummary: null,
              occurredAt: this.now(),
            })
            .catch(() => undefined);
          await this.options.gateway.acknowledge({
            bridgeId: this.options.bridgeId,
            commandId: command.commandId,
            runId: command.runId,
            status: 'UNKNOWN',
            reasonCode: executionFailureReason(error),
            acknowledgedAt: this.now(),
          });
        });
      this.trackCompletion(completion);
    } catch (error) {
      await capsuleManager.cleanup(capsule);
      throw error;
    }
  }

  private async handleControlCommand(
    command: Exclude<
      BridgeCommand,
      { commandType: 'START_READ_ONLY_RUN' | 'START_WORKSPACE_WRITE_RUN' }
    >,
  ): Promise<void> {
    const sessionPool = this.options.sessionPool;
    if (!sessionPool) throw new CommandRejected('SESSION_CONTROL_UNAVAILABLE');
    if (command.commandType === 'RESOLVE_APPROVAL') {
      await sessionPool.resolveApproval({
        runId: command.runId,
        executionInstanceId: command.payload.executionInstanceId,
        appServerRequestId: command.payload.appServerRequestId,
        approvalKind: command.payload.approvalKind,
        decision: command.payload.decision,
        grantedRelativePaths:
          command.payload.grantedScope?.allowedRelativePaths,
        afterSequence: command.afterSequence,
      });
      await this.options.gateway.acknowledge({
        bridgeId: this.options.bridgeId,
        commandId: command.commandId,
        runId: command.runId,
        status: 'SUCCEEDED',
        reasonCode: 'APPROVAL_RESPONSE_DELIVERED',
        acknowledgedAt: this.now(),
      });
      return;
    }
    if (command.commandType === 'INTERRUPT_RUN') {
      await sessionPool.interrupt({
        runId: command.runId,
        executionInstanceId: command.payload.executionInstanceId,
        ...(command.payload.threadId
          ? { threadId: command.payload.threadId }
          : {}),
        ...(command.payload.turnId ? { turnId: command.payload.turnId } : {}),
      });
      await this.options.gateway.acknowledge({
        bridgeId: this.options.bridgeId,
        commandId: command.commandId,
        runId: command.runId,
        status: 'SUCCEEDED',
        reasonCode: 'INTERRUPT_DISPATCHED',
        acknowledgedAt: this.now(),
      });
      return;
    }
    let state;
    try {
      state = await sessionPool.verify({
        runId: command.runId,
        executionInstanceId: command.payload.executionInstanceId,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'BRIDGE_SESSION_NOT_FOUND'
      ) {
        await this.options.gateway.acknowledge({
          bridgeId: this.options.bridgeId,
          commandId: command.commandId,
          runId: command.runId,
          status: 'UNKNOWN',
          reasonCode: 'RUN_STATE_UNAVAILABLE',
          acknowledgedAt: this.now(),
        });
        return;
      }
      throw error;
    }
    await this.options.gateway.acknowledge({
      bridgeId: this.options.bridgeId,
      commandId: command.commandId,
      runId: command.runId,
      status: state.status === 'RUNNING' ? 'UNKNOWN' : state.status,
      reasonCode:
        state.status === 'RUNNING' ? 'RUN_STILL_ACTIVE' : 'RUN_STATE_VERIFIED',
      threadId: state.threadId,
      turnId: state.turnId,
      acknowledgedAt: this.now(),
    });
  }

  async drain(): Promise<void> {
    await Promise.all([...this.completionTasks]);
  }

  async runOnce(): Promise<'IDLE' | 'HANDLED'> {
    const raw = await this.options.gateway.claimNext({
      bridgeId: this.options.bridgeId,
      leaseSeconds: this.leaseSeconds,
    });
    if (!raw) return 'IDLE';
    const command = parseBridgeCommand(raw);
    if (command.commandType === 'START_WORKSPACE_WRITE_RUN') {
      try {
        await this.startWorkspaceWrite(command);
      } catch (error) {
        await this.reject(
          command,
          error instanceof CommandRejected
            ? error.reasonCode
            : executionFailureReason(error),
        );
      }
      return 'HANDLED';
    }
    if (command.commandType !== 'START_READ_ONLY_RUN') {
      try {
        await this.handleControlCommand(command);
      } catch (error) {
        await this.reject(
          command,
          error instanceof CommandRejected
            ? error.reasonCode
            : error instanceof Error
              ? error.message
              : 'SESSION_CONTROL_FAILED',
        );
      }
      return 'HANDLED';
    }
    let execution: Awaited<ReturnType<BridgeWorker['resolveExecution']>>;
    try {
      execution = await this.resolveExecution(command);
    } catch (error) {
      if (error instanceof CommandRejected) {
        await this.reject(command, error.reasonCode);
        return 'HANDLED';
      }
      throw error;
    }

    const runner = this.options.runnerFactory();
    let nextSequence = command.afterSequence + 1;
    let executionStarted = false;
    let observedThreadId: string | undefined;
    let observedTurnId: string | undefined;
    let delivery = Promise.resolve();
    const submit = (event: BridgeAgentEvent): Promise<void> => {
      if (event.eventType === 'TURN_STARTED') {
        observedThreadId =
          typeof event.summary.threadId === 'string'
            ? event.summary.threadId
            : observedThreadId;
        observedTurnId =
          typeof event.summary.turnId === 'string'
            ? event.summary.turnId
            : observedTurnId;
      }
      const expectedSequence = nextSequence++;
      const sourceEventId = `${command.commandId}-event-${expectedSequence}`;
      const task = delivery.then(async () => {
        const result = await this.options.gateway.submitEvent({
          bridgeId: this.options.bridgeId,
          commandId: command.commandId,
          runId: command.runId,
          sourceEventId,
          expectedSequence,
          event,
          occurredAt: this.now(),
        });
        if (result.status === 'SEQUENCE_GAP') {
          throw new Error('BRIDGE_EVENT_SEQUENCE_GAP');
        }
      });
      delivery = task.catch(() => undefined);
      return task;
    };

    try {
      executionStarted = true;
      const result = await runner.runReadonly(
        {
          workspacePath: execution.workspacePath,
          objective: readonlyObjective(
            command,
            execution.allowedRelativePath,
            execution.scopedArtifactRef,
          ),
          skill: execution.skill,
        },
        submit,
      );
      await delivery;
      await this.options.gateway.acknowledge({
        bridgeId: this.options.bridgeId,
        commandId: command.commandId,
        runId: command.runId,
        status: result.status,
        reasonCode:
          result.reasonCode ??
          (result.status === 'UNKNOWN'
            ? 'EXECUTION_RESULT_UNKNOWN'
            : undefined),
        threadId: result.threadId,
        turnId: result.turnId,
        acknowledgedAt: this.now(),
      });
    } catch (error) {
      await this.options.gateway.acknowledge({
        bridgeId: this.options.bridgeId,
        commandId: command.commandId,
        runId: command.runId,
        status: executionStarted ? 'UNKNOWN' : 'FAILED',
        reasonCode: executionStarted
          ? executionFailureReason(error)
          : 'EXECUTION_NOT_STARTED',
        threadId: observedThreadId,
        turnId: observedTurnId,
        acknowledgedAt: this.now(),
      });
    } finally {
      await runner.close?.();
    }
    return 'HANDLED';
  }
}
