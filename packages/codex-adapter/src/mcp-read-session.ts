import { createHash } from 'node:crypto';

import type { ThreadStartParams } from './generated/app-server-0.153.4/v2/ThreadStartParams.ts';
import type { ListMcpServerStatusParams } from './generated/app-server-0.153.4/v2/ListMcpServerStatusParams.ts';
import type { McpServerToolCallParams } from './generated/app-server-0.153.4/v2/McpServerToolCallParams.ts';
import type { AppServerRpc } from './jsonl-rpc.ts';
import {
  appServerNestedId,
  appServerRecord,
} from './app-server-session-helpers.ts';
import { redactAgentEvidence } from './evidence-redaction.ts';

export type McpInventorySnapshot = Readonly<{
  state: 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED';
  configFingerprint: string;
  servers: readonly Readonly<{
    name: string;
    runtimeStatus: 'CONNECTED' | 'UNAVAILABLE' | 'UNVERIFIED';
    authStatus: 'UNKNOWN' | 'UNSUPPORTED' | 'READY' | 'REQUIRED';
    tools: readonly Readonly<{
      name: string;
      inputSchemaHash: string;
      readOnlyHint: boolean | null;
    }>[];
  }>[];
}>;

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

function contentHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function redactStructuredValue(
  value: unknown,
  context: { userProfile?: string; workspacePath?: string },
  key = '',
): unknown {
  if (/(?:authorization|token|cookie|password|secret|credential)/i.test(key)) {
    return '<redacted>';
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactStructuredValue(item, context));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([itemKey]) => itemKey !== '_meta')
        .map(([itemKey, item]) => [
          itemKey,
          redactStructuredValue(item, context, itemKey),
        ]),
    );
  }
  return typeof value === 'string'
    ? redactAgentEvidence(value, context)
    : value;
}

function boundedName(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(value)
  ) {
    throw new Error(code);
  }
  return value;
}

function runtimeStatus(
  value: unknown,
): 'CONNECTED' | 'UNAVAILABLE' | 'UNVERIFIED' {
  if (value === 'connected') return 'CONNECTED';
  if (
    ['failed', 'cancelled', 'disabled', 'authenticationRequired'].includes(
      String(value),
    )
  ) {
    return 'UNAVAILABLE';
  }
  return 'UNVERIFIED';
}

function authStatus(
  value: unknown,
): 'UNKNOWN' | 'UNSUPPORTED' | 'READY' | 'REQUIRED' {
  if (value === 'unsupported') return 'UNSUPPORTED';
  if (value === 'bearerToken' || value === 'oAuth') return 'READY';
  if (value === 'notLoggedIn') return 'REQUIRED';
  return 'UNKNOWN';
}

export class CodexMcpReadSession {
  private initialized = false;

  constructor(
    private readonly rpc: AppServerRpc,
    private readonly context: {
      userProfile?: string;
      workspacePath?: string;
    } = {},
  ) {}

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc.request('initialize', {
      clientInfo: {
        name: 'pfc-bridge',
        title: 'PFC Local Bridge',
        version: '0.1.0',
      },
      capabilities: null,
    });
    this.rpc.notify('initialized');
    this.initialized = true;
  }

  private async startReadOnlyThread(): Promise<string> {
    await this.initialize();
    const threadParams = {
      cwd: this.context.workspacePath ?? process.cwd(),
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    } satisfies ThreadStartParams;
    const thread = await this.rpc.request('thread/start', threadParams);
    return appServerNestedId(thread, 'thread');
  }

  private async listInventoryForThread(
    threadId: string,
  ): Promise<McpInventorySnapshot> {
    const params = {
      cursor: null,
      limit: 20,
      detail: 'toolsAndAuthOnly',
      threadId,
    } satisfies ListMcpServerStatusParams;
    const response = await this.rpc.request('mcpServerStatus/list', params);
    if (!appServerRecord(response) || !Array.isArray(response.data)) {
      throw new Error('MCP_INVENTORY_INVALID');
    }
    if (response.data.length > 20 || response.nextCursor !== null) {
      throw new Error('MCP_INVENTORY_LIMIT_EXCEEDED');
    }
    const servers = response.data.map((rawServer) => {
      if (!appServerRecord(rawServer) || !appServerRecord(rawServer.tools)) {
        throw new Error('MCP_INVENTORY_SERVER_INVALID');
      }
      const tools = Object.values(rawServer.tools).map((rawTool) => {
        if (!appServerRecord(rawTool))
          throw new Error('MCP_INVENTORY_TOOL_INVALID');
        const annotations = appServerRecord(rawTool.annotations)
          ? rawTool.annotations
          : null;
        return {
          name: boundedName(rawTool.name, 'MCP_INVENTORY_TOOL_NAME_INVALID'),
          inputSchemaHash: contentHash(canonicalJson(rawTool.inputSchema)),
          readOnlyHint:
            typeof annotations?.readOnlyHint === 'boolean'
              ? annotations.readOnlyHint
              : null,
        };
      });
      if (tools.length > 50)
        throw new Error('MCP_INVENTORY_TOOL_LIMIT_EXCEEDED');
      tools.sort((left, right) => left.name.localeCompare(right.name));
      return {
        name: boundedName(rawServer.name, 'MCP_INVENTORY_SERVER_NAME_INVALID'),
        runtimeStatus: runtimeStatus(rawServer.runtimeStatus),
        authStatus: authStatus(rawServer.authStatus),
        tools,
      };
    });
    servers.sort((left, right) => left.name.localeCompare(right.name));
    return {
      state: servers.some(
        (server) =>
          server.runtimeStatus === 'CONNECTED' && server.tools.length > 0,
      )
        ? 'AVAILABLE'
        : servers.length
          ? 'UNVERIFIED'
          : 'UNAVAILABLE',
      configFingerprint: contentHash(canonicalJson(servers)),
      servers,
    };
  }

  async listInventory(): Promise<McpInventorySnapshot> {
    return this.listInventoryForThread(await this.startReadOnlyThread());
  }

  async call(input: {
    serverName: string;
    toolName: string;
    input: Readonly<Record<string, unknown>>;
    expectedInputSchemaHash: string;
    expectedConfigFingerprint: string;
    timeoutMs: number;
    maxOutputBytes: number;
    onStarted?: (threadId: string) => void | Promise<void>;
  }): Promise<{
    threadId: string;
    outputSummary: string;
    outputHash: string;
    outputBytes: number;
    truncated: boolean;
    isError: boolean;
  }> {
    const threadId = await this.startReadOnlyThread();
    const inventory = await this.listInventoryForThread(threadId);
    const server = inventory.servers.find(
      (item) => item.name === input.serverName,
    );
    const tool = server?.tools.find((item) => item.name === input.toolName);
    if (
      inventory.configFingerprint.toLowerCase() !==
        input.expectedConfigFingerprint.toLowerCase() ||
      server?.runtimeStatus !== 'CONNECTED' ||
      !tool ||
      tool.inputSchemaHash.toLowerCase() !==
        input.expectedInputSchemaHash.toLowerCase()
    ) {
      throw new Error('MCP_CAPABILITY_DRIFTED');
    }
    await input.onStarted?.(threadId);
    const callParams = {
      threadId,
      server: input.serverName,
      tool: input.toolName,
      arguments: input.input as McpServerToolCallParams['arguments'],
    } satisfies McpServerToolCallParams;
    let timeout: NodeJS.Timeout | undefined;
    const response = await Promise.race([
      this.rpc.request('mcpServer/tool/call', callParams),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('MCP_RESULT_UNKNOWN')),
          Math.min(Math.max(input.timeoutMs, 1), 30_000),
        );
      }),
    ]).finally(() => clearTimeout(timeout));
    if (!appServerRecord(response) || !Array.isArray(response.content)) {
      throw new Error('MCP_RESULT_INVALID');
    }
    const canonical = canonicalJson(response);
    const outputBytes = Buffer.byteLength(canonical, 'utf8');
    const outputSummary = canonicalJson(
      redactStructuredValue(response, this.context),
    ).slice(0, 16_384);
    return {
      threadId,
      outputSummary,
      outputHash: contentHash(canonical),
      outputBytes,
      truncated: outputBytes > Math.min(input.maxOutputBytes, 262_144),
      isError: response.isError === true,
    };
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }
}
