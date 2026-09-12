import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { InitializeParams } from './generated/app-server-0.153.4/InitializeParams.ts';
import type { SkillsExtraRootsSetParams } from './generated/app-server-0.153.4/v2/SkillsExtraRootsSetParams.ts';
import type { SkillsListParams } from './generated/app-server-0.153.4/v2/SkillsListParams.ts';
import type { ThreadStartParams } from './generated/app-server-0.153.4/v2/ThreadStartParams.ts';
import type { TurnStartParams } from './generated/app-server-0.153.4/v2/TurnStartParams.ts';
import type { AppServerRpc } from './jsonl-rpc.ts';
import {
  appServerNestedId as nestedId,
  appServerRecord as record,
  listedSkillIsAvailable,
  semanticTerminalResult,
  type AppServerTerminalResult as TerminalResult,
} from './app-server-session-helpers.ts';
import {
  normalizeAppServerNotification,
  type NormalizedAgentEvent,
} from './event-normalizer.ts';

export class CodexAppServerAdapter {
  constructor(
    private readonly rpc: AppServerRpc,
    private readonly options: {
      requestTimeoutMs?: number;
      maxPendingEvents?: number;
    } = {},
  ) {}

  async runReadonly(
    input: {
      workspacePath: string;
      objective: string;
      skill: { name: string; path: string };
    },
    onEvent: (event: NormalizedAgentEvent) => void | Promise<void>,
  ): Promise<{
    threadId: string;
    turnId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  }> {
    let threadId: string | null = null;
    let turnId: string | null = null;
    let resolveTerminal: ((result: TerminalResult) => void) | undefined;
    let rejectTerminal: ((error: Error) => void) | undefined;
    let eventDelivery = Promise.resolve();
    let pendingEvents = 0;
    let terminalSettled = false;
    let activeAgentMessage: { itemId: string; text: string } | null = null;
    let latestAgentMessage: string | null = null;
    const maxPendingEvents = Math.min(
      Math.max(this.options.maxPendingEvents ?? 100, 1),
      1_000,
    );
    const terminal = new Promise<TerminalResult>((resolve, reject) => {
      resolveTerminal = resolve;
      rejectTerminal = reject;
    });
    const failTerminal = (error: unknown) => {
      if (terminalSettled) return;
      terminalSettled = true;
      rejectTerminal?.(
        error instanceof Error
          ? error
          : new Error('APP_SERVER_EVENT_DELIVERY_FAILED'),
      );
    };
    const unsubscribe = this.rpc.onNotification((message) => {
      if (!record(message) || !record(message.params)) return;
      const messageThreadId = message.params.threadId;
      if (threadId && messageThreadId && messageThreadId !== threadId) return;
      const turn = record(message.params.turn) ? message.params.turn : null;
      if (message.method === 'turn/started' && typeof turn?.id === 'string') {
        turnId = turn.id;
      }
      if (
        message.method === 'item/agentMessage/delta' &&
        typeof message.params.itemId === 'string' &&
        typeof message.params.delta === 'string'
      ) {
        if (activeAgentMessage?.itemId !== message.params.itemId) {
          activeAgentMessage = { itemId: message.params.itemId, text: '' };
        }
        activeAgentMessage.text =
          `${activeAgentMessage.text}${message.params.delta}`.slice(0, 8_192);
      }
      const item = record(message.params.item) ? message.params.item : null;
      const messageForNormalization =
        message.method === 'item/completed' &&
        item?.type === 'agentMessage' &&
        typeof item.id === 'string' &&
        activeAgentMessage?.itemId === item.id
          ? {
              ...message,
              params: {
                ...message.params,
                item: {
                  ...item,
                  text:
                    typeof item.text === 'string' && item.text
                      ? item.text
                      : activeAgentMessage.text,
                },
              },
            }
          : message;
      const completedItem = record(messageForNormalization.params)
        ? record(messageForNormalization.params.item)
          ? messageForNormalization.params.item
          : null
        : null;
      if (
        message.method === 'item/completed' &&
        completedItem?.type === 'agentMessage' &&
        typeof completedItem.text === 'string'
      ) {
        latestAgentMessage = completedItem.text.slice(0, 8_192);
      }
      const transportStatus =
        message.method === 'turn/completed' && typeof turn?.status === 'string'
          ? turn.status
          : null;
      const semanticResult =
        transportStatus === 'completed'
          ? semanticTerminalResult(latestAgentMessage)
          : null;
      let normalized = normalizeAppServerNotification(messageForNormalization, {
        userProfile: process.env.USERPROFILE,
        workspacePath: input.workspacePath,
      });
      if (semanticResult) {
        normalized = {
          eventType:
            semanticResult.status === 'SUCCEEDED'
              ? 'RESULT_RECORDED'
              : semanticResult.status === 'FAILED'
                ? 'RUN_FAILED'
                : 'RUN_UNKNOWN',
          summary: {
            status: semanticResult.status,
            reasonCode: semanticResult.reasonCode ?? null,
          },
        };
      }
      if (
        message.method === 'item/completed' &&
        item?.type === 'agentMessage' &&
        item.id === activeAgentMessage?.itemId
      ) {
        activeAgentMessage = null;
      }
      if (normalized) {
        if (pendingEvents >= maxPendingEvents) {
          failTerminal(new Error('APP_SERVER_EVENT_BACKPRESSURE'));
          return;
        }
        pendingEvents += 1;
        eventDelivery = eventDelivery
          .then(() => onEvent(normalized))
          .finally(() => {
            pendingEvents -= 1;
          });
        void eventDelivery.catch(failTerminal);
      }
      if (message.method === 'turn/completed' && !terminalSettled) {
        terminalSettled = true;
        const result: TerminalResult =
          semanticResult ??
          (transportStatus === 'interrupted'
            ? { status: 'CANCELLED' }
            : transportStatus === 'failed'
              ? { status: 'FAILED', reasonCode: 'APP_SERVER_TURN_FAILED' }
              : {
                  status: 'UNKNOWN',
                  reasonCode: 'APP_SERVER_TURN_STATUS_UNKNOWN',
                });
        void eventDelivery.then(
          () => resolveTerminal?.(result),
          (error: unknown) =>
            rejectTerminal?.(
              error instanceof Error
                ? error
                : new Error('APP_SERVER_EVENT_DELIVERY_FAILED'),
            ),
        );
      }
    });
    try {
      const initializeParams = {
        clientInfo: {
          name: 'pfc-bridge',
          title: 'PFC Local Bridge',
          version: '0.1.0',
        },
        capabilities: null,
      } satisfies InitializeParams;
      await this.rpc.request('initialize', initializeParams);
      this.rpc.notify('initialized');
      const skillRoot = path.dirname(path.dirname(input.skill.path));
      const extraRootsParams = {
        extraRoots: [skillRoot],
      } satisfies SkillsExtraRootsSetParams;
      await this.rpc.request('skills/extraRoots/set', extraRootsParams);
      const skillsListParams = {
        cwds: [input.workspacePath],
        forceReload: true,
      } satisfies SkillsListParams;
      const skills = await this.rpc.request('skills/list', skillsListParams);
      if (!listedSkillIsAvailable(skills, input.skill)) {
        throw new Error('APP_SERVER_SKILL_NOT_AVAILABLE');
      }
      const threadStartParams = {
        cwd: input.workspacePath,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: false,
      } satisfies ThreadStartParams;
      const thread = await this.rpc.request('thread/start', threadStartParams);
      threadId = nestedId(thread, 'thread');
      const turnStartParams = {
        threadId,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        clientUserMessageId: randomUUID(),
        input: [
          {
            type: 'text',
            text: `$${input.skill.name} ${input.objective}`,
            text_elements: [],
          },
          { type: 'skill', name: input.skill.name, path: input.skill.path },
        ],
      } satisfies TurnStartParams;
      const turn = await this.rpc.request('turn/start', turnStartParams);
      turnId ??= nestedId(turn, 'turn');
      const timeoutMs = this.options.requestTimeoutMs ?? 120_000;
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        terminal,
        new Promise<TerminalResult>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                status: 'UNKNOWN',
                reasonCode: 'APP_SERVER_REQUEST_TIMEOUT',
              }),
            timeoutMs,
          );
        }),
      ]);
      clearTimeout(timer);
      return {
        threadId,
        turnId,
        ...result,
      };
    } finally {
      unsubscribe();
    }
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }
}
