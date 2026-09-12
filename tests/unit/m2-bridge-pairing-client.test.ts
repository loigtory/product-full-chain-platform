import { describe, expect, it, vi } from 'vitest';

import { pairLocalBridge } from '../../apps/bridge/src/pairing-client.ts';
import { loadBridgeRuntimeConfig } from '../../apps/bridge/src/runtime-config.ts';

const credential = 'CODEx_TEST_M2_BRIDGE_CREDENTIAL_LONG_ENOUGH';

describe('M2 local Bridge pairing client', () => {
  it('exchanges the short-lived code without sending local paths and persists the credential once', async () => {
    const persistCredential = vi.fn(async () => undefined);
    const fetcher = vi.fn(
      async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(JSON.stringify(body)).not.toContain('C:\\CODEx_TEST_M2');
        return new Response(
          JSON.stringify({
            bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
            teamId: 'CODEx_TEST_M2_TEAM_001',
            credential,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      },
    );

    await expect(
      pairLocalBridge(
        {
          pairingCode: 'CODEx_TEST_M2_PAIRING_CODE_LONG_ENOUGH',
          serverUrl: 'http://127.0.0.1:3001',
          credentialFile: 'C:\\CODEx_TEST_M2\\.local\\bridge.json',
          versions: {
            bridgeVersion: '0.0.0',
            nodeVersion: 'v24.20.0',
            codexVersion: '0.148.0',
            zedVersion: null,
          },
          registry: {
            workspaceRoot: 'C:\\CODEx_TEST_M2',
            skillRoot: 'C:\\CODEx_TEST_M2\\skills',
            workspaces: [
              {
                id: 'CODEx_TEST_M2_WORKSPACE_001',
                path: 'C:\\CODEx_TEST_M2\\repo',
                verified: true,
                repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
                allowedRelativePath: 'docs/requirements',
              },
            ],
            skills: [],
          },
        },
        {
          fetcher,
          persistCredential,
          prepareCredentialTarget: vi.fn(async () => undefined),
          workspaceInspector: {
            currentGitBaseline: vi.fn(
              async () => '0123456789abcdef0123456789abcdef01234567',
            ),
            repositoryFingerprint: vi.fn(
              async () => `sha256:${'b'.repeat(64)}`,
            ),
          },
        },
      ),
    ).resolves.toEqual({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      teamId: 'CODEx_TEST_M2_TEAM_001',
    });
    expect(persistCredential).toHaveBeenCalledWith(
      'C:\\CODEx_TEST_M2\\.local\\bridge.json',
      {
        bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
        credential,
        serverUrl: 'http://127.0.0.1:3001',
      },
    );
  });

  it('fails before exchanging the pairing code when the credential target is occupied', async () => {
    const fetcher = vi.fn();

    await expect(
      pairLocalBridge(
        {
          pairingCode: 'CODEx_TEST_M2_PAIRING_CODE_LONG_ENOUGH',
          serverUrl: 'http://127.0.0.1:3001',
          credentialFile: 'C:\\CODEx_TEST_M2\\.local\\bridge.json',
          versions: {
            bridgeVersion: '0.0.0',
            nodeVersion: 'v24.20.0',
            codexVersion: '0.148.0',
            zedVersion: null,
          },
          registry: {
            workspaceRoot: 'C:\\CODEx_TEST_M2',
            skillRoot: 'C:\\CODEx_TEST_M2\\skills',
            workspaces: [
              {
                id: 'CODEx_TEST_M2_WORKSPACE_001',
                path: 'C:\\CODEx_TEST_M2\\repo',
                verified: true,
                repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
                allowedRelativePath: 'docs/requirements',
              },
            ],
            skills: [],
          },
        },
        {
          fetcher,
          prepareCredentialTarget: vi.fn(async () => {
            throw new Error('BRIDGE_CREDENTIAL_FILE_EXISTS');
          }),
        },
      ),
    ).rejects.toThrow('BRIDGE_CREDENTIAL_FILE_EXISTS');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails before exchange when the live repository fingerprint drifts', async () => {
    const fetcher = vi.fn();

    await expect(
      pairLocalBridge(
        {
          pairingCode: 'CODEx_TEST_M2_PAIRING_CODE_LONG_ENOUGH',
          serverUrl: 'http://127.0.0.1:3001',
          credentialFile: 'C:\\CODEx_TEST_M2\\.local\\bridge.json',
          versions: {
            bridgeVersion: '0.0.0',
            nodeVersion: 'v24.20.0',
            codexVersion: '0.153.4',
            zedVersion: null,
          },
          registry: {
            workspaceRoot: 'C:\\CODEx_TEST_M2',
            skillRoot: 'C:\\CODEx_TEST_M2\\skills',
            workspaces: [
              {
                id: 'CODEx_TEST_M2_WORKSPACE_001',
                path: 'C:\\CODEx_TEST_M2\\repo',
                verified: true,
                repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
                allowedRelativePath: 'docs/requirements',
              },
            ],
            skills: [],
          },
        },
        {
          fetcher,
          prepareCredentialTarget: vi.fn(async () => undefined),
          workspaceInspector: {
            currentGitBaseline: vi.fn(
              async () => '0123456789abcdef0123456789abcdef01234567',
            ),
            repositoryFingerprint: vi.fn(
              async () => `sha256:${'c'.repeat(64)}`,
            ),
          },
        },
      ),
    ).rejects.toThrow('BRIDGE_WORKSPACE_FINGERPRINT_DRIFT');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('loads runtime credentials only from the ignored local credential file', async () => {
    const readText = vi.fn(async () =>
      JSON.stringify({
        bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
        credential,
        serverUrl: 'http://127.0.0.1:3001',
      }),
    );

    await expect(
      loadBridgeRuntimeConfig(
        {
          PFC_BRIDGE_CREDENTIAL_FILE:
            'C:\\CODEx_TEST_M2\\.local\\bridge\\credential.json',
          PFC_BRIDGE_REGISTRY_FILE:
            'C:\\CODEx_TEST_M2\\.local\\bridge\\registry.json',
          PFC_CODEX_BINARY: 'C:\\CODEx_TEST_M2\\bin\\codex.exe',
        },
        'C:\\CODEx_TEST_M2',
        readText,
      ),
    ).resolves.toMatchObject({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      credential,
      serverUrl: 'http://127.0.0.1:3001',
      runTimeoutMs: 180_000,
    });
  });

  it('rejects an unbounded or prematurely short Codex run timeout', async () => {
    const readText = vi.fn(async () =>
      JSON.stringify({
        bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
        credential,
        serverUrl: 'http://127.0.0.1:3001',
      }),
    );
    const env = {
      PFC_BRIDGE_CREDENTIAL_FILE:
        'C:\\CODEx_TEST_M2\\.local\\bridge\\credential.json',
      PFC_BRIDGE_REGISTRY_FILE:
        'C:\\CODEx_TEST_M2\\.local\\bridge\\registry.json',
      PFC_CODEX_BINARY: 'C:\\CODEx_TEST_M2\\bin\\codex.exe',
    };

    await expect(
      loadBridgeRuntimeConfig(
        { ...env, PFC_CODEX_RUN_TIMEOUT_MS: '29999' },
        'C:\\CODEx_TEST_M2',
        readText,
      ),
    ).rejects.toThrow('BRIDGE_CONFIG_CODEX_RUN_TIMEOUT_INVALID');
    await expect(
      loadBridgeRuntimeConfig(
        { ...env, PFC_CODEX_RUN_TIMEOUT_MS: '600001' },
        'C:\\CODEx_TEST_M2',
        readText,
      ),
    ).rejects.toThrow('BRIDGE_CONFIG_CODEX_RUN_TIMEOUT_INVALID');
  });
});
