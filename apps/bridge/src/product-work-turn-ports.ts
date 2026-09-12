import type {
  ProductWorkTurnCommand,
  ProductWorkTurnContext,
  ProductWorkTurnEvent,
} from '../../../packages/protocol/src/index.ts';
import type {
  ProductWorkTurnRunnerEvent,
  ProductWorkTurnSessionResult,
} from '../../../packages/codex-adapter/src/index.ts';

export interface ProductWorkTurnManagedSession {
  completion: Promise<ProductWorkTurnSessionResult>;
  interrupt(): Promise<void>;
  verify(): Promise<{
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
    threadId: string;
    turnId: string;
  }>;
  close(): Promise<void>;
}

export interface ProductWorkTurnGatewayPort {
  claimNext(input: {
    bridgeId: string;
    leaseSeconds: number;
  }): Promise<unknown | null>;
  fetchContext(input: {
    bridgeId: string;
    command: ProductWorkTurnCommand;
  }): Promise<unknown>;
  submitEvent(input: {
    bridgeId: string;
    commandId: string;
    sessionId: string;
    turnId: string;
    event: ProductWorkTurnEvent;
  }): Promise<
    | { status: 'APPENDED' | 'DUPLICATE' }
    | { status: 'SEQUENCE_GAP'; nextExpectedSequence: number }
  >;
  acknowledge(input: {
    bridgeId: string;
    commandId: string;
    sessionId: string;
    turnId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
    reasonCode?: string;
    threadId?: string;
    externalTurnId?: string;
    acknowledgedAt: string;
  }): Promise<void>;
}

export interface ProductWorkTurnSkillRegistryPort {
  resolveSkill(skillReleaseId: string): Promise<{
    name: string;
    path: string;
    contentHash: string;
    enabled: boolean;
  } | null>;
}

export type ProductWorkTurnRunnerFactory = (
  input: {
    workspacePath: string;
    objective: string;
    skill: { name: string; path: string };
  },
  onEvent: (event: ProductWorkTurnRunnerEvent) => void | Promise<void>,
) => Promise<ProductWorkTurnManagedSession>;

export type { ProductWorkTurnContext };
