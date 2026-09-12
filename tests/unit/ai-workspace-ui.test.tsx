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
  ActionProposalDto,
  CurrentActorDto,
  ExecutionEvidenceDto,
  McpReadRequestDto,
  ProductWorkSessionReadinessDto,
  ProductWorkSessionSnapshotDto,
} from '@pfc/contracts';

import {
  ProductWorkSessionPage,
  type WorkSessionsApi,
} from '../../apps/web/src/work-sessions/index.ts';

const actor: CurrentActorDto = {
  actorId: 'CODEx_TEST_AIUX_UI_ACTOR',
  loginName: 'codex.aiux.ui',
  displayName: '张产品',
  roles: ['PRODUCT_MANAGER'],
  teams: [
    {
      id: 'CODEx_TEST_AIUX_UI_TEAM',
      name: '产品平台组',
      role: 'PRODUCT_MANAGER',
      status: 'ACTIVE',
    },
  ],
  currentTeamId: 'CODEx_TEST_AIUX_UI_TEAM',
  csrfToken: 'CODEx_TEST_AIUX_UI_CSRF',
};

const proposal: ActionProposalDto = {
  schemaVersion: 'product-action-proposal/1',
  id: 'CODEx_TEST_AIUX_UI_PROPOSAL',
  sessionId: 'CODEx_TEST_AIUX_UI_SESSION',
  turnId: 'CODEx_TEST_AIUX_UI_TURN',
  kind: 'ANSWER_QUESTION',
  target: {
    aggregateType: 'QUESTION',
    aggregateId: 'CODEx_TEST_AIUX_UI_QUESTION',
    rowVersion: 2,
  },
  changeSet: {
    kind: 'ANSWER_QUESTION',
    questionId: 'CODEx_TEST_AIUX_UI_QUESTION',
    answer: '以审批通过的费率版本为准。',
  },
  displayDiff: [
    {
      field: '回答',
      before: null,
      after: '以审批通过的费率版本为准。',
    },
  ],
  scopeHash: `sha256:${'a'.repeat(64)}`,
  confirmationRequirement: 'PRODUCT_MANAGER',
  status: 'PENDING_CONFIRMATION',
  confirmedBy: null,
  confirmedAt: null,
  reasonCode: null,
  resultRef: null,
  failureReason: null,
  rowVersion: 1,
  createdAt: '2026-09-07T04:00:08.000Z',
  updatedAt: '2026-09-07T04:00:08.000Z',
};

function snapshot(
  overrides: Partial<ProductWorkSessionSnapshotDto> = {},
): ProductWorkSessionSnapshotDto {
  return {
    schemaVersion: 'product-work-session-snapshot/1',
    session: {
      schemaVersion: 'product-work-session/1',
      id: 'CODEx_TEST_AIUX_UI_SESSION',
      teamId: actor.currentTeamId!,
      requirementId: 'CODEx_TEST_AIUX_UI_REQUIREMENT',
      openedRequirementVersion: 4,
      currentRequirementVersion: 4,
      openedBaselineId: 'CODEx_TEST_AIUX_UI_BASELINE',
      openedStage: 'G3',
      status: 'ACTIVE',
      controlSurface: 'WEB',
      activeTurnId: null,
      lastSequence: 6,
      ownerId: actor.actorId,
      title: '费率规则澄清',
      blockReason: null,
      rowVersion: 3,
      createdBy: actor.actorId,
      createdAt: '2026-09-07T04:00:00.000Z',
      updatedAt: '2026-09-07T04:00:10.000Z',
      archivedAt: null,
    },
    requirement: {
      id: 'CODEx_TEST_AIUX_UI_REQUIREMENT',
      name: '渠道费率规则统一',
      currentStage: 'G3',
      currentBaselineId: 'CODEx_TEST_AIUX_UI_BASELINE',
      rowVersion: 4,
      businessOwnerId: actor.actorId,
    },
    contextItems: [
      {
        schemaVersion: 'product-work-context-binding/1',
        id: 'CODEx_TEST_AIUX_UI_CONTEXT',
        sessionId: 'CODEx_TEST_AIUX_UI_SESSION',
        turnId: 'CODEx_TEST_AIUX_UI_TURN',
        contextType: 'MATERIAL_REF',
        targetId: 'CODEx_TEST_AIUX_UI_MATERIAL',
        targetVersion: 2,
        contentHash: `sha256:${'b'.repeat(64)}`,
        bindingRole: 'SOURCE',
        sensitivity: 'INTERNAL',
        invalidatedAt: null,
        reasonCode: null,
        createdAt: '2026-09-07T04:00:02.000Z',
      },
    ],
    turns: {
      items: [
        {
          schemaVersion: 'product-work-turn/1',
          id: 'CODEx_TEST_AIUX_UI_TURN',
          sessionId: 'CODEx_TEST_AIUX_UI_SESSION',
          sequence: 1,
          intentKind: 'CLARIFY_REQUIREMENT',
          inputText: '核对渠道费率的生效口径。',
          visibleResponse: '已形成一项待确认回答，请在右侧核对变更。',
          status: 'COMPLETED',
          skillReleaseId: 'pfc-ai-product-work-session@2026.09.07-r1',
          bridgeId: 'CODEx_TEST_AIUX_UI_BRIDGE',
          externalIds: {
            threadId: 'CODEx_TEST_AIUX_UI_THREAD',
            turnId: 'CODEx_TEST_AIUX_UI_EXTERNAL_TURN',
          },
          usageSummary: {
            inputTokens: 680,
            outputTokens: 126,
            cachedInputTokens: 340,
            durationMs: 2410,
          },
          failureReason: null,
          recoveryAction: null,
          contentRetentionUntil: '2026-10-07T04:00:10.000Z',
          redactedAt: null,
          rowVersion: 4,
          createdBy: actor.actorId,
          createdAt: '2026-09-07T04:00:02.000Z',
          updatedAt: '2026-09-07T04:00:10.000Z',
          terminalAt: '2026-09-07T04:00:10.000Z',
        },
      ],
      nextCursor: null,
    },
    pendingProposal: proposal,
    linkedAgentRunIds: ['CODEx_TEST_AIUX_UI_AGENT_RUN'],
    workspaceEvidence: {
      schemaVersion: 'product-workspace-evidence/1',
      evidenceStatus: 'VERIFIED',
      bridgeId: 'CODEx_TEST_AIUX_UI_BRIDGE',
      bridgeStatus: 'ONLINE',
      workspaceId: 'CODEx_TEST_AIUX_UI_WORKSPACE',
      verificationStatus: 'VERIFIED',
      repositoryFingerprint: `sha256:${'d'.repeat(64)}`,
      bindingGitBaseline: '0123456789abcdef0123456789abcdef01234567',
      capabilityGitBaseline: '0123456789abcdef0123456789abcdef01234567',
      capabilityCapturedAt: '2026-09-07T04:00:00.000Z',
      capabilityExpiresAt: '2026-09-07T04:15:00.000Z',
      capabilityFreshness: 'CURRENT',
      codexAppServer: 'AVAILABLE',
      zedCli: 'UNAVAILABLE',
      productWorkTurn: 'AVAILABLE',
      mcp: {
        state: 'AVAILABLE',
        status: 'AVAILABLE',
        configFingerprint: `sha256:${'e'.repeat(64)}`,
        registeredReadCapabilityCount: 1,
      },
    },
    recoveryAction: null,
    ...overrides,
  };
}

function readiness(
  current: ProductWorkSessionSnapshotDto,
  overrides: Partial<ProductWorkSessionReadinessDto> = {},
): ProductWorkSessionReadinessDto {
  return {
    schemaVersion: 'product-work-session-readiness/1',
    sessionId: current.session.id,
    sessionRowVersion: current.session.rowVersion,
    requirementRowVersion: current.requirement.rowVersion,
    baselineId: current.requirement.currentBaselineId,
    checkedAt: '2026-09-07T04:00:11.000Z',
    contextOptions: [
      {
        materialRefId: 'CODEx_TEST_AIUX_UI_MATERIAL',
        referenceType: '需求说明',
        version: '2',
        sensitivity: 'INTERNAL',
        selectedByDefault: true,
        reason: 'CURRENT_BASELINE',
      },
    ],
    skillOptions: [
      {
        releaseId: 'pfc-ai-product-work-session@2026.09.07-r1',
        displayName: '产品需求分析',
        version: '2026.09.07-r1',
        riskLevel: 'LOW',
        contextCost: null,
        availability: 'AVAILABLE',
        disabledReason: null,
        recommended: true,
      },
    ],
    recommendedContextIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
    recommendedSkillReleaseId: 'pfc-ai-product-work-session@2026.09.07-r1',
    transmissionStatus: 'READY',
    bridgeStatus: 'AVAILABLE',
    activeTransmissionAuthorization: null,
    blockers: [],
    ...overrides,
  };
}

function apiFor(
  current: ProductWorkSessionSnapshotDto,
  currentReadiness = readiness(current),
): WorkSessionsApi {
  return {
    listSessions: vi.fn().mockResolvedValue({
      items: [current.session],
      nextCursor: null,
    }),
    createSession: vi.fn(),
    getSnapshot: vi.fn().mockResolvedValue(current),
    getReadiness: vi.fn().mockResolvedValue(currentReadiness),
    listMcpReadRequests: vi.fn().mockResolvedValue({ items: [] }),
    listExecutionEvidence: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
    }),
    grantTransmissionAuthorization: vi.fn().mockResolvedValue({
      replayed: false,
      authorization: {
        authorizationId: 'CODEx_TEST_AIUX_UI_AUTH',
        actorId: current.session.ownerId,
        requirementId: current.session.requirementId,
        action: 'TRANSMIT_MATERIAL',
        target: 'APPROVED_AI',
        purpose: 'product-work-session',
        materialRefIds: currentReadiness.recommendedContextIds,
        scopeHash: `sha256:${'f'.repeat(64)}`,
        status: 'GRANTED',
        validFrom: '2026-09-07T04:00:11.000Z',
        validUntil: '2026-09-07T04:15:11.000Z',
        grantedBy: actor.actorId,
        grantedAt: '2026-09-07T04:00:11.000Z',
        revokedBy: null,
        revokedAt: null,
        rowVersion: 0,
      },
    }),
    revokeTransmissionAuthorization: vi.fn().mockResolvedValue({
      replayed: false,
      authorization: {
        authorizationId: 'CODEx_TEST_AIUX_UI_AUTH',
        actorId: current.session.ownerId,
        requirementId: current.session.requirementId,
        action: 'TRANSMIT_MATERIAL',
        target: 'APPROVED_AI',
        purpose: 'product-work-session',
        materialRefIds: currentReadiness.recommendedContextIds,
        scopeHash: `sha256:${'f'.repeat(64)}`,
        status: 'REVOKED',
        validFrom: '2026-09-07T04:00:11.000Z',
        validUntil: '2026-09-07T04:15:11.000Z',
        grantedBy: actor.actorId,
        grantedAt: '2026-09-07T04:00:11.000Z',
        revokedBy: actor.actorId,
        revokedAt: '2026-09-07T04:01:11.000Z',
        rowVersion: 1,
      },
    }),
    submitTurn: vi.fn().mockResolvedValue({
      replayed: false,
      turn: current.turns.items[0],
    }),
    controlTurn: vi.fn().mockResolvedValue({
      replayed: false,
      turn: current.turns.items[0],
    }),
    decideProposal: vi.fn().mockResolvedValue({
      replayed: false,
      proposal: { ...proposal, status: 'APPLIED' },
    }),
    subscribe: vi.fn().mockReturnValue(() => undefined),
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('AI-native product workspace', () => {
  it('submits a first turn from server readiness without historical turns', async () => {
    const current = snapshot({
      contextItems: [],
      turns: { items: [], nextCursor: null },
      pendingProposal: null,
      linkedAgentRunIds: [],
    });
    const api = apiFor(current);

    render(
      <ProductWorkSessionPage
        actor={actor}
        api={api}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: '本回合作业范围' }),
    ).toBeTruthy();
    expect(screen.getByText('1 项上下文')).toBeTruthy();
    expect(screen.getByRole('option', { name: /产品需求分析/ })).toBeTruthy();
    const composer = screen.getByRole('textbox', {
      name: '给产品 Agent 的任务',
    });
    expect((composer as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.change(composer, {
      target: { value: '识别当前需求中的待确认问题。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(api.submitTurn).toHaveBeenCalledWith({
        contextTargetIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
        intentKind: 'PRODUCT_DISCOVERY',
        message: '识别当前需求中的待确认问题。',
        rowVersion: current.session.rowVersion,
        sessionId: current.session.id,
        skillReleaseId: 'pfc-ai-product-work-session@2026.09.07-r1',
      });
    });
  });

  it('unblocks an internal subset after the user removes restricted material', async () => {
    const current = snapshot({
      contextItems: [],
      turns: { items: [], nextCursor: null },
      pendingProposal: null,
    });
    const internalId = 'CODEx_TEST_AIUX_UI_MATERIAL';
    const restrictedId = 'CODEx_TEST_AIUX_UI_RESTRICTED';
    const currentReadiness = readiness(current, {
      contextOptions: [
        ...readiness(current).contextOptions,
        {
          materialRefId: restrictedId,
          referenceType: '受限附件',
          version: '1',
          sensitivity: 'RESTRICTED',
          selectedByDefault: true,
          reason: 'CURRENT_BASELINE',
        },
      ],
      recommendedContextIds: [internalId, restrictedId],
      transmissionStatus: 'AUTHORIZATION_REQUIRED',
      blockers: [
        {
          code: 'TRANSMISSION_AUTHORIZATION_REQUIRED',
          message: '所选受限材料需要产品负责人授权后才能传输。',
          recoveryAction: 'REQUEST_TRANSMISSION_AUTHORIZATION',
        },
      ],
    });
    const api = apiFor(current, currentReadiness);

    render(
      <ProductWorkSessionPage
        actor={actor}
        api={api}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    const composer = await screen.findByRole('textbox', {
      name: '给产品 Agent 的任务',
    });
    expect((composer as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('选择上下文 受限附件'));
    expect((composer as HTMLTextAreaElement).disabled).toBe(false);
    expect(
      screen.queryByText('所选受限材料需要产品负责人授权后才能传输。'),
    ).toBeNull();
  });

  it('restores a restricted selection from an active exact authorization', async () => {
    const current = snapshot({
      contextItems: [],
      turns: { items: [], nextCursor: null },
      pendingProposal: null,
    });
    const currentReadiness = readiness(current, {
      contextOptions: readiness(current).contextOptions.map((context) => ({
        ...context,
        sensitivity: 'RESTRICTED' as const,
      })),
      transmissionStatus: 'AUTHORIZATION_REQUIRED',
      activeTransmissionAuthorization: {
        authorizationId: 'CODEx_TEST_AIUX_UI_AUTH_ACTIVE',
        materialRefIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
        validUntil: '2026-09-07T04:15:11.000Z',
        rowVersion: 0,
      },
      blockers: [
        {
          code: 'TRANSMISSION_AUTHORIZATION_REQUIRED',
          message: '所选受限材料需要产品负责人授权后才能传输。',
          recoveryAction: 'REQUEST_TRANSMISSION_AUTHORIZATION',
        },
      ],
    });

    render(
      <ProductWorkSessionPage
        actor={actor}
        api={apiFor(current, currentReadiness)}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    const composer = await screen.findByRole('textbox', {
      name: '给产品 Agent 的任务',
    });
    expect((composer as HTMLTextAreaElement).disabled).toBe(false);
    expect(
      screen.queryByText('所选受限材料需要产品负责人授权后才能传输。'),
    ).toBeNull();
  });

  it('keeps multiple compatible skills explicit until the user chooses one', async () => {
    const current = snapshot({
      contextItems: [],
      turns: { items: [], nextCursor: null },
      pendingProposal: null,
    });
    const currentReadiness = readiness(current, {
      skillOptions: [
        ...readiness(current).skillOptions.map((item) => ({
          ...item,
          recommended: false,
        })),
        {
          releaseId: 'CODEx_TEST_AIUX_UI_SKILL_2',
          displayName: '需求风险核验',
          version: '2026.09.07-r2',
          riskLevel: 'MEDIUM',
          contextCost: 1200,
          availability: 'AVAILABLE',
          disabledReason: null,
          recommended: false,
        },
      ],
      recommendedSkillReleaseId: null,
      blockers: [
        {
          code: 'SKILL_SELECTION_REQUIRED',
          message: '存在多个兼容 Skill，请明确选择本回合使用项。',
          recoveryAction: 'SELECT_SKILL',
        },
      ],
    });
    const api = apiFor(current, currentReadiness);

    render(
      <ProductWorkSessionPage
        actor={actor}
        api={api}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    const composer = await screen.findByRole('textbox', {
      name: '给产品 Agent 的任务',
    });
    expect((composer as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: '本回合 Skill' }), {
      target: { value: 'CODEx_TEST_AIUX_UI_SKILL_2' },
    });
    expect((composer as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('lets an authorized owner grant and revoke the exact selected material scope', async () => {
    const current = snapshot({
      contextItems: [],
      turns: { items: [], nextCursor: null },
      pendingProposal: null,
    });
    const currentReadiness = readiness(current, {
      contextOptions: readiness(current).contextOptions.map((context) => ({
        ...context,
        sensitivity: 'RESTRICTED' as const,
      })),
      transmissionStatus: 'AUTHORIZATION_REQUIRED',
      blockers: [
        {
          code: 'TRANSMISSION_AUTHORIZATION_REQUIRED',
          message: '所选受限材料需要产品负责人授权后才能传输。',
          recoveryAction: 'REQUEST_TRANSMISSION_AUTHORIZATION',
        },
      ],
    });
    const api = apiFor(current, currentReadiness);
    const ownerActor: CurrentActorDto = {
      ...actor,
      actorId: 'CODEx_TEST_AIUX_UI_PRODUCT_OWNER',
      roles: ['PRODUCT_OWNER'],
      teams: actor.teams.map((team) => ({
        ...team,
        role: 'PRODUCT_OWNER' as const,
      })),
    };

    render(
      <ProductWorkSessionPage
        actor={ownerActor}
        api={api}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: '授权 15 分钟' }),
    );
    await waitFor(() => {
      expect(api.grantTransmissionAuthorization).toHaveBeenCalledWith({
        beneficiaryActorId: current.session.ownerId,
        materialRefIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
        sessionId: current.session.id,
        validForMinutes: 15,
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: '撤销授权' }));
    await waitFor(() => {
      expect(api.revokeTransmissionAuthorization).toHaveBeenCalledWith({
        authorizationId: 'CODEx_TEST_AIUX_UI_AUTH',
        rowVersion: 0,
      });
    });
  });

  it('renders server-owned context and preserves the selected session in the URL', async () => {
    const current = snapshot({ linkedAgentRunIds: [] });
    const api = apiFor(current);
    window.history.replaceState(
      null,
      '',
      `/requirements/${current.requirement.id}/work?focus=proposal`,
    );

    render(
      <ProductWorkSessionPage
        actor={actor}
        api={api}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: '渠道费率规则统一' }),
    ).toBeTruthy();
    expect(screen.getByText('G3')).toBeTruthy();
    expect(screen.getByText('版本 4')).toBeTruthy();
    expect(screen.getByText('张产品')).toBeTruthy();
    expect(screen.getByText('Codex 已连接')).toBeTruthy();
    expect(screen.getByText('0123456789...1234567')).toBeTruthy();
    expect(screen.getByText('MCP 可用 · 1')).toBeTruthy();
    expect(screen.getByText('Zed 未接入')).toBeTruthy();
    expect(screen.getByText('回合')).toBeTruthy();
    expect(screen.getByText('CODEx_TEST_AIUX_UI_TURN')).toBeTruthy();
    expect(screen.queryByText('未产生')).toBeNull();
    expect(new URL(window.location.href).searchParams.get('session')).toBe(
      current.session.id,
    );

    fireEvent.change(
      screen.getByRole('textbox', { name: '给产品 Agent 的任务' }),
      {
        target: { value: '继续核对费率例外场景。' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(api.submitTurn).toHaveBeenCalledWith({
        contextTargetIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
        intentKind: 'PRODUCT_DISCOVERY',
        message: '继续核对费率例外场景。',
        rowVersion: 3,
        sessionId: current.session.id,
        skillReleaseId: 'pfc-ai-product-work-session@2026.09.07-r1',
      });
    });
  });

  it('在同一作业流中展示 MCP 调用状态、摘要和持久证据', async () => {
    const current = snapshot({ pendingProposal: null });
    const request: McpReadRequestDto = {
      schemaVersion: 'mcp-read-request/1',
      id: 'CODEx_TEST_AIUX_UI_MCP_REQUEST',
      sessionId: current.session.id,
      turnId: current.turns.items[0]!.id,
      requirementId: current.requirement.id,
      teamId: current.session.teamId,
      capabilityId: 'CODEx_TEST_AIUX_UI_MCP_CAPABILITY',
      logicalCapabilityId: 'requirement-context-read',
      inputHash: `sha256:${'1'.repeat(64)}`,
      sensitivity: 'INTERNAL',
      status: 'COMPLETED',
      bridgeId: current.workspaceEvidence.bridgeId,
      externalThreadId: 'CODEx_TEST_AIUX_UI_MCP_THREAD',
      outputSummary: '已读取 3 项需求上下文。',
      outputHash: `sha256:${'2'.repeat(64)}`,
      outputBytes: 96,
      outputTruncated: false,
      durationMs: 420,
      evidenceId: 'CODEx_TEST_AIUX_UI_MCP_EVIDENCE',
      failureReason: null,
      recoveryAction: null,
      rowVersion: 2,
      createdBy: actor.actorId,
      createdAt: '2026-09-09T04:00:00.000Z',
      updatedAt: '2026-09-09T04:00:00.420Z',
      terminalAt: '2026-09-09T04:00:00.420Z',
    };
    const evidence: ExecutionEvidenceDto = {
      schemaVersion: 'execution-evidence/1',
      id: request.evidenceId!,
      requirementId: current.requirement.id,
      baselineId: current.requirement.currentBaselineId!,
      sourceType: 'MCP_READ_RESULT',
      sourceId: request.id,
      outcome: 'SUCCEEDED',
      safeSummary: request.outputSummary!,
      contentHash: request.outputHash!,
      sensitivity: 'INTERNAL',
      artifactVersionId: 'CODEx_TEST_AIUX_UI_ARTIFACT_VERSION',
      gateRunId: null,
      retentionClass: 'PRODUCT_FACT',
      createdAt: request.terminalAt!,
    };
    const api = apiFor(current);
    vi.mocked(api.listMcpReadRequests).mockResolvedValue({ items: [request] });
    vi.mocked(api.listExecutionEvidence).mockResolvedValue({
      items: [evidence],
      nextCursor: null,
    });

    render(
      <ProductWorkSessionPage
        actor={actor}
        api={api}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    expect(await screen.findByText('requirement-context-read')).toBeTruthy();
    expect(screen.getByText('已读取 3 项需求上下文。')).toBeTruthy();
    expect(screen.getByText('证据已归档')).toBeTruthy();
    expect(screen.getByText(request.evidenceId!)).toBeTruthy();
  });

  it('positions the latest recovered response inside the feed viewport', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.classList.contains('pfc-work-stream__feed') ? 720 : 0;
      },
    });
    try {
      const current = snapshot({ pendingProposal: null });
      render(
        <ProductWorkSessionPage
          actor={actor}
          api={apiFor(current)}
          jobsEnabled
          onLogout={() => undefined}
          requirementId={current.requirement.id}
        />,
      );

      await screen.findByText(current.turns.items[0]!.visibleResponse!);
      const feed = document.querySelector<HTMLElement>(
        '.pfc-work-stream__feed',
      );
      await waitFor(() => expect(feed?.scrollTop).toBe(720));
    } finally {
      if (descriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          'scrollHeight',
          descriptor,
        );
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: number })
          .scrollHeight;
      }
    }
  });

  it('keeps a matched Git baseline available when runtime evidence expires', async () => {
    const base = snapshot();
    const current = snapshot({
      pendingProposal: null,
      workspaceEvidence: {
        ...base.workspaceEvidence,
        evidenceStatus: 'EXPIRED',
        capabilityFreshness: 'EXPIRED',
      },
    });
    render(
      <ProductWorkSessionPage
        actor={actor}
        api={apiFor(current)}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    expect(await screen.findByText('Codex 证据已过期')).toBeTruthy();
    expect(screen.getByText('Bridge 证据已过期')).toBeTruthy();
    expect(screen.getByText('0123456789...1234567')).toBeTruthy();
    expect(
      screen.getByText('Git', { exact: true }).closest('span')?.dataset
        .available,
    ).toBe('true');
  });

  it.each([
    ['MISMATCHED', 'CURRENT', 'Git 基线不一致'],
    ['MISSING', 'MISSING', 'Git 基线未核验'],
  ] as const)(
    'renders %s workspace evidence without claiming Git is available',
    async (evidenceStatus, capabilityFreshness, expected) => {
      const base = snapshot();
      const current = snapshot({
        pendingProposal: null,
        workspaceEvidence: {
          ...base.workspaceEvidence,
          evidenceStatus,
          capabilityFreshness,
        },
      });
      render(
        <ProductWorkSessionPage
          actor={actor}
          api={apiFor(current)}
          jobsEnabled
          onLogout={() => undefined}
          requirementId={current.requirement.id}
        />,
      );

      expect(await screen.findByText(expected)).toBeTruthy();
      expect(screen.queryByText('0123456789...1234567')).toBeNull();
    },
  );

  it('requires an explicit proposal decision before applying a server diff', async () => {
    const current = snapshot();
    const api = apiFor(current);

    render(
      <ProductWorkSessionPage
        actor={actor}
        api={api}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    expect(await screen.findByText('以审批通过的费率版本为准。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认并应用' }));

    await waitFor(() => {
      expect(api.decideProposal).toHaveBeenCalledWith({
        decision: 'CONFIRM',
        proposalId: proposal.id,
        reasonCode: 'PRODUCT_OWNER_CONFIRMED',
        rowVersion: proposal.rowVersion,
        scopeHash: proposal.scopeHash,
      });
      expect(api.getSnapshot).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps UNKNOWN distinct from success and exposes read-only verification', async () => {
    const unknownTurn = {
      ...snapshot().turns.items[0]!,
      status: 'UNKNOWN' as const,
      visibleResponse: null,
      failureReason: 'RESULT_UNKNOWN',
      recoveryAction: 'VERIFY_TURN',
      rowVersion: 5,
      terminalAt: null,
    };
    const current = snapshot({
      session: {
        ...snapshot().session,
        status: 'BLOCKED',
        blockReason: 'RESULT_UNKNOWN',
        activeTurnId: unknownTurn.id,
        rowVersion: 4,
      },
      turns: { items: [unknownTurn], nextCursor: null },
      pendingProposal: null,
      recoveryAction: 'VERIFY_TURN',
    });
    const api = apiFor(current);

    render(
      <ProductWorkSessionPage
        actor={actor}
        api={api}
        jobsEnabled
        onLogout={() => undefined}
        requirementId={current.requirement.id}
      />,
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      '结果待核验',
    );
    expect(screen.queryByText('回合已完成')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '核验回合' }));

    await waitFor(() => {
      expect(api.controlTurn).toHaveBeenCalledWith({
        action: 'VERIFY',
        rowVersion: 5,
        turnId: unknownTurn.id,
      });
    });
  });
});
