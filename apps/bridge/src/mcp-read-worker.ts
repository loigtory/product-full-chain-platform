import { createHash } from 'node:crypto';

import {
  MCP_READ_EVENT_VERSION,
  parseMcpReadCommand,
  parseMcpReadContext,
  parseMcpReadEvent,
  type McpReadCommand,
  type McpReadEvent,
} from '../../../packages/protocol/src/index.ts';
import type {
  McpReadGatewayPort,
  McpReadRunnerFactory,
} from './mcp-read-ports.ts';

type WorkerResult = 'IDLE' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function boundedReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{2,159}$/.test(message)
    ? message
    : 'MCP_RESULT_UNKNOWN';
}

function contextMatches(
  command: McpReadCommand,
  context: ReturnType<typeof parseMcpReadContext>,
): boolean {
  return (
    context.commandId === command.commandId &&
    context.requestId === command.payload.requestId &&
    contentHash(context.input).toLowerCase() ===
      command.payload.inputHash.toLowerCase()
  );
}

export class McpReadWorker {
  private readonly now: () => string;
  private readonly leaseSeconds: number;
  private readonly idFactory: (prefix: string) => string;

  constructor(
    private readonly options: Readonly<{
      bridgeId: string;
      gateway: McpReadGatewayPort;
      runnerFactory: McpReadRunnerFactory;
      now?: () => string;
      leaseSeconds?: number;
      idFactory?: (prefix: string) => string;
    }>,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.leaseSeconds = Math.min(Math.max(options.leaseSeconds ?? 30, 5), 120);
    this.idFactory =
      options.idFactory ??
      ((prefix) =>
        `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  private event(
    event:
      | Readonly<{
          eventType: 'MCP_READ_STARTED';
          payload: Readonly<{ requestId: string; threadId: string }>;
        }>
      | Readonly<{
          eventType: 'MCP_READ_COMPLETED';
          payload: Readonly<{
            requestId: string;
            outputSummary: string;
            outputHash: string;
            outputBytes: number;
            truncated: boolean;
            durationMs: number;
            threadId: string;
          }>;
        }>
      | Readonly<{
          eventType: 'MCP_READ_FAILED' | 'MCP_READ_UNKNOWN';
          payload: Readonly<{
            requestId: string;
            reasonCode: string;
            threadId: string | null;
          }>;
        }>,
  ): McpReadEvent {
    return parseMcpReadEvent({
      schemaVersion: MCP_READ_EVENT_VERSION,
      sourceEventId: this.idFactory('MCP_READ_EVENT'),
      occurredAt: this.now(),
      ...event,
    });
  }

  private async submit(command: McpReadCommand, event: McpReadEvent) {
    return this.options.gateway.submitEvent({
      bridgeId: this.options.bridgeId,
      commandId: command.commandId,
      event,
    });
  }

  private async fail(
    command: McpReadCommand,
    reasonCode: string,
    threadId: string | null,
    unknown: boolean,
  ): Promise<'FAILED' | 'UNKNOWN'> {
    await this.submit(
      command,
      this.event({
        eventType: unknown ? 'MCP_READ_UNKNOWN' : 'MCP_READ_FAILED',
        payload: { requestId: command.payload.requestId, reasonCode, threadId },
      }),
    );
    return unknown ? 'UNKNOWN' : 'FAILED';
  }

  async runOnce(): Promise<WorkerResult> {
    const raw = await this.options.gateway.claimNext({
      bridgeId: this.options.bridgeId,
      leaseSeconds: this.leaseSeconds,
    });
    if (raw === null) return 'IDLE';
    const command = parseMcpReadCommand(raw);
    if (Date.parse(command.leaseUntil) <= Date.parse(this.now())) {
      return this.fail(command, 'MCP_READ_LEASE_EXPIRED', null, false);
    }
    let context;
    try {
      context = parseMcpReadContext(
        await this.options.gateway.fetchContext({
          bridgeId: this.options.bridgeId,
          command,
        }),
      );
    } catch {
      return this.fail(command, 'MCP_READ_CONTEXT_INVALID', null, false);
    }
    if (!contextMatches(command, context)) {
      return this.fail(command, 'MCP_READ_CONTEXT_MISMATCH', null, false);
    }
    const runner = this.options.runnerFactory();
    const startedAt = Date.parse(this.now());
    let threadId: string | null = null;
    let started = false;
    try {
      const result = await runner.call({
        serverName: command.payload.serverName,
        toolName: command.payload.toolName,
        input: context.input,
        expectedInputSchemaHash: command.payload.inputSchemaHash,
        expectedConfigFingerprint: command.payload.configFingerprint,
        timeoutMs: context.limits.timeoutMs,
        maxOutputBytes: context.limits.maxOutputBytes,
        onStarted: async (startedThreadId) => {
          threadId = startedThreadId;
          await this.submit(
            command,
            this.event({
              eventType: 'MCP_READ_STARTED',
              payload: {
                requestId: command.payload.requestId,
                threadId: startedThreadId,
              },
            }),
          );
          started = true;
        },
      });
      threadId = result.threadId;
      if (
        result.truncated ||
        result.outputBytes > context.limits.maxOutputBytes
      ) {
        return this.fail(command, 'MCP_OUTPUT_LIMIT_EXCEEDED', threadId, false);
      }
      if (result.isError) {
        return this.fail(command, 'MCP_TOOL_REPORTED_ERROR', threadId, false);
      }
      await this.submit(
        command,
        this.event({
          eventType: 'MCP_READ_COMPLETED',
          payload: {
            requestId: command.payload.requestId,
            outputSummary: result.outputSummary,
            outputHash: result.outputHash,
            outputBytes: result.outputBytes,
            truncated: false,
            durationMs: Math.max(0, Date.parse(this.now()) - startedAt),
            threadId: result.threadId,
          },
        }),
      );
      return 'COMPLETED';
    } catch (error) {
      return this.fail(command, boundedReason(error), threadId, started);
    } finally {
      await runner.close().catch(() => undefined);
    }
  }
}
