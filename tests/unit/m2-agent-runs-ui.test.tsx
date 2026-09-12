// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentApprovalDto,
  AgentAuditEntryDto,
  AgentRunDto,
  AgentRunEventsResponse,
  BridgeRegistrationDto,
  CurrentActorDto,
  SkillReleaseDto,
} from '@pfc/contracts';

import {
  AgentRunsPage,
  type AgentRunsApi,
} from '../../apps/web/src/agent-runs/AgentRunsPage.tsx';

const actor: CurrentActorDto = {
  actorId: 'CODEx_TEST_M2_UI_ACCOUNT',
  loginName: 'codex.m2.ui',
  displayName: '产品负责人',
  roles: ['TEAM_ADMIN'],
  teams: [
    {
      id: 'CODEx_TEST_M2_UI_TEAM',
      name: '产品平台组',
      role: 'TEAM_ADMIN',
      status: 'ACTIVE',
    },
  ],
  currentTeamId: 'CODEx_TEST_M2_UI_TEAM',
  csrfToken: 'CODEx_TEST_M2_UI_CSRF',
};
const run: AgentRunDto = {
  id: 'CODEx_TEST_M2_UI_RUN_001',
  requirementId: 'CODEx_TEST_M2_UI_REQUIREMENT_001',
  baselineId: 'CODEx_TEST_M2_UI_BASELINE_001',
  workspaceId: 'CODEx_TEST_M2_UI_WORKSPACE_001',
  gitBaseline: '0123456789abcdef0123456789abcdef01234567',
  skillReleaseId: 'CODEx_TEST_M2_UI_SKILL_RELEASE_001',
  operation: 'ARTIFACT_CHECK',
  accessMode: 'READ_ONLY',
  status: 'SUCCEEDED',
  parentRunId: null,
  bridgeId: 'CODEx_TEST_M2_UI_BRIDGE_001',
  executionInstanceId: null,
  externalIds: {
    threadId: 'CODEx_TEST_M2_UI_THREAD_001',
    turnId: 'CODEx_TEST_M2_UI_TURN_001',
  },
  resultOutcome: 'PASS',
  runScope: null,
  runScopeHash: null,
  executionStartedAt: '2026-09-06T06:00:10.000Z',
  cancelRequestedAt: null,
  terminalAt: '2026-09-06T06:02:00.000Z',
  resultSummary: '只读产物检查已完成。',
  failureReason: null,
  rowVersion: 3,
  createdBy: actor.actorId,
  createdAt: '2026-09-06T06:00:00.000Z',
  updatedAt: '2026-09-06T06:02:00.000Z',
};
const skill: SkillReleaseDto = {
  id: run.skillReleaseId,
  skillKey: 'pfc-readonly-artifact-check',
  displayName: '只读产物检查',
  description: '核对当前需求产物结构与证据链。',
  sourceType: 'LOCAL_ALLOWLIST',
  logicalSource: 'project-skill:pfc-readonly-artifact-check',
  version: '2026.09.06-r1',
  contentHash: `sha256:${'a'.repeat(64)}`,
  license: null,
  compatibleHarnesses: ['codex-app-server/0.148'],
  requiredCapabilities: ['READ_WORKSPACE'],
  riskLevel: 'LOW',
  owner: '产品平台组',
  evaluationStatus: 'PASSED',
  enabledScopes: ['ARTIFACT_CHECK'],
  contextCost: null,
  status: 'ACTIVE',
  createdAt: run.createdAt,
};
const runEvents: AgentRunEventsResponse = {
  runId: run.id,
  afterSequence: 0,
  nextSequence: 3,
  items: [
    {
      id: 'CODEx_TEST_M2_UI_EVENT_001',
      runId: run.id,
      sequence: 1,
      eventType: 'RUN_QUEUED',
      summary: { accessMode: 'READ_ONLY' },
      sourceEventId: null,
      occurredAt: run.createdAt,
      receivedAt: run.createdAt,
    },
    {
      id: 'CODEx_TEST_M2_UI_EVENT_002',
      runId: run.id,
      sequence: 3,
      eventType: 'RESULT_RECORDED',
      summary: { status: 'completed' },
      sourceEventId: 'CODEx_TEST_M2_UI_SOURCE_001',
      occurredAt: run.updatedAt,
      receivedAt: run.updatedAt,
    },
  ],
};

const bridge: BridgeRegistrationDto = {
  id: 'CODEx_TEST_M2_UI_BRIDGE_001',
  teamId: actor.currentTeamId!,
  protocolVersion: 'pfc-bridge/1',
  bridgeVersion: '0.0.0',
  nodeVersion: 'v24.20.0',
  codexVersion: '0.148.0',
  zedVersion: null,
  status: 'ONLINE',
  lastHeartbeatAt: '2026-09-06T06:02:00.000Z',
  revokedAt: null,
  workspaces: [
    {
      workspaceId: run.workspaceId,
      name: '产品平台工作区',
      repositoryLabel: 'product-full-chain-platform',
      verificationStatus: 'VERIFIED',
      gitBaseline: run.gitBaseline,
      verifiedAt: '2026-09-06T06:02:00.000Z',
    },
  ],
  capability: {
    capturedAt: '2026-09-06T06:02:00.000Z',
    expiresAt: '2026-09-06T06:03:30.000Z',
    codexAppServer: 'UNVERIFIED',
    zedCli: 'UNVERIFIED',
    workspaceCount: 1,
    skillCount: 1,
    mcp: 'UNVERIFIED',
    mcpReadToolCount: 0,
    mcpConfigFingerprint: null,
  },
};
const approval: AgentApprovalDto = {
  id: 'CODEx_TEST_M2_UI_APPROVAL_001',
  runId: run.id,
  executionInstanceId: 'CODEx_TEST_M2_UI_EXECUTION_001',
  appServerRequestId: null,
  threadId: null,
  turnId: null,
  itemId: null,
  callbackId: null,
  kind: 'RUN_START',
  requestedScope: {
    allowedRelativePaths: ['docs/requirements/acceptance.md'],
    allowedActions: ['EDIT_FILES'],
    networkAccess: false,
    maxChangedFiles: 1,
    maxChangedBytes: 4096,
  },
  scopeHash: `sha256:${'b'.repeat(64)}`,
  outsideCapsule: false,
  approvedScope: null,
  decision: 'PENDING',
  requestedBy: 'CODEx_TEST_M2_UI_REQUESTER',
  requestedAt: run.createdAt,
  expiresAt: '2026-09-06T06:10:00.000Z',
  decidedBy: null,
  decidedAt: null,
  reasonCode: null,
  rowVersion: 0,
};
const auditEntry: AgentAuditEntryDto = {
  id: 'CODEx_TEST_M2_UI_AUDIT_001',
  actorId: actor.actorId,
  action: 'agent-approval.requested',
  targetType: 'agent-approval',
  targetId: approval.id,
  decision: 'ALLOW',
  reason: null,
  scopeSummary: { requirementId: run.requirementId },
  occurredAt: run.updatedAt,
};

function api(): AgentRunsApi {
  return {
    listRuns: vi.fn(async () => ({ items: [run] })),
    getRun: vi.fn(async () => run),
    listEvents: vi.fn(async () => runEvents),
    listSkills: vi.fn(async () => ({ items: [skill] })),
    listBridges: vi.fn(async () => ({ items: [bridge] })),
    createBridgePairing: vi.fn(async () => ({
      replayed: false,
      pairingId: 'CODEx_TEST_M2_UI_PAIRING_001',
      pairingCode: 'CODEx_TEST_M2_UI_PAIRING_SECRET_LONG_ENOUGH',
      expiresAt: '2026-09-06T06:07:00.000Z',
    })),
    listApprovals: vi.fn(async () => ({ items: [approval] })),
    getApproval: vi.fn(async () => approval),
    decideApproval: vi.fn(async () => ({
      ...approval,
      decision: 'APPROVED' as const,
      approvedScope: approval.requestedScope,
      decidedBy: actor.actorId,
      decidedAt: run.updatedAt,
      reasonCode: 'SCOPE_REVIEWED',
      rowVersion: 1,
    })),
    controlRun: vi.fn(async () => ({
      replayed: false,
      run,
      childRun: null,
    })),
    listAudit: vi.fn(async () => ({ runId: run.id, items: [auditEntry] })),
    revokeBridge: vi.fn(async () => ({
      replayed: false,
      status: 'REVOKED' as const,
      affectedRunCount: 0,
    })),
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('M2 AgentRun PC page', () => {
  it('renders PostgreSQL-backed runs, selected context and ordered events', async () => {
    window.history.replaceState(null, '', '/jobs');
    render(<AgentRunsPage actor={actor} api={api()} onLogout={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '受控作业' })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('只读产物检查已完成。')).toBeTruthy(),
    );
    expect(screen.getByRole('heading', { name: '事件时间线' })).toBeTruthy();
    expect(screen.getByText('运行已入队')).toBeTruthy();
    expect(screen.getByText('结果已记录')).toBeTruthy();
    expect(window.location.pathname).toBe(`/jobs/${run.id}`);
  });

  it('filters runs and exposes the registered Skill catalog as a live tab', async () => {
    render(<AgentRunsPage actor={actor} api={api()} onLogout={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(run.id)).toBeTruthy());

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索运行' }), {
      target: { value: '不存在' },
    });
    expect(screen.getByText('没有匹配的运行')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(await screen.findByText('只读产物检查')).toBeTruthy();
    expect(screen.getByText('2026.09.06-r1')).toBeTruthy();
  });

  it('shows Bridge capability evidence and creates a one-time pairing code', async () => {
    const client = api();
    render(<AgentRunsPage actor={actor} api={client} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Bridge' }));
    expect(await screen.findByText(bridge.id)).toBeTruthy();
    expect(screen.getByText('Codex 0.148.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '生成配对码' }));
    expect(
      await screen.findByText('CODEx_TEST_M2_UI_PAIRING_SECRET_LONG_ENOUGH'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销 Bridge' }));
    expect(
      screen.getByRole('alertdialog', { name: '确认撤销 Bridge' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    await waitFor(() =>
      expect(client.revokeBridge).toHaveBeenCalledWith(
        bridge.id,
        'TEAM_ADMIN_REVOKED',
        0,
      ),
    );
  });

  it('uses the fixed five-view job navigation and resolves approval in a scope drawer', async () => {
    const client = api();
    render(<AgentRunsPage actor={actor} api={client} onLogout={vi.fn()} />);

    expect(screen.getByRole('button', { name: '运行' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '审批' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bridge' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skills' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '审计' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '审批' }));
    expect(
      await screen.findByText('docs/requirements/acceptance.md'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看审批' }));
    expect(screen.getByRole('dialog', { name: '启动范围审批' })).toBeTruthy();
    expect(
      screen.getByText(
        '批准后才会创建写作业启动命令；拒绝或过期不会启动 Codex。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('禁止网络访问')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '批准一次' }));
    await waitFor(() =>
      expect(client.decideApproval).toHaveBeenCalledWith(
        approval.id,
        approval.rowVersion,
        expect.objectContaining({
          decision: 'APPROVED',
          approvedScope: approval.requestedScope,
        }),
      ),
    );
  });

  it('reads the selected run audit from the audit view', async () => {
    render(<AgentRunsPage actor={actor} api={api()} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '审计' }));
    expect(await screen.findByText('agent-approval.requested')).toBeTruthy();
    expect(screen.getByText(auditEntry.actorId)).toBeTruthy();
  });
});
