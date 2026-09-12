import { randomUUID } from 'node:crypto';

import {
  BRIDGE_PROTOCOL_VERSION,
  parseBridgeCommand,
  type BridgeCapabilitySnapshot,
} from '../../../packages/protocol/src/index.ts';
import type { BridgeAgentEvent, BridgeGatewayPort } from './ports.ts';

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

export class HttpBridgeGateway implements BridgeGatewayPort {
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
    const response = await this.request('/bridge/v1/commands/next', {
      method: 'GET',
    });
    if (response.status === 204) return null;
    return parseBridgeCommand(await response.json());
  }

  async submitEvent(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    sourceEventId: string;
    expectedSequence: number;
    event: BridgeAgentEvent;
    occurredAt: string;
  }) {
    if (input.bridgeId !== this.options.bridgeId) {
      throw new Error('BRIDGE_GATEWAY_ID_MISMATCH');
    }
    const response = await this.request(
      `/bridge/v1/runs/${encodeURIComponent(input.runId)}/events`,
      {
        method: 'POST',
        body: JSON.stringify({
          commandId: input.commandId,
          sourceEventId: input.sourceEventId,
          expectedSequence: input.expectedSequence,
          event: input.event,
          occurredAt: input.occurredAt,
        }),
      },
    );
    return (await response.json()) as {
      status: 'APPENDED' | 'DUPLICATE' | 'SEQUENCE_GAP';
    };
  }

  async acknowledge(input: {
    bridgeId: string;
    commandId: string;
    runId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
    reasonCode?: string;
    threadId?: string;
    turnId?: string;
    acknowledgedAt: string;
  }): Promise<void> {
    if (input.bridgeId !== this.options.bridgeId) {
      throw new Error('BRIDGE_GATEWAY_ID_MISMATCH');
    }
    await this.request(
      `/bridge/v1/commands/${encodeURIComponent(input.commandId)}/acknowledgements`,
      {
        method: 'POST',
        body: JSON.stringify({
          runId: input.runId,
          status: input.status,
          reasonCode: input.reasonCode,
          threadId: input.threadId,
          turnId: input.turnId,
          acknowledgedAt: input.acknowledgedAt,
        }),
      },
    );
  }

  async reportCapabilities(input: {
    bridgeId: string;
    snapshot: BridgeCapabilitySnapshot;
  }): Promise<void> {
    if (input.bridgeId !== this.options.bridgeId) {
      throw new Error('BRIDGE_GATEWAY_ID_MISMATCH');
    }
    await this.request('/bridge/v1/capability-snapshots', {
      method: 'POST',
      body: JSON.stringify(input.snapshot),
    });
  }

  async submitApproval(
    input: Parameters<BridgeGatewayPort['submitApproval']>[0],
  ) {
    if (input.bridgeId !== this.options.bridgeId) {
      throw new Error('BRIDGE_GATEWAY_ID_MISMATCH');
    }
    const response = await this.request(
      `/bridge/v1/runs/${encodeURIComponent(input.runId)}/approvals`,
      {
        method: 'POST',
        body: JSON.stringify({
          commandId: input.commandId,
          executionInstanceId: input.executionInstanceId,
          appServerRequestId: input.appServerRequestId,
          threadId: input.threadId,
          turnId: input.turnId,
          itemId: input.itemId,
          callbackId: input.callbackId,
          kind: input.kind,
          requestedScope: input.requestedScope,
          outsideCapsule: input.outsideCapsule,
          requestedAt: input.requestedAt,
        }),
      },
    );
    return (await response.json()) as { afterSequence: number };
  }

  async reportCapsule(
    input: Parameters<BridgeGatewayPort['reportCapsule']>[0],
  ) {
    if (input.bridgeId !== this.options.bridgeId) {
      throw new Error('BRIDGE_GATEWAY_ID_MISMATCH');
    }
    await this.request(
      `/bridge/v1/runs/${encodeURIComponent(input.runId)}/capsules`,
      {
        method: 'POST',
        body: JSON.stringify({
          executionInstanceId: input.executionInstanceId,
          sourceGitBaseline: input.sourceGitBaseline,
          scopeHash: input.scopeHash,
          beforeManifestHash: input.beforeManifestHash,
          afterManifestHash: input.afterManifestHash,
          lifecycle: input.lifecycle,
          diffSummary: input.diffSummary,
          occurredAt: input.occurredAt,
        }),
      },
    );
  }
}
