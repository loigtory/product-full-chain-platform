import { describe, expect, it, vi } from 'vitest';

import {
  CodexWorkspaceWriteSession,
  type AppServerRequestEnvelope,
  type AppServerRpc,
} from '../../packages/codex-adapter/src/index.ts';

function harness() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const responses: Array<{ id: string | number; result: unknown }> = [];
  const notificationListeners: Array<(message: unknown) => void> = [];
  const requestListeners: Array<
    (message: AppServerRequestEnvelope) => void | Promise<void>
  > = [];
  const rpc: AppServerRpc = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'initialize' || method === 'skills/extraRoots/set')
        return {};
      if (method === 'skills/list') {
        return {
          data: [
            {
              cwd: 'C:\\CODEx_TEST_M2_R2\\capsule',
              skills: [
                {
                  name: 'pfc-controlled-artifact-edit',
                  path: 'C:\\CODEx_TEST_M2_R2\\skill\\SKILL.md',
                  enabled: true,
                },
              ],
            },
          ],
        };
      }
      if (method === 'thread/start')
        return { thread: { id: 'thread-write-1' } };
      if (method === 'turn/start') return { turn: { id: 'turn-write-1' } };
      if (method === 'turn/interrupt') return {};
      if (method === 'thread/read') {
        return {
          thread: {
            turns: [{ id: 'turn-write-1', status: 'inProgress' }],
          },
        };
      }
      throw new Error(`UNEXPECTED_METHOD:${method}`);
    },
    notify: vi.fn(),
    onNotification(listener) {
      notificationListeners.push(listener);
      return () =>
        notificationListeners.splice(
          notificationListeners.indexOf(listener),
          1,
        );
    },
    onServerRequest(listener) {
      requestListeners.push(listener);
      return () =>
        requestListeners.splice(requestListeners.indexOf(listener), 1);
    },
    respond(id, result) {
      responses.push({ id, result });
    },
    close: vi.fn(async () => undefined),
  };
  return { calls, responses, notificationListeners, requestListeners, rpc };
}

const scope = {
  allowedRelativePaths: ['docs/requirements/acceptance.md'],
  allowedActions: ['EDIT_FILES', 'FORMAT'] as const,
  networkAccess: false as const,
  maxChangedFiles: 1,
  maxChangedBytes: 20_000,
  expiresAt: '2026-09-07T00:00:00.000Z',
};

async function startSession(current: ReturnType<typeof harness>) {
  return CodexWorkspaceWriteSession.start(
    current.rpc,
    {
      workspacePath: 'C:\\CODEx_TEST_M2_R2\\capsule',
      objective: 'Update the approved acceptance artifact only.',
      skill: {
        name: 'pfc-controlled-artifact-edit',
        path: 'C:\\CODEx_TEST_M2_R2\\skill\\SKILL.md',
      },
      runScope: scope,
    },
    vi.fn(async () => undefined),
    vi.fn(async () => undefined),
  );
}

describe('M2 Codex workspace-write session', () => {
  it('starts only in the isolated capsule with network disabled', async () => {
    const current = harness();
    const session = await startSession(current);

    expect(current.calls[3]?.params).toMatchObject({
      cwd: 'C:\\CODEx_TEST_M2_R2\\capsule',
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    });
    expect(current.calls[4]?.params).toMatchObject({
      cwd: 'C:\\CODEx_TEST_M2_R2\\capsule',
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: ['C:\\CODEx_TEST_M2_R2\\capsule'],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      },
    });
    await session.close();
  });

  it('holds a file approval and resolves the original JSON-RPC request once', async () => {
    const current = harness();
    const approvals: unknown[] = [];
    const session = await CodexWorkspaceWriteSession.start(
      current.rpc,
      {
        workspacePath: 'C:\\CODEx_TEST_M2_R2\\capsule',
        objective: 'Update the approved acceptance artifact only.',
        skill: {
          name: 'pfc-controlled-artifact-edit',
          path: 'C:\\CODEx_TEST_M2_R2\\skill\\SKILL.md',
        },
        runScope: scope,
      },
      vi.fn(async () => undefined),
      async (approval) => {
        approvals.push(approval);
      },
    );
    await current.requestListeners[0]?.({
      id: 42,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-write-1',
        turnId: 'turn-write-1',
        itemId: 'item-write-1',
        startedAtMs: 1,
        grantRoot: 'C:\\CODEx_TEST_M2_R2\\capsule\\docs\\requirements',
      },
    });

    expect(approvals).toEqual([
      expect.objectContaining({
        appServerRequestId: 'number:42',
        kind: 'FILE_CHANGE',
        threadId: 'thread-write-1',
        outsideCapsule: false,
        requestedScope: expect.objectContaining({ networkAccess: false }),
      }),
    ]);
    expect(current.responses).toEqual([]);
    await session.resolveApproval({
      appServerRequestId: 'number:42',
      approvalKind: 'FILE_CHANGE',
      decision: 'accept',
    });
    expect(current.responses).toEqual([
      { id: 42, result: { decision: 'accept' } },
    ]);
    await expect(
      session.resolveApproval({
        appServerRequestId: 'number:42',
        approvalKind: 'FILE_CHANGE',
        decision: 'accept',
      }),
    ).rejects.toThrow('APP_SERVER_APPROVAL_NOT_PENDING');
    await session.close();
  });

  it('grants only capsule-relative file permissions and never network access', async () => {
    const current = harness();
    const session = await startSession(current);
    await current.requestListeners[0]?.({
      id: 'permission-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-write-1',
        turnId: 'turn-write-1',
        itemId: 'item-write-2',
        startedAtMs: 1,
        environmentId: null,
        cwd: 'C:\\CODEx_TEST_M2_R2\\capsule',
        reason: null,
        permissions: {
          network: { enabled: true },
          fileSystem: {
            read: null,
            write: [
              'C:\\CODEx_TEST_M2_R2\\capsule\\docs\\requirements\\acceptance.md',
            ],
          },
        },
      },
    });
    await session.resolveApproval({
      appServerRequestId: 'string:permission-1',
      approvalKind: 'PERMISSIONS',
      decision: 'accept',
      grantedRelativePaths: ['docs/requirements/acceptance.md'],
    });

    expect(current.responses).toEqual([
      {
        id: 'permission-1',
        result: {
          permissions: {
            fileSystem: {
              read: null,
              write: [
                'C:\\CODEx_TEST_M2_R2\\capsule\\docs\\requirements\\acceptance.md',
              ],
            },
          },
          scope: 'turn',
          strictAutoReview: true,
        },
      },
    ]);
    await session.interrupt({
      threadId: 'thread-write-1',
      turnId: 'turn-write-1',
    });
    await expect(session.verify()).resolves.toMatchObject({
      status: 'RUNNING',
      threadId: 'thread-write-1',
      turnId: 'turn-write-1',
    });
    await session.close();
  });
});
