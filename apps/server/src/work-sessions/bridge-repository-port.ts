import type { ActionProposalDto } from '@pfc/contracts';
import type {
  ProductWorkTurnCommand,
  ProductWorkTurnContext,
  ProductWorkTurnEvent,
} from '@pfc/protocol';

export interface ProductWorkTurnBridgeAuthPort {
  authenticateMessage(input: {
    bridgeId: string;
    credentialDigest: string;
    messageId: string;
    nonce: string;
    sentAt: string;
    receivedAt: string;
  }): Promise<boolean>;
}

export interface ProductWorkTurnBridgeRepositoryPort {
  leaseNextProductWorkTurnCommand(input: {
    bridgeId: string;
    leasedAt: string;
    leaseUntil: string;
  }): Promise<ProductWorkTurnCommand | null>;
  readLeasedProductWorkTurnContext(input: {
    bridgeId: string;
    commandId: string;
    readAt: string;
  }): Promise<ProductWorkTurnContext | null>;
  appendProductWorkTurnBridgeEvent(input: {
    bridgeId: string;
    commandId: string;
    sessionId: string;
    turnId: string;
    event: ProductWorkTurnEvent;
    receivedAt: string;
    proposal?: ActionProposalDto;
  }): Promise<
    | { status: 'APPENDED' | 'DUPLICATE' | 'COMMAND_INVALID' }
    | { status: 'SEQUENCE_GAP'; nextExpectedSequence: number }
  >;
  acknowledgeProductWorkTurnCommand(input: {
    bridgeId: string;
    commandId: string;
    sessionId: string;
    turnId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
    reasonCode?: string;
    threadId?: string;
    externalTurnId?: string;
    acknowledgedAt: string;
  }): Promise<'ACKNOWLEDGED' | 'IGNORED'>;
}
