import { expect, test, type Page, type Route } from 'playwright/test';

import type {
  GateRunDto,
  MaterialBaselineDto,
  MaterialImpactAssessmentDto,
  RequirementDetailDto,
  TimelineEventDto,
} from '../../packages/contracts/src/index.ts';

const requirementId = 'CODEx_TEST_T6_E2E_REQ_001';
const currentBaseline: MaterialBaselineDto = {
  id: 'CODEx_TEST_T6_E2E_BASELINE_001',
  versionNumber: 1,
  sourceType: 'BUSINESS_FEEDBACK',
  sourceDescription: null,
  materialPurpose: 'FACT',
  sensitivity: 'INTERNAL',
  confirmedBy: 'CODEx_TEST_T6_E2E_PM',
  confirmedAt: '2026-09-05T08:00:00.000Z',
};
const candidateBaseline: MaterialBaselineDto = {
  ...currentBaseline,
  id: 'CODEx_TEST_T6_E2E_BASELINE_002',
  versionNumber: 2,
  sourceType: 'USER_INTERVIEW',
  confirmedAt: '2026-09-05T08:15:00.000Z',
};
const protectedIdea = '受保护的客户访谈原文不得进入时间线与浏览器存储。';

const gateRuns: readonly GateRunDto[] = [
  {
    id: 'CODEx_TEST_T6_E2E_GATE_G1',
    requirementId,
    baselineId: currentBaseline.id,
    stage: 'G1',
    mode: 'MANUAL',
    status: 'COMPLETED',
    result: 'PASS',
    validity: 'CURRENT',
    ownerId: 'CODEx_TEST_T6_E2E_OWNER',
    confirmedRole: 'BUSINESS_OWNER',
    confirmedBy: 'CODEx_TEST_T6_E2E_OWNER',
    confirmedAt: '2026-09-05T08:05:00.000Z',
    startedAt: '2026-09-05T08:05:00.000Z',
    completedAt: '2026-09-05T08:05:00.000Z',
    failureReason: null,
    unknownReason: null,
    registrationNote: '合成测试结论',
    checks: [],
    evidence: [],
    advancement: {
      id: 'CODEx_TEST_T6_E2E_ADVANCE_G1',
      fromStage: 'G1',
      toStage: 'G2',
      advancedAt: '2026-09-05T08:05:00.000Z',
    },
  },
  {
    id: 'CODEx_TEST_T6_E2E_GATE_G3',
    requirementId,
    baselineId: currentBaseline.id,
    stage: 'G3',
    mode: 'MANUAL',
    status: 'COMPLETED',
    result: 'PASS',
    validity: 'CURRENT',
    ownerId: 'CODEx_TEST_T6_E2E_OWNER',
    confirmedRole: 'BUSINESS_OWNER',
    confirmedBy: 'CODEx_TEST_T6_E2E_OWNER',
    confirmedAt: '2026-09-05T08:10:00.000Z',
    startedAt: '2026-09-05T08:10:00.000Z',
    completedAt: '2026-09-05T08:10:00.000Z',
    failureReason: null,
    unknownReason: null,
    registrationNote: '合成测试结论',
    checks: [],
    evidence: [],
    advancement: null,
  },
];

const pendingImpact: MaterialImpactAssessmentDto = {
  id: 'CODEx_TEST_T6_E2E_IMPACT_001',
  requirementId,
  originalBaselineId: currentBaseline.id,
  candidateBaselineId: candidateBaseline.id,
  recommendedStage: 'G1',
  selectedStage: null,
  decision: null,
  reason: null,
  status: 'PENDING',
  confirmedRole: null,
  confirmedBy: null,
  confirmedAt: null,
  invalidatedGateRunIds: [],
  createdAt: '2026-09-05T08:15:00.000Z',
};

const initialEvent: TimelineEventDto = {
  eventId: 'CODEx_TEST_T6_E2E_TIMELINE_001',
  sequence: 1,
  type: 'gate.completed',
  requirementId,
  aggregateVersion: 4,
  occurredAt: '2026-09-05T08:10:00.000Z',
  beforeSummary: { status: 'IN_PROGRESS' },
  afterSummary: { status: 'COMPLETED', result: 'PASS', stage: 'G3' },
};

function initialDetail(): RequirementDetailDto {
  return {
    id: requirementId,
    name: '续期材料影响评估',
    originalIdea: protectedIdea,
    initiatorId: 'CODEx_TEST_T6_E2E_PM',
    businessOwnerId: 'CODEx_TEST_T6_E2E_OWNER',
    currentStage: 'G3',
    rowVersion: 4,
    registration: {
      sourceType: 'BUSINESS_FEEDBACK',
      businessOwnerId: 'CODEx_TEST_T6_E2E_OWNER',
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
    },
    missingFields: [],
    gateProjection: 'NOT_STARTED',
    currentBaseline,
    materialBaselines: [currentBaseline],
    materialImpacts: [],
    questions: [],
    currentGateRun: gateRuns[1],
    gateRuns: [...gateRuns],
    gateExecution: {
      status: 'UNAVAILABLE',
      capabilityVersion: 'fixture/t6/v1',
      checkedAt: '2026-09-05T08:10:00.000Z',
      reasonCode: 'CAPABILITY_NOT_CONFIGURED',
    },
    createdAt: '2026-09-05T08:00:00.000Z',
    updatedAt: '2026-09-05T08:10:00.000Z',
  };
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

function listItem(detail: ReturnType<typeof initialDetail>) {
  return {
    id: detail.id,
    name: detail.name,
    currentStage: detail.currentStage,
    gateProjection: detail.gateProjection,
    ownerId: detail.businessOwnerId,
    nextAction: '评估新材料影响',
    updatedAt: detail.updatedAt,
    dependencyStatus: 'AVAILABLE',
    warningCode: null,
  };
}

async function installImpactApi(page: Page) {
  let detail = initialDetail();
  let timeline: TimelineEventDto[] = [initialEvent];
  const requests: Array<{ kind: string; body: unknown }> = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/requirements') {
      return json(route, 200, {
        items: [listItem(detail)],
        nextCursor: null,
        partial: false,
        checkedAt: '2026-09-05T08:10:00.000Z',
      });
    }
    if (url.pathname === `/api/v1/requirements/${requirementId}`) {
      return json(route, 200, detail);
    }
    if (url.pathname.endsWith('/timeline')) {
      return json(route, 200, {
        items: [...timeline].reverse(),
        nextCursor: null,
        partial: false,
        checkedAt: '2026-09-05T08:20:00.000Z',
      });
    }
    if (url.pathname.endsWith('/events')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: 'retry: 60000\n\n',
      });
    }
    if (
      url.pathname.endsWith('/material-impact-assessments') &&
      request.method() === 'POST'
    ) {
      requests.push({ kind: 'create', body: request.postDataJSON() });
      timeline = [
        ...timeline,
        {
          eventId: 'CODEx_TEST_T6_E2E_TIMELINE_002',
          sequence: 2,
          type: 'material-impact.created',
          requirementId,
          aggregateVersion: 4,
          occurredAt: pendingImpact.createdAt,
          beforeSummary: { currentBaselineId: currentBaseline.id },
          afterSummary: {
            status: 'PENDING',
            candidateBaselineId: candidateBaseline.id,
          },
        },
      ];
      detail = {
        ...detail,
        materialBaselines: [currentBaseline, candidateBaseline],
        materialImpacts: [pendingImpact],
      };
      return json(route, 201, {
        replayed: false,
        requirement: {
          id: requirementId,
          currentStage: 'G3',
          currentBaselineId: currentBaseline.id,
          rowVersion: 4,
        },
        assessment: pendingImpact,
      });
    }
    if (
      url.pathname.endsWith(
        `/material-impact-assessments/${pendingImpact.id}/confirmations`,
      ) &&
      request.method() === 'POST'
    ) {
      expect(request.headers()['if-match']).toBe('"4"');
      const body = request.postDataJSON() as { reason: string };
      requests.push({ kind: 'confirm', body });
      const confirmedAt = '2026-09-05T08:20:00.000Z';
      const confirmed: MaterialImpactAssessmentDto = {
        ...pendingImpact,
        selectedStage: 'G1',
        decision: 'IMPACTS',
        reason: body.reason,
        status: 'CONFIRMED',
        confirmedRole: 'BUSINESS_OWNER',
        confirmedBy: 'CODEx_TEST_T6_E2E_OWNER',
        confirmedAt,
        invalidatedGateRunIds: gateRuns.map((run) => run.id),
      };
      timeline = [
        ...timeline,
        {
          eventId: 'CODEx_TEST_T6_E2E_TIMELINE_003',
          sequence: 3,
          type: 'baseline.switched',
          requirementId,
          aggregateVersion: 5,
          occurredAt: confirmedAt,
          beforeSummary: { baselineId: currentBaseline.id, stage: 'G3' },
          afterSummary: {
            baselineId: candidateBaseline.id,
            stage: 'G1',
            decision: 'IMPACTS',
            invalidatedCount: 2,
          },
        },
      ];
      detail = {
        ...detail,
        currentStage: 'G1',
        rowVersion: 5,
        currentBaseline: candidateBaseline,
        materialImpacts: [confirmed],
        gateRuns: gateRuns.map((run) => ({ ...run, validity: 'INVALIDATED' })),
        currentGateRun: null,
        updatedAt: confirmedAt,
      };
      return json(route, 200, {
        replayed: false,
        requirement: {
          id: requirementId,
          currentStage: 'G1',
          currentBaselineId: candidateBaseline.id,
          rowVersion: 5,
        },
        assessment: confirmed,
      });
    }
    return json(route, 404, {
      code: 'NOT_FOUND',
      message: '合成目标不存在。',
      requestId: 'CODEx_TEST_T6_E2E_NOT_FOUND',
      retryable: false,
      recoveryAction: 'RETURN_TO_WORKLIST',
    });
  });
  return { requests };
}

test('新材料确认后切换基线并使下游门禁结论失效', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const api = await installImpactApi(page);
  await page.goto(`/requirements/${requirementId}`);

  await expect(
    page.getByRole('heading', { name: '基线与影响记录' }),
  ).toBeVisible();
  await expect(page.getByLabel('材料基线历史')).toContainText('V1当前');
  await page.getByRole('button', { name: '登记新材料' }).click();
  await page.getByLabel('建议最早受影响门禁').selectOption('G1');
  await page.getByRole('button', { name: '登记候选基线' }).click();

  await expect(page.getByLabel('材料基线历史')).toContainText('V1当前');
  await expect(page.getByLabel('材料基线历史')).toContainText('V2候选');
  await page.getByRole('button', { name: '确认影响' }).click();
  await page
    .getByLabel('确认原因')
    .fill('新访谈改变了边界条件，G1 及其后续结论需要重新验证。');
  await page.getByRole('button', { name: '确认并切换基线' }).click();

  await expect(page.getByLabel('材料基线历史')).toContainText('V1历史');
  await expect(page.getByLabel('材料基线历史')).toContainText('V2当前');
  await expect(page.getByText('2 条旧门禁结论已失效')).toBeVisible();
  await page.getByRole('button', { name: '重新加载时间线' }).click();
  await expect(page.getByText('材料基线已切换')).toBeVisible();
  await expect(page.getByText('G3 → G1')).toBeVisible();
  expect(api.requests).toEqual([
    expect.objectContaining({
      kind: 'create',
      body: expect.objectContaining({ recommendedStage: 'G1' }),
    }),
    expect.objectContaining({
      kind: 'confirm',
      body: expect.objectContaining({
        decision: 'IMPACTS',
        selectedStage: 'G1',
      }),
    }),
  ]);

  const geometry = await page.evaluate(() => ({
    horizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth,
    detailWidth: document.querySelector('.detail-page')?.getBoundingClientRect()
      .width,
  }));
  expect(geometry.horizontalOverflow).toBe(false);
  expect(geometry.detailWidth).toBeGreaterThan(700);
  const storage = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
  }));
  expect(storage.local).not.toContain(protectedIdea);
  expect(storage.session).not.toContain(protectedIdea);
  expect(browserErrors).toEqual([]);
  await page.screenshot({
    path: `docs/quality-gate/reports/assets/CAP-PFC-01-T6/${testInfo.project.name}-impact.png`,
    fullPage: true,
  });
});

test('SSE 通知触发重新鉴权并在权限撤销后清除详情', async ({ page }) => {
  let revoked = false;
  let streamBody = '';
  const detail = initialDetail();
  const revokeEvent = {
    eventId: 'CODEx_TEST_T6_E2E_TIMELINE_REVOKE',
    sequence: 2,
    type: 'permission.changed',
    requirementId,
    aggregateVersion: 4,
    occurredAt: '2026-09-05T08:30:00.000Z',
    beforeSummary: { access: 'ALLOW' },
    afterSummary: { access: 'DENY' },
  };
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/requirements/${requirementId}`) {
      return revoked
        ? json(route, 403, {
            code: 'PERMISSION_DENIED',
            message: '权限已撤销。',
            requestId: 'CODEx_TEST_T6_E2E_REVOKED',
            retryable: false,
            recoveryAction: 'RETURN_TO_WORKLIST',
          })
        : json(route, 200, detail);
    }
    if (url.pathname.endsWith('/timeline')) {
      return revoked
        ? json(route, 403, {
            code: 'PERMISSION_DENIED',
            message: '权限已撤销。',
            requestId: 'CODEx_TEST_T6_E2E_TIMELINE_REVOKED',
            retryable: false,
            recoveryAction: 'RETURN_TO_WORKLIST',
          })
        : json(route, 200, {
            items: [initialEvent],
            nextCursor: null,
            partial: false,
            checkedAt: '2026-09-05T08:10:00.000Z',
          });
    }
    if (url.pathname.endsWith('/events')) {
      revoked = true;
      streamBody = `id: ${revokeEvent.sequence}\ndata: ${JSON.stringify(revokeEvent)}\nretry: 60000\n\n`;
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: streamBody,
      });
    }
    return json(route, 404, {});
  });

  await page.goto(`/requirements/${requirementId}`);
  await expect(page.getByText('你没有查看该需求的权限')).toBeVisible();
  await expect(page.getByText(detail.name)).toHaveCount(0);
  await expect(page.getByText(protectedIdea)).toHaveCount(0);
  expect(streamBody).not.toContain(protectedIdea);
});
