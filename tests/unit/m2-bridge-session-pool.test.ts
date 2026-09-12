import { describe, expect, it, vi } from 'vitest';

import {
  BridgeSessionPool,
  type BridgeManagedSession,
} from '../../apps/bridge/src/session-pool.ts';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function managedSession() {
  const completion = deferred<{
    threadId: string;
    turnId: string;
    status: 'SUCCEEDED';
  }>();
  const session: BridgeManagedSession = {
    completion: completion.promise,
    advanceEventCursor: vi.fn(),
    resolveApproval: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    verify: vi.fn(async () => ({ status: 'RUNNING' as const })),
    close: vi.fn(async () => undefined),
  };
  return { session, completion };
}

describe('M2 Bridge session pool', () => {
  it('bounds active run sessions and releases capacity on completion', async () => {
    const pool = new BridgeSessionPool({ maxActiveSessions: 3 });
    const sessions = [managedSession(), managedSession(), managedSession()];
    for (const [index, current] of sessions.entries()) {
      await pool.start({
        runId: `CODEx_TEST_M2_R2_RUN_00${index}`,
        executionInstanceId: `CODEx_TEST_M2_R2_EXECUTION_00${index}`,
        create: async () => current.session,
      });
    }
    expect(pool.activeCount).toBe(3);
    await expect(
      pool.start({
        runId: 'CODEx_TEST_M2_R2_RUN_004',
        executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_004',
        create: async () => managedSession().session,
      }),
    ).rejects.toThrow('BRIDGE_SESSION_CAPACITY_EXCEEDED');

    sessions[0]?.completion.resolve({
      threadId: 'thread-1',
      turnId: 'turn-1',
      status: 'SUCCEEDED',
    });
    await sessions[0]?.session.completion;
    await Promise.resolve();
    expect(pool.activeCount).toBe(2);
  });

  it('routes approvals, interrupts, and verification to the exact execution only', async () => {
    const pool = new BridgeSessionPool({ cancellationGraceMs: 1 });
    const current = managedSession();
    await pool.start({
      runId: 'CODEx_TEST_M2_R2_RUN_010',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_010',
      create: async () => current.session,
    });

    await pool.resolveApproval({
      runId: 'CODEx_TEST_M2_R2_RUN_010',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_010',
      appServerRequestId: '42',
      approvalKind: 'FILE_CHANGE',
      decision: 'accept',
      afterSequence: 8,
    });
    await expect(
      pool.verify({
        runId: 'CODEx_TEST_M2_R2_RUN_010',
        executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_010',
      }),
    ).resolves.toEqual({ status: 'RUNNING' });
    await pool.interrupt({
      runId: 'CODEx_TEST_M2_R2_RUN_010',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_010',
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    expect(current.session.resolveApproval).toHaveBeenCalledOnce();
    expect(current.session.advanceEventCursor).toHaveBeenCalledWith(8);
    expect(current.session.interrupt).toHaveBeenCalledOnce();

    await expect(
      pool.interrupt({
        runId: 'CODEx_TEST_M2_R2_RUN_010',
        executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_STALE',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ).rejects.toThrow('BRIDGE_SESSION_NOT_FOUND');
  });

  it('interrupts and closes every owned session during bridge revocation', async () => {
    const pool = new BridgeSessionPool();
    const first = managedSession();
    const second = managedSession();
    await pool.start({
      runId: 'CODEx_TEST_M2_R2_RUN_020',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_020',
      create: async () => first.session,
    });
    await pool.start({
      runId: 'CODEx_TEST_M2_R2_RUN_021',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_021',
      create: async () => second.session,
    });

    await pool.revoke();

    expect(first.session.interrupt).toHaveBeenCalledWith({
      reason: 'BRIDGE_REVOKED',
    });
    expect(second.session.interrupt).toHaveBeenCalledWith({
      reason: 'BRIDGE_REVOKED',
    });
    expect(first.session.close).toHaveBeenCalledOnce();
    expect(second.session.close).toHaveBeenCalledOnce();
    expect(pool.activeCount).toBe(0);
  });

  it('force closes only the owned session when interrupt has no terminal evidence', async () => {
    const pool = new BridgeSessionPool({ cancellationGraceMs: 1 });
    const current = managedSession();
    await pool.start({
      runId: 'CODEx_TEST_M2_R2_RUN_030',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_030',
      create: async () => current.session,
    });

    await pool.interrupt({
      runId: 'CODEx_TEST_M2_R2_RUN_030',
      executionInstanceId: 'CODEx_TEST_M2_R2_EXECUTION_030',
    });

    expect(current.session.interrupt).toHaveBeenCalledOnce();
    expect(current.session.close).toHaveBeenCalledOnce();
    expect(pool.activeCount).toBe(0);
  });
});
