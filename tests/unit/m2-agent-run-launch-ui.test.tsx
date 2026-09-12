// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentRunDto, AgentRunLaunchOptionsDto } from '@pfc/contracts';

import {
  AgentRunLaunchPanel,
  type AgentRunLaunchApi,
} from '../../apps/web/src/agent-runs/AgentRunLaunchPanel.tsx';

const options: AgentRunLaunchOptionsDto = {
  requirementId: 'CODEx_TEST_M2_LAUNCH_REQUIREMENT',
  baselineId: 'CODEx_TEST_M2_LAUNCH_BASELINE',
  artifactSourceRef: 'docs/requirements/requirement.md',
  workspaces: [
    {
      id: 'CODEx_TEST_M2_LAUNCH_WORKSPACE',
      name: '产品平台工作区',
      repositoryLabel: 'product-full-chain-platform',
      gitBaseline: '0123456789abcdef0123456789abcdef01234567',
      bridgeId: 'CODEx_TEST_M2_LAUNCH_BRIDGE',
      lastVerifiedAt: '2026-09-06T06:00:00.000Z',
      accessLevel: 'WRITE',
      skillReleaseIds: ['CODEx_TEST_M2_LAUNCH_SKILL_RELEASE'],
    },
  ],
  skills: [
    {
      id: 'CODEx_TEST_M2_LAUNCH_SKILL_RELEASE',
      skillKey: 'pfc-readonly-artifact-check',
      displayName: '只读产物检查',
      description: '核对当前需求产物结构、固定基线与证据链。',
      sourceType: 'LOCAL_ALLOWLIST',
      logicalSource:
        'project-skill:skills/pfc-readonly-artifact-check/SKILL.md',
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
      createdAt: '2026-09-06T06:00:00.000Z',
    },
  ],
};

describe('M2 AgentRun launch panel', () => {
  afterEach(cleanup);

  it('creates a read-only run from server-side launch options without a browser Git baseline', async () => {
    const created = {
      id: 'CODEx_TEST_M2_LAUNCH_RUN',
      requirementId: options.requirementId,
      baselineId: options.baselineId,
      workspaceId: options.workspaces[0]!.id,
      gitBaseline: options.workspaces[0]!.gitBaseline,
      skillReleaseId: options.skills[0]!.id,
      operation: 'ARTIFACT_CHECK',
      accessMode: 'READ_ONLY',
      status: 'QUEUED',
      parentRunId: null,
      bridgeId: null,
      executionInstanceId: null,
      externalIds: { threadId: null, turnId: null },
      resultOutcome: null,
      runScope: null,
      runScopeHash: null,
      executionStartedAt: null,
      cancelRequestedAt: null,
      terminalAt: null,
      resultSummary: null,
      failureReason: null,
      rowVersion: 0,
      createdBy: 'CODEx_TEST_M2_ACTOR',
      createdAt: '2026-09-06T06:01:00.000Z',
      updatedAt: '2026-09-06T06:01:00.000Z',
    } satisfies AgentRunDto;
    const api: AgentRunLaunchApi = {
      getLaunchOptions: vi.fn(async () => options),
      createRun: vi.fn(async () => ({ replayed: false, run: created })),
    };
    const onCreated = vi.fn();
    render(
      <AgentRunLaunchPanel
        api={api}
        onCreated={onCreated}
        requirementId={options.requirementId}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '运行只读检查' }));
    expect(await screen.findByText('产品平台工作区')).toBeTruthy();
    expect(screen.getByRole('option', { name: '只读产物检查' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '启动只读检查' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created.id));
    expect(api.createRun).toHaveBeenCalledWith(
      options.requirementId,
      {
        baselineId: options.baselineId,
        workspaceId: options.workspaces[0]!.id,
        skillKey: options.skills[0]!.skillKey,
        skillVersion: options.skills[0]!.version,
        operation: 'ARTIFACT_CHECK',
        accessMode: 'READ_ONLY',
      },
      expect.stringMatching(/^AGENT_RUN_CREATE_/),
    );
  });

  it('shows only the Skill releases reported by the selected workspace Bridge', async () => {
    const secondSkill = {
      ...options.skills[0]!,
      id: 'CODEx_TEST_M2_LAUNCH_SKILL_RELEASE_SECOND',
      skillKey: 'pfc-readonly-second-check',
      displayName: '第二项只读检查',
      contentHash: `sha256:${'b'.repeat(64)}`,
    };
    const scopedOptions: AgentRunLaunchOptionsDto = {
      ...options,
      workspaces: [
        options.workspaces[0]!,
        {
          ...options.workspaces[0]!,
          id: 'CODEx_TEST_M2_LAUNCH_WORKSPACE_SECOND',
          name: '第二工作区',
          skillReleaseIds: [secondSkill.id],
        },
      ],
      skills: [...options.skills, secondSkill],
    };
    const api: AgentRunLaunchApi = {
      getLaunchOptions: vi.fn(async () => scopedOptions),
      createRun: vi.fn(),
    };
    render(
      <AgentRunLaunchPanel
        api={api}
        onCreated={vi.fn()}
        requirementId={options.requirementId}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '运行只读检查' }));
    expect(await screen.findByText('产品平台工作区')).toBeTruthy();
    expect(screen.queryByRole('option', { name: '第二项只读检查' })).toBeNull();

    fireEvent.change(screen.getByLabelText('已验证工作区'), {
      target: { value: 'CODEx_TEST_M2_LAUNCH_WORKSPACE_SECOND' },
    });
    expect(screen.getByRole('option', { name: '第二项只读检查' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '只读产物检查' })).toBeNull();
  });

  it('creates a bounded workspace-write run for the registered artifact without free-form scope input', async () => {
    const writeSkill = {
      ...options.skills[0]!,
      id: 'CODEx_TEST_M2_LAUNCH_WRITE_SKILL_RELEASE',
      skillKey: 'pfc-controlled-artifact-edit',
      displayName: '受控产物修订',
      version: '2026.09.06-r2',
      contentHash: `sha256:${'c'.repeat(64)}`,
      enabledScopes: ['CONTROLLED_ARTIFACT_EDIT'] as const,
      requiredCapabilities: ['READ_WORKSPACE', 'WRITE_WORKSPACE'],
    };
    const writeOptions: AgentRunLaunchOptionsDto = {
      ...options,
      workspaces: [
        {
          ...options.workspaces[0]!,
          skillReleaseIds: [options.skills[0]!.id, writeSkill.id],
        },
      ],
      skills: [...options.skills, writeSkill],
    };
    const api: AgentRunLaunchApi = {
      getLaunchOptions: vi.fn(async () => writeOptions),
      createRun: vi.fn(async () => ({
        replayed: false,
        run: {
          ...runForWrite(writeOptions, writeSkill.id),
        },
      })),
    };

    render(
      <AgentRunLaunchPanel
        api={api}
        onCreated={vi.fn()}
        requirementId={options.requirementId}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '运行只读检查' }));
    await screen.findByText('产品平台工作区');
    fireEvent.click(screen.getByRole('button', { name: '受控写入' }));
    expect(screen.getByText('docs/requirements/requirement.md')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '启动受控写入' }));

    await waitFor(() =>
      expect(api.createRun).toHaveBeenCalledWith(
        options.requirementId,
        expect.objectContaining({
          operation: 'CONTROLLED_ARTIFACT_EDIT',
          accessMode: 'WORKSPACE_WRITE',
          writeScope: {
            allowedRelativePaths: ['docs/requirements/requirement.md'],
            allowedActions: ['EDIT_FILES'],
            maxChangedFiles: 1,
            maxChangedBytes: 65536,
          },
        }),
        expect.stringMatching(/^AGENT_RUN_CREATE_/),
      ),
    );
  });
});

function runForWrite(
  launchOptions: AgentRunLaunchOptionsDto,
  skillReleaseId: string,
): AgentRunDto {
  return {
    id: 'CODEx_TEST_M2_LAUNCH_WRITE_RUN',
    requirementId: launchOptions.requirementId,
    baselineId: launchOptions.baselineId,
    workspaceId: launchOptions.workspaces[0]!.id,
    gitBaseline: launchOptions.workspaces[0]!.gitBaseline,
    skillReleaseId,
    operation: 'CONTROLLED_ARTIFACT_EDIT',
    accessMode: 'WORKSPACE_WRITE',
    status: 'QUEUED',
    parentRunId: null,
    bridgeId: null,
    executionInstanceId: 'CODEx_TEST_M2_LAUNCH_EXECUTION',
    externalIds: { threadId: null, turnId: null },
    resultOutcome: null,
    runScope: {
      allowedRelativePaths: [launchOptions.artifactSourceRef],
      allowedActions: ['EDIT_FILES'],
      networkAccess: false,
      maxChangedFiles: 1,
      maxChangedBytes: 65536,
      expiresAt: '2026-09-06T06:10:00.000Z',
    },
    runScopeHash: `sha256:${'d'.repeat(64)}`,
    executionStartedAt: null,
    cancelRequestedAt: null,
    terminalAt: null,
    resultSummary: null,
    failureReason: null,
    rowVersion: 0,
    createdBy: 'CODEx_TEST_M2_ACTOR',
    createdAt: '2026-09-06T06:01:00.000Z',
    updatedAt: '2026-09-06T06:01:00.000Z',
  };
}
