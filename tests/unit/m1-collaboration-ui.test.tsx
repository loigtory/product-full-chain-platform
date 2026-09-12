// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactCatalogPage } from '../../apps/web/src/artifacts/ArtifactCatalogPage.tsx';
import { artifactApi } from '../../apps/web/src/artifacts/api.ts';
import { identityApi } from '../../apps/web/src/identity/api.ts';
import { LoginPage } from '../../apps/web/src/identity/LoginPage.tsx';
import { teamAdminApi } from '../../apps/web/src/team-admin/api.ts';
import { TeamAdminPage } from '../../apps/web/src/team-admin/TeamAdminPage.tsx';
import type { CurrentActorDto } from '../../packages/contracts/src/index.ts';

const actor: CurrentActorDto = {
  actorId: 'CODEx_TEST_M1_UI_ACCOUNT',
  loginName: 'codex.ui',
  displayName: '产品负责人',
  roles: ['TEAM_ADMIN'],
  teams: [
    {
      id: 'CODEx_TEST_M1_UI_TEAM',
      name: '产品平台组',
      role: 'TEAM_ADMIN',
      status: 'ACTIVE',
    },
  ],
  currentTeamId: 'CODEx_TEST_M1_UI_TEAM',
  csrfToken: 'CODEx_TEST_M1_UI_CSRF',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('M1 collaboration UI', () => {
  it('submits application credentials without persisting the password', async () => {
    const onAuthenticated = vi.fn();
    vi.spyOn(identityApi, 'login').mockResolvedValue({
      actor,
      expiresAt: '2026-09-06T12:00:00.000Z',
    });
    render(<LoginPage onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText('账号'), {
      target: { value: 'codex.ui' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'CODEx secure local 42' },
    });
    fireEvent.click(screen.getByRole('button', { name: '进入工作台' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(actor));
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('renders team member roles and keeps unverified workspaces explicit', async () => {
    vi.spyOn(teamAdminApi, 'listTeams').mockResolvedValue([
      {
        id: actor.teams[0]!.id,
        name: actor.teams[0]!.name,
        ownerAccountId: actor.actorId,
        status: 'ACTIVE',
        rowVersion: 0,
        createdAt: '2026-09-06T05:00:00.000Z',
        updatedAt: '2026-09-06T05:00:00.000Z',
      },
    ]);
    vi.spyOn(teamAdminApi, 'listMembers').mockResolvedValue([
      {
        accountId: actor.actorId,
        loginName: actor.loginName,
        displayName: actor.displayName,
        role: 'TEAM_ADMIN',
        status: 'ACTIVE',
        joinedAt: '2026-09-06T05:00:00.000Z',
      },
    ]);
    vi.spyOn(teamAdminApi, 'listWorkspaces').mockResolvedValue([
      {
        id: 'CODEx_TEST_M1_UI_WORKSPACE',
        teamId: actor.teams[0]!.id,
        name: '产品全链路仓库',
        repositoryLabel: 'product-full-chain-platform',
        repositoryFingerprint: 'sha256:synthetic',
        status: 'ACTIVE',
        verificationStatus: 'UNVERIFIED',
        rowVersion: 0,
        createdAt: '2026-09-06T05:00:00.000Z',
        updatedAt: '2026-09-06T05:00:00.000Z',
      },
    ]);

    render(<TeamAdminPage actor={actor} onLogout={vi.fn()} />);
    expect(await screen.findByText('codex.ui')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '仓库工作区' }));
    expect(await screen.findByText('UNVERIFIED')).toBeTruthy();
    expect(screen.getByText(/M2 Bridge 接入前不读取本机文件/)).toBeTruthy();
  });

  it('blocks a non-canonical workspace fingerprint with an actionable error', async () => {
    vi.spyOn(teamAdminApi, 'listTeams').mockResolvedValue([
      {
        id: actor.teams[0]!.id,
        name: actor.teams[0]!.name,
        ownerAccountId: actor.actorId,
        status: 'ACTIVE',
        rowVersion: 0,
        createdAt: '2026-09-06T05:00:00.000Z',
        updatedAt: '2026-09-06T05:00:00.000Z',
      },
    ]);
    vi.spyOn(teamAdminApi, 'listMembers').mockResolvedValue([]);
    vi.spyOn(teamAdminApi, 'listWorkspaces').mockResolvedValue([]);
    const createWorkspace = vi
      .spyOn(teamAdminApi, 'createWorkspace')
      .mockResolvedValue({
        id: 'CODEx_TEST_M1_UI_NEW_WORKSPACE',
        teamId: actor.teams[0]!.id,
        name: '不会创建的工作区',
        repositoryLabel: 'product-full-chain',
        repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
        status: 'ACTIVE',
        verificationStatus: 'UNVERIFIED',
        rowVersion: 0,
        createdAt: '2026-09-06T05:00:00.000Z',
        updatedAt: '2026-09-06T05:00:00.000Z',
      });

    render(<TeamAdminPage actor={actor} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '仓库工作区' }));

    const fingerprint = await screen.findByLabelText('仓库指纹');
    expect(fingerprint.getAttribute('pattern')).toBe('sha256:[0-9a-f]{64}');
    expect(screen.getByText(/sha256: 加 64 位小写十六进制字符/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('工作区名称'), {
      target: { value: 'CODEx_TEST 非法指纹工作区' },
    });
    fireEvent.change(screen.getByLabelText('仓库标识'), {
      target: { value: 'product-full-chain' },
    });
    fireEvent.change(fingerprint, {
      target: { value: `sha256:${'A'.repeat(64)}` },
    });
    fireEvent.submit(fingerprint.closest('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('仓库指纹格式不正确');
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('renders the authoritative artifact version and append action', async () => {
    vi.spyOn(artifactApi, 'list').mockResolvedValue([
      {
        id: 'CODEx_TEST_M1_UI_ARTIFACT',
        requirementId: 'CODEx_TEST_M1_UI_REQ',
        capId: 'CAP-PFC-02',
        stage: 'G1',
        artifactType: 'PRD',
        title: '需求规格',
        status: 'ACTIVE',
        currentVersionId: 'CODEx_TEST_M1_UI_VERSION',
        rowVersion: 0,
        versions: [
          {
            id: 'CODEx_TEST_M1_UI_VERSION',
            artifactId: 'CODEx_TEST_M1_UI_ARTIFACT',
            versionLabel: 'V0.1',
            sourceType: 'WORKSPACE_RELATIVE',
            sourceRef: 'docs/spec.md',
            contentHash: 'sha256:11111111111111111111111111111111',
            sensitivity: 'INTERNAL',
            createdBy: actor.actorId,
            createdAt: '2026-09-06T05:00:00.000Z',
          },
        ],
        createdAt: '2026-09-06T05:00:00.000Z',
        updatedAt: '2026-09-06T05:00:00.000Z',
      },
    ]);

    render(
      <ArtifactCatalogPage
        actor={actor}
        onLogout={vi.fn()}
        requirementId="CODEx_TEST_M1_UI_REQ"
      />,
    );
    expect(await screen.findByText('需求规格')).toBeTruthy();
    expect(screen.getAllByText('V0.1')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '追加版本' })).toBeTruthy();
  });
});
