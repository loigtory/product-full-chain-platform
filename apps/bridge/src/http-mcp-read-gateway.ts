import { randomUUID } from 'node:crypto';

import {
  BRIDGE_PROTOCOL_VERSION,
  parseMcpReadCommand,
  parseMcpReadContext,
  type McpReadCommand,
} from '../../../packages/protocol/src/index.ts';
import type { McpReadGatewayPort } from './mcp-read-ports.ts';

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

export class HttpMcpReadGateway implements McpReadGatewayPort {
  private readonly baseUrl: string;
  private readonly fetcher: FetchPort;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(
    private readonly options: {
      baseUrl: string;
      bridgeId: string;
      credential: string;
      fetcher?: FetchPort;
      now?: () => string;
      idFactory?: () => string;
    },
  ) {
    const url = new URL(options.baseUrl);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.username ||
      url.password ||
      !url.port
    ) {
      throw new Error('BRIDGE_GATEWAY_LOOPBACK_URL_REQUIRED');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(options.bridgeId)) {
      throw new Error('BRIDGE_GATEWAY_ID_INVALID');
    }
    if (options.credential.length < 20 || options.credential.length > 400) {
      throw new Error('BRIDGE_GATEWAY_CREDENTIAL_INVALID');
    }
    this.baseUrl = url.origin;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  private headers(): Record<string, string> {
    const messageId = this.idFactory();
    return {
      authorization: `Bridge ${this.options.credential}`,
      'content-type': 'application/json',
      'x-pfc-protocol-version': BRIDGE_PROTOCOL_VERSION,
      'x-pfc-message-id': messageId,
      'x-pfc-bridge-id': this.options.bridgeId,
      'x-pfc-sent-at': this.now(),
      'x-pfc-nonce': `${messageId}-${randomUUID()}`,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`BRIDGE_GATEWAY_HTTP_${response.status}`);
    }
    return response;
  }

  async claimNext(input: { bridgeId: string; leaseSeconds: number }) {
    if (input.bridgeId !== this.options.bridgeId) {
      throw new Error('BRIDGE_GATEWAY_ID_MISMATCH');
    }
    const response = await this.request(
      '/bridge/v1/mcp-read-requests/commands/next',
      { method: 'GET' },
    );
    return response.status === 204
      ? null
      : parseMcpReadCommand(await response.json());
  }

  async fetchContext(input: { bridgeId: string; command: McpReadCommand }) {
    if (input.bridgeId !== this.options.bridgeId) {
      throw new Error('BRIDGE_GATEWAY_ID_MISMATCH');
    }
    const response = await this.request(
      `/bridge/v1/mcp-read-requests/commands/${encodeURIComponent(input.command.commandId)}/context`,
      { method: 'GET' },
    );
    return parseMcpReadContext(await response.json());
  }

  async submitEvent(input: Parameters<McpReadGatewayPort['submitEvent']>[0]) {
    if (input.bridgeId !== this.options.bridgeId) {
      throw new Error('BRIDGE_GATEWAY_ID_MISMATCH');
    }
    const response = await this.request(
      `/bridge/v1/mcp-read-requests/commands/${encodeURIComponent(input.commandId)}/events`,
      {
        method: 'POST',
        body: JSON.stringify({ event: input.event }),
      },
    );
    return (await response.json()) as { status: 'APPENDED' | 'DUPLICATE' };
  }
}
