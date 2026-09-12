import type {
  McpReadCommand,
  McpReadEvent,
} from '../../../packages/protocol/src/index.ts';

export interface McpReadGatewayPort {
  claimNext(input: {
    bridgeId: string;
    leaseSeconds: number;
  }): Promise<unknown | null>;
  fetchContext(input: {
    bridgeId: string;
    command: McpReadCommand;
  }): Promise<unknown>;
  submitEvent(input: {
    bridgeId: string;
    commandId: string;
    event: McpReadEvent;
  }): Promise<{ status: 'APPENDED' | 'DUPLICATE' }>;
}

export interface McpReadRunnerPort {
  call(input: {
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
  }>;
  close(): Promise<void>;
}

export type McpReadRunnerFactory = () => McpReadRunnerPort;
