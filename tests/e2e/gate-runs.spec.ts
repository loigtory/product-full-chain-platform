import { expect, test, type Page, type Route } from 'playwright/test';

const requirementId = 'CODEx_TEST_T5_E2E_REQ_001';
const baselineId = 'CODEx_TEST_T5_E2E_BASELINE_001';
const now = '2026-09-05T06:40:00.000Z';

const passedRun = {
  id: 'CODEx_TEST_T5_E2E_GATE_001',
  requirementId,
  baselineId,
  stage: 'G0',
  mode: 'AUTOMATIC',
  status: 'COMPLETED',
  result: 'PASS',
  validity: 'CURRENT',
  ownerId: 'CODEx_TEST_T5_E2E_PM',
  confirmedRole: null,
  confirmedBy: null,
  confirmedAt: null,
  startedAt: now,
  completedAt: now,
  failureReason: null,
  unknownReason: null,
  registrationNote: null,
  checks: [
    {
      id: 'CODEx_TEST_T5_E2E_CHECK_001',
      checkKey: 'automatic.aggregate',
      result: 'PASS',
      reason: null,
      ownerId: 'CODEx_TEST_T5_E2E_PM',
      closePoint: 'G0',
    },
  ],
  evidence: [],
  advancement: {
    id: 'CODEx_TEST_T5_E2E_ADVANCE_001',
    fromStage: 'G0',
    toStage: 'G1',
    advancedAt: now,
  },
} as const;

function detail(capability: 'AVAILABLE' | 'UNAVAILABLE') {
  return {
    id: requirementId,
    name: '结算材料完整性门禁',
    originalIdea: '在进入方案阶段前验证登记与证据。',
    initiatorId: 'CODEx_TEST_T5_E2E_PM',
    businessOwnerId: 'CODEx_TEST_T5_E2E_OWNER',
    currentStage: 'G0',
    rowVersion: 1,
    registration: {
      sourceType: 'BUSINESS_FEEDBACK',
      sourceDescription: null,
      businessOwnerId: 'CODEx_TEST_T5_E2E_OWNER',
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
    },
    missingFields: [],
    gateProjection: 'NOT_STARTED',
    currentBaseline: {
      id: baselineId,
      versionNumber: 1,
      sourceType: 'BUSINESS_FEEDBACK',
      sourceDescription: null,
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
      confirmedBy: 'CODEx_TEST_T5_E2E_PM',
      confirmedAt: now,
    },
    questions: [],
    currentGateRun: null,
    gateRuns: [],
    gateExecution: {
      status: capability,
      capabilityVersion: 'fixture/t5/v1',
      checkedAt: now,
      reasonCode:
        capability === 'AVAILABLE' ? null : 'CAPABILITY_NOT_CONFIGURED',
    },
    createdAt: now,
    updatedAt: now,
  } as const;
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

function emptyTimelineRead(route: Route, url: URL): Promise<void> | null {
  if (url.pathname.endsWith('/timeline')) {
    return json(route, 200, {
      items: [],
      nextCursor: null,
      partial: false,
      checkedAt: now,
    });
  }
  if (url.pathname.endsWith('/events')) {
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: 'retry: 60000\n\n',
    });
  }
  return null;
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, dd, h1, h2, h3, li, p, small, span',
      ),
    ).filter((element) => element.offsetParent !== null);
    const clippedNodes = elements
      .filter((element) => {
        if (getComputedStyle(element).textOverflow === 'ellipsis') return false;
        const textRange = document.createRange();
        textRange.selectNodeContents(element);
        const textBounds = textRange.getBoundingClientRect();
        const elementBounds = element.getBoundingClientRect();
        return (
          textBounds.left < elementBounds.left - 1 ||
          textBounds.right > elementBounds.right + 1
        );
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        text: element.textContent?.trim().slice(0, 80),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      clippedNodes,
    };
  });
}

test('自动门禁 PASS 后推进阶段并展示权威运行记录', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  const requests: Array<{ body: unknown; ifMatch?: string; key?: string }> = [];
  let current: Record<string, unknown> = detail('AVAILABLE');
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.pathname ===
        `/api/v1/requirements/${requirementId}/gate-runs/automatic` &&
      request.method() === 'POST'
    ) {
      requests.push({
        body: request.postDataJSON(),
        ifMatch: request.headers()['if-match'],
        key: request.headers()['idempotency-key'],
      });
      current = {
        ...detail('AVAILABLE'),
        currentStage: 'G1',
        rowVersion: 2,
        gateRuns: [passedRun],
      };
      return json(route, 201, {
        replayed: false,
        reusedInProgress: false,
        gateRun: passedRun,
        requirement: {
          id: requirementId,
          currentStage: 'G1',
          currentBaselineId: baselineId,
          rowVersion: 2,
        },
      });
    }
    if (url.pathname === `/api/v1/requirements/${requirementId}`) {
      return json(route, 200, current);
    }
    const timelineRead = emptyTimelineRead(route, url);
    if (timelineRead) return timelineRead;
    return json(route, 404, { code: 'NOT_FOUND' });
  });

  await page.goto(`/requirements/${requirementId}`);
  await expect(
    page.getByRole('heading', { name: '当前阶段门禁' }),
  ).toBeVisible();
  await expect(page.getByText('自动门禁可用')).toBeVisible();
  await page.getByRole('button', { name: '运行自动门禁' }).click();

  await expect(page.getByText('G1 · 阶段门禁')).toBeVisible();
  await expect(page.getByText('automatic.aggregate')).toBeVisible();
  await expect(page.getByText('已通过').last()).toBeVisible();
  expect(requests).toEqual([
    {
      body: { baselineId, stage: 'G0' },
      ifMatch: '"1"',
      key: expect.stringMatching(/^CODEx_TEST_T4_E2E_GATE_AUTO_/),
    },
  ]);
  expect(await geometry(page)).toEqual({
    horizontalOverflow: false,
    clippedNodes: [],
  });
  expect(browserErrors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('automatic-pass.png'),
    fullPage: true,
  });
});

test('自动能力不可用时禁用自动入口并完成人工登记', async ({
  page,
}, testInfo) => {
  const submissions: Array<{
    body: Record<string, unknown>;
    ifMatch?: string;
  }> = [];
  const manualRun = {
    ...passedRun,
    id: 'CODEx_TEST_T5_E2E_GATE_MANUAL',
    mode: 'MANUAL',
    confirmedRole: 'BUSINESS_OWNER',
    confirmedBy: 'CODEx_TEST_T5_E2E_OWNER',
    confirmedAt: now,
    registrationNote: '自动能力不可用，由业务责任人依据当前证据登记。',
    checks: [
      {
        ...passedRun.checks[0],
        id: 'CODEx_TEST_T5_E2E_CHECK_MANUAL',
        checkKey: 'manual.aggregate',
      },
    ],
    evidence: [
      {
        evidenceRefId: 'CODEx_TEST_T5_E2E_EVIDENCE_001',
        accessDecision: 'ALLOWED',
        actionAuthorizationRef: null,
      },
    ],
  } as const;
  let current: Record<string, unknown> = detail('UNAVAILABLE');
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.pathname ===
        `/api/v1/requirements/${requirementId}/gate-runs/manual` &&
      request.method() === 'POST'
    ) {
      submissions.push({
        body: request.postDataJSON() as Record<string, unknown>,
        ifMatch: request.headers()['if-match'],
      });
      current = {
        ...detail('UNAVAILABLE'),
        currentStage: 'G1',
        rowVersion: 2,
        gateRuns: [manualRun],
      };
      return json(route, 201, {
        replayed: false,
        reusedInProgress: false,
        gateRun: manualRun,
        requirement: {
          id: requirementId,
          currentStage: 'G1',
          currentBaselineId: baselineId,
          rowVersion: 2,
        },
      });
    }
    if (url.pathname === `/api/v1/requirements/${requirementId}`) {
      return json(route, 200, current);
    }
    const timelineRead = emptyTimelineRead(route, url);
    if (timelineRead) return timelineRead;
    return json(route, 404, { code: 'NOT_FOUND' });
  });

  await page.goto(`/requirements/${requirementId}`);
  await expect(page.getByText('自动门禁不可用')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '运行自动门禁' }),
  ).toBeDisabled();
  const manualTrigger = page.getByRole('button', { name: '登记人工结论' });
  await manualTrigger.focus();
  await manualTrigger.click();
  const dialog = page.getByRole('dialog', { name: '登记人工门禁结论' });
  await expect(dialog.getByLabel('登记说明')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(manualTrigger).toBeFocused();
  await manualTrigger.click();
  await dialog
    .getByLabel('登记说明')
    .fill('自动能力不可用，由业务责任人依据当前证据登记。');
  await dialog.getByLabel('证据引用').fill('CODEx_TEST_T5_E2E_EVIDENCE_001');
  await dialog.getByRole('button', { name: '提交人工结论' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('G1 · 阶段门禁')).toBeVisible();
  await expect(page.getByText('manual.aggregate')).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    ifMatch: '"1"',
    body: {
      baselineId,
      stage: 'G0',
      result: 'PASS',
      confirmedRole: 'BUSINESS_OWNER',
      evidenceRefIds: ['CODEx_TEST_T5_E2E_EVIDENCE_001'],
    },
  });
  expect(await geometry(page)).toEqual({
    horizontalOverflow: false,
    clippedNodes: [],
  });
  await page.screenshot({
    path: testInfo.outputPath('manual-pass.png'),
    fullPage: true,
  });
});
