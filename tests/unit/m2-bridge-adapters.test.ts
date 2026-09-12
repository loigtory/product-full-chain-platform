import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  createBridgeCapabilitySnapshot,
  GitWorkspaceInspector,
  HttpBridgeGateway,
  LocalBridgeRegistry,
  LocalToolCapabilityInspector,
} from '../../apps/bridge/src/index.ts';

const command = {
  commandId: 'CODEx_TEST_M2_COMMAND_001',
  runId: 'CODEx_TEST_M2_RUN_001',
  commandType: 'START_READ_ONLY_RUN',
  leaseUntil: '2026-09-06T06:00:30.000Z',
  attempt: 1,
  afterSequence: 2,
  payload: {
    requirementId: 'CODEx_TEST_M2_REQUIREMENT_001',
    baselineId: 'CODEx_TEST_M2_BASELINE_001',
    workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
    gitBaseline: '0123456789abcdef0123456789abcdef01234567',
    skillReleaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
    skillContentHash: `sha256:${'a'.repeat(64)}`,
    artifactVersionId: 'CODEx_TEST_M2_ARTIFACT_VERSION_001',
    artifactSourceRef: 'standards/requirement.md',
    artifactContentHash: `sha256:${'b'.repeat(64)}`,
    objectiveKey: 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK',
    accessMode: 'READ_ONLY',
  },
};

describe('M2 Bridge adapters', () => {
  it('uses fixed loopback endpoints and keeps credentials out of request bodies', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith('/bridge/v1/capability-snapshots')) {
        return new Response(null, { status: 202 });
      }
      return new Response(JSON.stringify(command), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const gateway = new HttpBridgeGateway({
      baseUrl: 'http://127.0.0.1:3001',
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      credential: 'CODEx_TEST_M2_LOCAL_CREDENTIAL_001',
      fetcher,
      now: () => '2026-09-06T06:00:00.000Z',
      idFactory: () => 'CODEx_TEST_M2_MESSAGE_001',
    });

    await expect(
      gateway.claimNext({
        bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
        leaseSeconds: 30,
      }),
    ).resolves.toEqual(command);
    expect(requests[0]?.url).toBe(
      'http://127.0.0.1:3001/bridge/v1/commands/next',
    );
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: 'Bridge CODEx_TEST_M2_LOCAL_CREDENTIAL_001',
      'x-pfc-protocol-version': 'pfc-bridge/1',
    });
    expect(requests[0]?.init.body).toBeUndefined();

    const snapshot = {
      snapshotVersion: 'pfc-bridge-capabilities/1' as const,
      capturedAt: '2026-09-06T06:00:00.000Z',
      runtime: {
        nodeVersion: 'v24.20.0',
        codexAppServer: 'AVAILABLE' as const,
        zedCli: 'UNVERIFIED' as const,
      },
      workspaces: [
        {
          workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
          gitBaseline: '0123456789abcdef0123456789abcdef01234567',
        },
      ],
      skills: [
        {
          releaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
          contentHash: `sha256:${'a'.repeat(64)}`,
        },
      ],
    };
    await gateway.reportCapabilities({
      bridgeId: 'CODEx_TEST_M2_BRIDGE_001',
      snapshot,
    });
    expect(requests[1]?.url).toBe(
      'http://127.0.0.1:3001/bridge/v1/capability-snapshots',
    );
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual(snapshot);
    expect(String(requests[1]?.init.body)).not.toContain(
      'CODEx_TEST_M2_LOCAL_CREDENTIAL_001',
    );
  });

  it('resolves only allowlisted workspace and Skill paths and hashes Skill content', async () => {
    const skillText = '# CODEx TEST M2 read-only skill';
    const registry = new LocalBridgeRegistry(
      {
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
        skills: [
          {
            releaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
            name: 'pfc-readonly-artifact-check',
            path: 'C:\\CODEx_TEST_M2\\skills\\readonly\\SKILL.md',
            enabled: true,
          },
        ],
      },
      { readFile: vi.fn(async () => skillText) },
    );

    await expect(
      registry.resolveWorkspace('CODEx_TEST_M2_WORKSPACE_001'),
    ).resolves.toMatchObject({ verified: true });
    await expect(
      registry.resolveSkill('CODEx_TEST_M2_SKILL_RELEASE_001'),
    ).resolves.toMatchObject({
      name: 'pfc-readonly-artifact-check',
      contentHash: `sha256:${createHash('sha256').update(skillText).digest('hex')}`,
    });
    await expect(
      createBridgeCapabilitySnapshot({
        registry,
        workspaceInspector: {
          currentGitBaseline: vi.fn(async () => command.payload.gitBaseline),
        },
        capturedAt: '2026-09-06T06:00:00.000Z',
        nodeVersion: 'v24.20.0',
        codexAppServer: 'AVAILABLE',
        zedCli: 'UNVERIFIED',
        mcp: {
          state: 'AVAILABLE',
          configFingerprint: `sha256:${'c'.repeat(64)}`,
          servers: [
            {
              name: 'local-readonly',
              runtimeStatus: 'CONNECTED',
              authStatus: 'UNSUPPORTED',
              tools: [
                {
                  name: 'inspect',
                  inputSchemaHash: `sha256:${'d'.repeat(64)}`,
                  readOnlyHint: true,
                },
              ],
            },
          ],
        },
      }),
    ).resolves.toMatchObject({
      snapshotVersion: 'pfc-bridge-capabilities/2',
      mcp: {
        state: 'AVAILABLE',
        servers: [expect.objectContaining({ name: 'local-readonly' })],
      },
      workspaces: [
        {
          workspaceId: 'CODEx_TEST_M2_WORKSPACE_001',
          gitBaseline: command.payload.gitBaseline,
        },
      ],
      skills: [
        {
          releaseId: 'CODEx_TEST_M2_SKILL_RELEASE_001',
          contentHash: `sha256:${createHash('sha256').update(skillText).digest('hex')}`,
        },
      ],
    });
    await expect(
      registry.resolveWorkspace('CODEx_TEST_M2_UNKNOWN_WORKSPACE'),
    ).resolves.toBeNull();
    expect(
      () =>
        new LocalBridgeRegistry(
          {
            workspaceRoot: 'C:\\CODEx_TEST_M2',
            skillRoot: 'C:\\CODEx_TEST_M2\\skills',
            workspaces: [
              {
                id: 'CODEx_TEST_M2_ESCAPE',
                path: 'C:\\outside',
                verified: true,
                repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
                allowedRelativePath: 'docs/requirements',
              },
            ],
            skills: [],
          },
          { readFile: vi.fn(async () => '') },
        ),
    ).toThrowError('BRIDGE_WORKSPACE_PATH_OUTSIDE_ALLOWLIST');
  });

  it('reads the Git baseline with a fixed non-shell command', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: '0123456789abcdef0123456789abcdef01234567\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: 'https://github.com/loigtory/product-full-chain.git\n',
        stderr: '',
      });
    const inspector = new GitWorkspaceInspector({ execute });

    await expect(
      inspector.currentGitBaseline('C:\\CODEx_TEST_M2\\repo'),
    ).resolves.toBe('0123456789abcdef0123456789abcdef01234567');
    await expect(
      inspector.repositoryFingerprint('C:\\CODEx_TEST_M2\\repo'),
    ).resolves.toBe(
      `sha256:${createHash('sha256')
        .update('https://github.com/loigtory/product-full-chain.git')
        .digest('hex')}`,
    );
    expect(execute).toHaveBeenCalledWith(
      'git',
      ['-C', 'C:\\CODEx_TEST_M2\\repo', 'rev-parse', 'HEAD'],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
    expect(execute).toHaveBeenCalledWith(
      'git',
      ['-C', 'C:\\CODEx_TEST_M2\\repo', 'config', '--get', 'remote.origin.url'],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
  });

  it('probes Codex App Server with a fixed non-shell command', async () => {
    const execute = vi.fn(async () => ({
      stdout: 'Usage: codex app-server',
      stderr: '',
    }));
    const inspector = new LocalToolCapabilityInspector({ execute });

    await expect(
      inspector.codexAppServer('C:\\CODEx_TEST_M2\\bin\\codex.exe'),
    ).resolves.toBe('AVAILABLE');
    expect(execute).toHaveBeenCalledWith(
      'C:\\CODEx_TEST_M2\\bin\\codex.exe',
      ['app-server', '--help'],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        timeout: 5_000,
      }),
    );
  });
});
