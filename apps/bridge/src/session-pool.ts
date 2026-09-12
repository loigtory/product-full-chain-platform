import type { AgentApprovalKind } from '../../../packages/contracts/src/index.ts';

import type { BridgeRunnerResult } from './ports.ts';

export type BridgeSessionVerification = Readonly<{
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  threadId?: string;
  turnId?: string;
}>;

export interface BridgeManagedSession {
  completion: Promise<BridgeRunnerResult>;
  advanceEventCursor(afterSequence: number): void;
  resolveApproval(input: {
    appServerRequestId: string;
    approvalKind: AgentApprovalKind;
    decision: 'accept' | 'decline' | 'cancel';
    grantedRelativePaths?: readonly string[];
  }): Promise<void>;
  interrupt(input: {
    threadId?: string;
    turnId?: string;
    reason?: 'BRIDGE_REVOKED';
  }): Promise<void>;
  verify(): Promise<BridgeSessionVerification>;
  close(): Promise<void>;
}

type SessionEntry = Readonly<{
  runId: string;
  executionInstanceId: string;
  session: BridgeManagedSession;
}>;

function sessionKey(runId: string, executionInstanceId: string): string {
  return `${runId}\u0000${executionInstanceId}`;
}

export class BridgeSessionPool {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly maxActiveSessions: number;
  private readonly cancellationGraceMs: number;

  constructor(
    input: { maxActiveSessions?: number; cancellationGraceMs?: number } = {},
  ) {
    this.maxActiveSessions = Math.min(
      Math.max(input.maxActiveSessions ?? 3, 1),
      3,
    );
    this.cancellationGraceMs = Math.min(
      Math.max(input.cancellationGraceMs ?? 5_000, 1),
      5_000,
    );
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  private find(input: {
    runId: string;
    executionInstanceId: string;
  }): SessionEntry {
    const entry = this.sessions.get(
      sessionKey(input.runId, input.executionInstanceId),
    );
    if (!entry) throw new Error('BRIDGE_SESSION_NOT_FOUND');
    return entry;
  }

  async start(input: {
    runId: string;
    executionInstanceId: string;
    create: () => Promise<BridgeManagedSession>;
  }): Promise<BridgeManagedSession> {
    const key = sessionKey(input.runId, input.executionInstanceId);
    if (this.sessions.has(key)) throw new Error('BRIDGE_SESSION_DUPLICATE');
    if (this.sessions.size >= this.maxActiveSessions) {
      throw new Error('BRIDGE_SESSION_CAPACITY_EXCEEDED');
    }
    const session = await input.create();
    const entry = {
      runId: input.runId,
      executionInstanceId: input.executionInstanceId,
      session,
    };
    this.sessions.set(key, entry);
    void session.completion.then(
      () => this.release(key, entry),
      () => this.release(key, entry),
    );
    return session;
  }

  private async release(key: string, expected: SessionEntry): Promise<void> {
    if (this.sessions.get(key) !== expected) return;
    this.sessions.delete(key);
    await expected.session.close().catch(() => undefined);
  }

  async resolveApproval(input: {
    runId: string;
    executionInstanceId: string;
    appServerRequestId: string;
    approvalKind: AgentApprovalKind;
    decision: 'accept' | 'decline' | 'cancel';
    grantedRelativePaths?: readonly string[];
    afterSequence: number;
  }): Promise<void> {
    const entry = this.find(input);
    entry.session.advanceEventCursor(input.afterSequence);
    await entry.session.resolveApproval({
      appServerRequestId: input.appServerRequestId,
      approvalKind: input.approvalKind,
      decision: input.decision,
      grantedRelativePaths: input.grantedRelativePaths,
    });
  }

  async interrupt(input: {
    runId: string;
    executionInstanceId: string;
    threadId?: string;
    turnId?: string;
  }): Promise<void> {
    const entry = this.find(input);
    await entry.session.interrupt({
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
    });
    let timer: NodeJS.Timeout | undefined;
    const completed = await Promise.race([
      entry.session.completion.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), this.cancellationGraceMs);
      }),
    ]);
    clearTimeout(timer);
    if (
      !completed &&
      this.sessions.get(sessionKey(input.runId, input.executionInstanceId)) ===
        entry
    ) {
      this.sessions.delete(sessionKey(input.runId, input.executionInstanceId));
      await entry.session.close();
    }
  }

  async verify(input: {
    runId: string;
    executionInstanceId: string;
  }): Promise<BridgeSessionVerification> {
    return this.find(input).session.verify();
  }

  async revoke(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(
      entries.map(async ({ session }) => {
        await session
          .interrupt({ reason: 'BRIDGE_REVOKED' })
          .catch(() => undefined);
        await session.close().catch(() => undefined);
      }),
    );
  }
}
