import path from 'node:path';

import { expect, test, type Route } from 'playwright/test';

const requirementId = 'CODEx_TEST_AIUX_E2E_REQUIREMENT';
const sessionId = 'CODEx_TEST_AIUX_E2E_SESSION';
const materialRefId = 'CODEx_TEST_AIUX_E2E_MATERIAL';
const skillReleaseId = 'CODEx_TEST_AIUX_E2E_SKILL';
const actor = {
  actorId: 'CODEx_TEST_AIUX_E2E_ACTOR',
  loginName: 'codex.aiux.e2e',
  displayName: '产品经理',
  roles: ['PRODUCT_MANAGER'],
  teams: [
    {
      id: 'CODEx_TEST_AIUX_E2E_TEAM',
      name: '产品平台组',
      role: 'PRODUCT_MANAGER',
      status: 'ACTIVE',
    },
  ],
  currentTeamId: 'CODEx_TEST_AIUX_E2E_TEAM',
  csrfToken: 'CODEx_TEST_AIUX_E2E_CSRF',
} as const;

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

test('AI-UX-R1 new session submits its first turn from readiness', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  let submittedBody: Record<string, unknown> | null = null;
  let submitted = false;
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/session-state') {
      return json(route, 200, { authenticated: true, actor });
    }
    if (url.pathname === '/api/v1/skills') {
      return json(route, 200, { items: [] });
    }
    if (
      url.pathname === `/api/v1/requirements/${requirementId}/work-sessions`
    ) {
      return json(route, 200, {
        items: [
          {
            schemaVersion: 'product-work-session/1',
            id: sessionId,
            teamId: actor.currentTeamId,
            requirementId,
            openedRequirementVersion: 4,
            currentRequirementVersion: 4,
            openedBaselineId: 'CODEx_TEST_AIUX_E2E_BASELINE',
            openedStage: 'G3',
            status: 'ACTIVE',
            controlSurface: 'WEB',
            activeTurnId: null,
            lastSequence: submitted ? 2 : 1,
            ownerId: actor.actorId,
            title: '产品 Agent 协作',
            blockReason: null,
            rowVersion: submitted ? 1 : 0,
            createdBy: actor.actorId,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T05:00:00.000Z',
            archivedAt: null,
          },
        ],
        nextCursor: null,
      });
    }
    if (url.pathname === `/api/v1/work-sessions/${sessionId}`) {
      return json(route, 200, {
        schemaVersion: 'product-work-session-snapshot/1',
        session: {
          schemaVersion: 'product-work-session/1',
          id: sessionId,
          teamId: actor.currentTeamId,
          requirementId,
          openedRequirementVersion: 4,
          currentRequirementVersion: 4,
          openedBaselineId: 'CODEx_TEST_AIUX_E2E_BASELINE',
          openedStage: 'G3',
          status: 'ACTIVE',
          controlSurface: 'WEB',
          activeTurnId: null,
          lastSequence: submitted ? 2 : 1,
          ownerId: actor.actorId,
          title: '产品 Agent 协作',
          blockReason: null,
          rowVersion: submitted ? 1 : 0,
          createdBy: actor.actorId,
          createdAt: '2026-09-07T05:00:00.000Z',
          updatedAt: '2026-09-07T05:00:00.000Z',
          archivedAt: null,
        },
        requirement: {
          id: requirementId,
          name: '渠道费率规则统一',
          currentStage: 'G3',
          currentBaselineId: 'CODEx_TEST_AIUX_E2E_BASELINE',
          rowVersion: 4,
          businessOwnerId: actor.actorId,
        },
        contextItems: [],
        turns: {
          items: submitted
            ? [
                {
                  schemaVersion: 'product-work-turn/1',
                  id: 'CODEx_TEST_AIUX_E2E_TURN',
                  sessionId,
                  sequence: 1,
                  intentKind: 'PRODUCT_DISCOVERY',
                  inputText: '识别当前需求中的待确认问题。',
                  visibleResponse: null,
                  status: 'QUEUED',
                  skillReleaseId,
                  bridgeId: 'CODEx_TEST_AIUX_E2E_BRIDGE',
                  externalIds: { threadId: null, turnId: null },
                  usageSummary: null,
                  failureReason: null,
                  recoveryAction: null,
                  contentRetentionUntil: '2026-10-07T05:00:00.000Z',
                  redactedAt: null,
                  rowVersion: 1,
                  createdBy: actor.actorId,
                  createdAt: '2026-09-07T05:01:00.000Z',
                  updatedAt: '2026-09-07T05:01:00.000Z',
                  terminalAt: null,
                },
              ]
            : [],
          nextCursor: null,
        },
        pendingProposal: null,
        linkedAgentRunIds: [],
        workspaceEvidence: {
          schemaVersion: 'product-workspace-evidence/1',
          evidenceStatus: 'VERIFIED',
          bridgeId: 'CODEx_TEST_AIUX_E2E_BRIDGE',
          bridgeStatus: 'ONLINE',
          workspaceId: 'CODEx_TEST_AIUX_E2E_WORKSPACE',
          verificationStatus: 'VERIFIED',
          repositoryFingerprint: `sha256:${'d'.repeat(64)}`,
          bindingGitBaseline: 'd'.repeat(40),
          capabilityGitBaseline: 'd'.repeat(40),
          capabilityCapturedAt: '2026-09-07T05:00:00.000Z',
          capabilityExpiresAt: '2026-09-07T05:15:00.000Z',
          capabilityFreshness: 'CURRENT',
          codexAppServer: 'AVAILABLE',
          zedCli: 'UNAVAILABLE',
          productWorkTurn: 'AVAILABLE',
        },
        recoveryAction: null,
      });
    }
    if (url.pathname === `/api/v1/work-sessions/${sessionId}/readiness`) {
      return json(route, 200, {
        schemaVersion: 'product-work-session-readiness/1',
        sessionId,
        sessionRowVersion: submitted ? 1 : 0,
        requirementRowVersion: 4,
        baselineId: 'CODEx_TEST_AIUX_E2E_BASELINE',
        checkedAt: '2026-09-07T05:00:01.000Z',
        contextOptions: [
          {
            materialRefId,
            referenceType: '需求说明',
            version: '2',
            sensitivity: 'INTERNAL',
            selectedByDefault: true,
            reason: 'CURRENT_BASELINE',
          },
        ],
        skillOptions: [
          {
            releaseId: skillReleaseId,
            displayName: '产品需求分析',
            version: '2026.09.07-r1',
            riskLevel: 'LOW',
            contextCost: null,
            availability: 'AVAILABLE',
            disabledReason: null,
            recommended: true,
          },
        ],
        recommendedContextIds: [materialRefId],
        recommendedSkillReleaseId: skillReleaseId,
        transmissionStatus: 'READY',
        bridgeStatus: 'AVAILABLE',
        activeTransmissionAuthorization: null,
        blockers: [],
      });
    }
    if (
      request.method() === 'POST' &&
      url.pathname === `/api/v1/work-sessions/${sessionId}/turns`
    ) {
      submittedBody = request.postDataJSON() as Record<string, unknown>;
      submitted = true;
      return json(route, 202, {
        replayed: false,
        turn: { id: 'CODEx_TEST_AIUX_E2E_TURN', status: 'QUEUED' },
      });
    }
    if (url.pathname === `/api/v1/work-sessions/${sessionId}/events`) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: 'retry: 60000\n\n',
      });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`/requirements/${requirementId}/work`);
  await expect(page).toHaveTitle(/Product Full Chain/);
  await expect(
    page.getByRole('heading', { name: '渠道费率规则统一' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '本回合作业范围' }),
  ).toBeVisible();
  await expect(page.getByLabel('选择上下文 需求说明')).toBeChecked();
  await expect(page.getByLabel('本回合 Skill')).toHaveValue(skillReleaseId);

  const composer = page.getByRole('textbox', {
    name: '给产品 Agent 的任务',
  });
  await expect(composer).toBeEnabled();
  await composer.fill('识别当前需求中的待确认问题。');
  await page.getByRole('button', { name: '发送' }).click();
  await expect
    .poll(() => submittedBody)
    .toMatchObject({
      schemaVersion: 'create-product-work-turn/1',
      contextBindingIds: [materialRefId],
      skillReleaseId,
    });
  await expect(page.getByText('识别当前需求中的待确认问题。')).toBeVisible();

  const geometry = await page.evaluate(() => ({
    horizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth,
    readinessOverflow: Array.from(
      document.querySelectorAll<HTMLElement>('.pfc-readiness-panel *'),
    ).some((element) => element.scrollWidth > element.clientWidth + 1),
    fontFamily: getComputedStyle(document.body).fontFamily,
  }));
  expect(geometry).toMatchObject({
    horizontalOverflow: false,
    readinessOverflow: false,
  });
  expect(geometry.fontFamily).toContain('Noto Sans SC');
  expect(browserErrors).toEqual([]);

  await page.screenshot({
    path: path.join(
      'output',
      'playwright',
      'ai-ux-r1-e',
      `pfc-aiux-stage-e-${testInfo.project.name}.png`,
    ),
    fullPage: false,
  });
});
