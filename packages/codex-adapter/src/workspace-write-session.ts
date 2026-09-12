import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  AgentApprovalKind,
  AgentApprovalScopeDto,
  AgentRunScopeDto,
} from '@pfc/contracts';

import {
  appServerNestedId,
  appServerRecord,
  listedSkillIsAvailable,
  semanticTerminalResult,
  type AppServerTerminalResult,
} from './app-server-session-helpers.ts';
import type { InitializeParams } from './generated/app-server-0.153.4/InitializeParams.ts';
import type { SkillsExtraRootsSetParams } from './generated/app-server-0.153.4/v2/SkillsExtraRootsSetParams.ts';
import type { SkillsListParams } from './generated/app-server-0.153.4/v2/SkillsListParams.ts';
import type { ThreadStartParams } from './generated/app-server-0.153.4/v2/ThreadStartParams.ts';
import type { TurnStartParams } from './generated/app-server-0.153.4/v2/TurnStartParams.ts';
import type { AppServerRequestEnvelope, AppServerRpc } from './jsonl-rpc.ts';
import {
  normalizeAppServerNotification,
  type NormalizedAgentEvent,
} from './event-normalizer.ts';

export type WorkspaceWriteApprovalRequest = Readonly<{
  appServerRequestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  callbackId: string | null;
  kind: AgentApprovalKind;
  requestedScope: AgentApprovalScopeDto;
  outsideCapsule: boolean;
}>;

type PendingApproval = Readonly<{
  rawId: string | number;
  kind: AgentApprovalKind;
}>;

function requestIdentity(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function pathApiFor(value: string): typeof path.win32 | typeof path.posix {
  return /^[A-Za-z]:[\\/]/.test(value) ? path.win32 : path.posix;
}

function capsuleRelative(
  capsulePath: string,
  requestedPath: string,
): string | null {
  const pathApi = pathApiFor(capsulePath);
  const relative = pathApi.relative(
    capsulePath,
    pathApi.resolve(requestedPath),
  );
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.split(pathApi.sep).join('/');
}

function networkRequested(value: unknown): boolean {
  if (!appServerRecord(value)) return false;
  if (value.enabled === true) return true;
  return Object.values(value).some(networkRequested);
}

function fileSystemPaths(value: unknown): readonly string[] {
  if (!appServerRecord(value)) return [];
  const legacy = [value.read, value.write]
    .flatMap((entry) => (Array.isArray(entry) ? entry : []))
    .filter((entry): entry is string => typeof entry === 'string');
  const entries = Array.isArray(value.entries)
    ? value.entries.flatMap((entry) => {
        if (
          !appServerRecord(entry) ||
          !appServerRecord(entry.path) ||
          entry.path.type !== 'path' ||
          typeof entry.path.path !== 'string'
        ) {
          return [];
        }
        return [entry.path.path];
      })
    : [];
  return [...new Set([...legacy, ...entries])];
}

function requestedPermissionParts(params: Record<string, unknown>): {
  paths: readonly string[];
  networkAccess: boolean;
} {
  const permissions = appServerRecord(params.permissions)
    ? params.permissions
    : appServerRecord(params.additionalPermissions)
      ? params.additionalPermissions
      : {};
  return {
    paths: fileSystemPaths(permissions.fileSystem),
    networkAccess:
      networkRequested(permissions.network) ||
      appServerRecord(params.networkApprovalContext),
  };
}

function approvalRequest(
  request: AppServerRequestEnvelope,
  capsulePath: string,
  runScope: AgentRunScopeDto,
): WorkspaceWriteApprovalRequest {
  if (!appServerRecord(request.params)) {
    throw new Error('APP_SERVER_APPROVAL_PARAMS_INVALID');
  }
  const params = request.params;
  if (
    typeof params.threadId !== 'string' ||
    typeof params.turnId !== 'string' ||
    typeof params.itemId !== 'string'
  ) {
    throw new Error('APP_SERVER_APPROVAL_IDENTITY_INVALID');
  }
  let kind: AgentApprovalKind;
  let requestedPaths: readonly string[];
  let networkAccess = false;
  if (request.method === 'item/commandExecution/requestApproval') {
    kind = 'COMMAND_EXECUTION';
    ({ paths: requestedPaths, networkAccess } =
      requestedPermissionParts(params));
  } else if (request.method === 'item/fileChange/requestApproval') {
    kind = 'FILE_CHANGE';
    requestedPaths =
      typeof params.grantRoot === 'string' ? [params.grantRoot] : [];
  } else if (request.method === 'item/permissions/requestApproval') {
    kind = 'PERMISSIONS';
    ({ paths: requestedPaths, networkAccess } =
      requestedPermissionParts(params));
  } else {
    throw new Error('APP_SERVER_REQUEST_NOT_ALLOWED');
  }
  const relativePaths = requestedPaths
    .map((requestedPath) => capsuleRelative(capsulePath, requestedPath))
    .filter((requestedPath): requestedPath is string => Boolean(requestedPath));
  return {
    appServerRequestId: requestIdentity(request.id),
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    callbackId:
      typeof params.approvalId === 'string' ? params.approvalId : null,
    kind,
    requestedScope: {
      allowedRelativePaths:
        relativePaths.length > 0
          ? relativePaths
          : runScope.allowedRelativePaths,
      allowedActions: runScope.allowedActions,
      networkAccess,
      maxChangedFiles: runScope.maxChangedFiles,
      maxChangedBytes: runScope.maxChangedBytes,
    },
    outsideCapsule: relativePaths.length !== requestedPaths.length,
  };
}

function grantedPathIsWithinScope(
  granted: string,
  allowedPaths: readonly string[],
): boolean {
  return allowedPaths.some(
    (allowed) => granted === allowed || granted.startsWith(`${allowed}/`),
  );
}

export class CodexWorkspaceWriteSession {
  readonly completion: Promise<
    AppServerTerminalResult & { threadId: string; turnId: string }
  >;

  private threadId = '';
  private turnId = '';
  private terminalStatus: AppServerTerminalResult | null = null;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly unsubscribeNotification: () => void;
  private readonly unsubscribeRequest: () => void;
  private resolveCompletion: (
    result: AppServerTerminalResult & { threadId: string; turnId: string },
  ) => void = () => undefined;
  private rejectCompletion: (error: Error) => void = () => undefined;
  private eventDelivery = Promise.resolve();
  private activeAgentMessage: { itemId: string; text: string } | null = null;
  private latestAgentMessage: string | null = null;

  advanceEventCursor(): void {
    // The Bridge worker owns the persisted event cursor for this session.
  }

  private constructor(
    private readonly rpc: AppServerRpc,
    private readonly input: {
      workspacePath: string;
      objective: string;
      skill: { name: string; path: string };
      runScope: AgentRunScopeDto;
    },
    private readonly onEvent: (
      event: NormalizedAgentEvent,
    ) => void | Promise<void>,
    private readonly onApproval: (
      approval: WorkspaceWriteApprovalRequest,
    ) => void | Promise<void>,
  ) {
    if (!rpc.onServerRequest || !rpc.respond) {
      throw new Error('APP_SERVER_APPROVAL_TRANSPORT_REQUIRED');
    }
    this.completion = new Promise((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    this.unsubscribeNotification = rpc.onNotification((message) => {
      this.handleNotification(message);
    });
    this.unsubscribeRequest = rpc.onServerRequest((request) =>
      this.handleApprovalRequest(request),
    );
  }

  static async start(
    rpc: AppServerRpc,
    input: {
      workspacePath: string;
      objective: string;
      skill: { name: string; path: string };
      runScope: AgentRunScopeDto;
    },
    onEvent: (event: NormalizedAgentEvent) => void | Promise<void>,
    onApproval: (
      approval: WorkspaceWriteApprovalRequest,
    ) => void | Promise<void>,
  ): Promise<CodexWorkspaceWriteSession> {
    const session = new CodexWorkspaceWriteSession(
      rpc,
      input,
      onEvent,
      onApproval,
    );
    try {
      await session.initialize();
      return session;
    } catch (error) {
      session.unsubscribeNotification();
      session.unsubscribeRequest();
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    const initializeParams = {
      clientInfo: {
        name: 'pfc-bridge',
        title: 'PFC Local Bridge',
        version: '0.2.0',
      },
      capabilities: null,
    } satisfies InitializeParams;
    await this.rpc.request('initialize', initializeParams);
    this.rpc.notify('initialized');
    const extraRootsParams = {
      extraRoots: [path.dirname(path.dirname(this.input.skill.path))],
    } satisfies SkillsExtraRootsSetParams;
    await this.rpc.request('skills/extraRoots/set', extraRootsParams);
    const skillsListParams = {
      cwds: [this.input.workspacePath],
      forceReload: true,
    } satisfies SkillsListParams;
    const skills = await this.rpc.request('skills/list', skillsListParams);
    if (!listedSkillIsAvailable(skills, this.input.skill)) {
      throw new Error('APP_SERVER_SKILL_NOT_AVAILABLE');
    }
    const threadStartParams = {
      cwd: this.input.workspacePath,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      ephemeral: false,
    } satisfies ThreadStartParams;
    const thread = await this.rpc.request('thread/start', threadStartParams);
    this.threadId = appServerNestedId(thread, 'thread');
    const turnStartParams = {
      threadId: this.threadId,
      clientUserMessageId: randomUUID(),
      cwd: this.input.workspacePath,
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [this.input.workspacePath],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      },
      input: [
        {
          type: 'text',
          text: `$${this.input.skill.name} ${this.input.objective}`,
          text_elements: [],
        },
        {
          type: 'skill',
          name: this.input.skill.name,
          path: this.input.skill.path,
        },
      ],
    } satisfies TurnStartParams;
    const turn = await this.rpc.request('turn/start', turnStartParams);
    this.turnId ||= appServerNestedId(turn, 'turn');
  }

  private handleNotification(message: unknown): void {
    if (!appServerRecord(message) || !appServerRecord(message.params)) return;
    const messageThreadId = message.params.threadId;
    if (this.threadId && messageThreadId && messageThreadId !== this.threadId) {
      return;
    }
    const turn = appServerRecord(message.params.turn)
      ? message.params.turn
      : null;
    if (message.method === 'turn/started' && typeof turn?.id === 'string') {
      this.turnId = turn.id;
    }
    if (
      message.method === 'item/agentMessage/delta' &&
      typeof message.params.itemId === 'string' &&
      typeof message.params.delta === 'string'
    ) {
      if (this.activeAgentMessage?.itemId !== message.params.itemId) {
        this.activeAgentMessage = { itemId: message.params.itemId, text: '' };
      }
      this.activeAgentMessage.text =
        `${this.activeAgentMessage.text}${message.params.delta}`.slice(
          0,
          8_192,
        );
    }
    const item = appServerRecord(message.params.item)
      ? message.params.item
      : null;
    const normalizedMessage =
      message.method === 'item/completed' &&
      item?.type === 'agentMessage' &&
      typeof item.id === 'string' &&
      this.activeAgentMessage?.itemId === item.id
        ? {
            ...message,
            params: {
              ...message.params,
              item: {
                ...item,
                text:
                  typeof item.text === 'string' && item.text
                    ? item.text
                    : this.activeAgentMessage.text,
              },
            },
          }
        : message;
    if (
      appServerRecord(normalizedMessage.params) &&
      appServerRecord(normalizedMessage.params.item) &&
      normalizedMessage.params.item.type === 'agentMessage' &&
      typeof normalizedMessage.params.item.text === 'string'
    ) {
      this.latestAgentMessage = normalizedMessage.params.item.text.slice(
        0,
        8_192,
      );
    }
    const normalized = normalizeAppServerNotification(normalizedMessage, {
      userProfile: process.env.USERPROFILE,
      workspacePath: this.input.workspacePath,
    });
    if (normalized) {
      this.eventDelivery = this.eventDelivery.then(() =>
        this.onEvent(normalized),
      );
    }
    if (message.method !== 'turn/completed' || this.terminalStatus) return;
    const transportStatus = typeof turn?.status === 'string' ? turn.status : '';
    this.terminalStatus =
      transportStatus === 'completed'
        ? semanticTerminalResult(this.latestAgentMessage)
        : transportStatus === 'interrupted'
          ? { status: 'CANCELLED' }
          : transportStatus === 'failed'
            ? { status: 'FAILED', reasonCode: 'APP_SERVER_TURN_FAILED' }
            : {
                status: 'UNKNOWN',
                reasonCode: 'APP_SERVER_TURN_STATUS_UNKNOWN',
              };
    void this.eventDelivery.then(
      () =>
        this.resolveCompletion({
          ...this.terminalStatus!,
          threadId: this.threadId,
          turnId: this.turnId,
        }),
      (error: unknown) =>
        this.rejectCompletion(
          error instanceof Error
            ? error
            : new Error('APP_SERVER_EVENT_DELIVERY_FAILED'),
        ),
    );
  }

  private async handleApprovalRequest(
    request: AppServerRequestEnvelope,
  ): Promise<void> {
    const approval = approvalRequest(
      request,
      this.input.workspacePath,
      this.input.runScope,
    );
    if (
      approval.threadId !== this.threadId ||
      (this.turnId && approval.turnId !== this.turnId)
    ) {
      throw new Error('APP_SERVER_APPROVAL_IDENTITY_MISMATCH');
    }
    if (this.pendingApprovals.has(approval.appServerRequestId)) {
      throw new Error('APP_SERVER_APPROVAL_DUPLICATE');
    }
    this.pendingApprovals.set(approval.appServerRequestId, {
      rawId: request.id,
      kind: approval.kind,
    });
    try {
      await this.onApproval(approval);
    } catch (error) {
      await this.resolveApproval({
        appServerRequestId: approval.appServerRequestId,
        approvalKind: approval.kind,
        decision: 'decline',
      });
      throw error;
    }
  }

  async resolveApproval(input: {
    appServerRequestId: string;
    approvalKind: AgentApprovalKind;
    decision: 'accept' | 'decline' | 'cancel';
    grantedRelativePaths?: readonly string[];
  }): Promise<void> {
    const pending = this.pendingApprovals.get(input.appServerRequestId);
    if (!pending) throw new Error('APP_SERVER_APPROVAL_NOT_PENDING');
    if (pending.kind !== input.approvalKind) {
      throw new Error('APP_SERVER_APPROVAL_KIND_MISMATCH');
    }
    let result: unknown;
    if (pending.kind === 'PERMISSIONS') {
      const grantedRelativePaths = input.grantedRelativePaths ?? [];
      if (
        input.decision === 'accept' &&
        grantedRelativePaths.some(
          (granted) =>
            !grantedPathIsWithinScope(
              granted,
              this.input.runScope.allowedRelativePaths,
            ),
        )
      ) {
        throw new Error('APP_SERVER_APPROVAL_SCOPE_EXPANSION');
      }
      const pathApi = pathApiFor(this.input.workspacePath);
      result = {
        permissions:
          input.decision === 'accept'
            ? {
                fileSystem: {
                  read: null,
                  write: grantedRelativePaths.map((granted) =>
                    pathApi.resolve(
                      this.input.workspacePath,
                      ...granted.split('/'),
                    ),
                  ),
                },
              }
            : {},
        scope: 'turn',
        strictAutoReview: true,
      };
    } else {
      result = { decision: input.decision };
    }
    this.rpc.respond?.(pending.rawId, result);
    this.pendingApprovals.delete(input.appServerRequestId);
  }

  async interrupt(input: {
    threadId?: string;
    turnId?: string;
    reason?: 'BRIDGE_REVOKED';
  }): Promise<void> {
    for (const [appServerRequestId, pending] of this.pendingApprovals) {
      await this.resolveApproval({
        appServerRequestId,
        approvalKind: pending.kind,
        decision: 'cancel',
      });
    }
    const threadId = input.threadId ?? this.threadId;
    const turnId = input.turnId ?? this.turnId;
    if (!threadId || !turnId) throw new Error('APP_SERVER_TURN_ID_MISSING');
    await this.rpc.request('turn/interrupt', { threadId, turnId });
  }

  async verify(): Promise<{
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
    threadId: string;
    turnId: string;
  }> {
    if (this.terminalStatus) {
      return {
        status: this.terminalStatus.status,
        threadId: this.threadId,
        turnId: this.turnId,
      };
    }
    const response = await this.rpc.request('thread/read', {
      threadId: this.threadId,
      includeTurns: true,
    });
    if (!appServerRecord(response) || !appServerRecord(response.thread)) {
      return {
        status: 'UNKNOWN',
        threadId: this.threadId,
        turnId: this.turnId,
      };
    }
    const turns = Array.isArray(response.thread.turns)
      ? response.thread.turns
      : [];
    const turn = turns.find(
      (candidate) => appServerRecord(candidate) && candidate.id === this.turnId,
    );
    const status = appServerRecord(turn) ? turn.status : null;
    return {
      status:
        status === 'inProgress'
          ? 'RUNNING'
          : status === 'completed'
            ? 'SUCCEEDED'
            : status === 'interrupted'
              ? 'CANCELLED'
              : status === 'failed'
                ? 'FAILED'
                : 'UNKNOWN',
      threadId: this.threadId,
      turnId: this.turnId,
    };
  }

  async close(): Promise<void> {
    this.unsubscribeNotification();
    this.unsubscribeRequest();
    await this.rpc.close();
  }
}
