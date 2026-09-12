import { expect, test, type Page, type Route } from 'playwright/test';

const now = '2026-09-05T13:30:00.000Z';
const requirementId = 'CODEx_TEST_UI_R6_E2E_REQ';
const baselineId = 'CODEx_TEST_UI_R6_E2E_BASELINE_2';

const detail = {
  id: requirementId,
  name: '结算材料影响评估',
  originalIdea: '核对新增访谈材料对当前结算方案的影响。',
  initiatorId: 'CODEx_TEST_UI_R6_E2E_ACTOR',
  businessOwnerId: 'CODEx_TEST_UI_R6_E2E_OWNER',
  currentStage: 'G3',
  rowVersion: 4,
  registration: {
    sourceType: 'USER_INTERVIEW',
    businessOwnerId: 'CODEx_TEST_UI_R6_E2E_OWNER',
    materialPurpose: 'FACT',
    sensitivity: 'INTERNAL',
  },
  missingFields: [],
  gateProjection: 'WARN',
  currentBaseline: {
    id: baselineId,
    versionNumber: 2,
    sourceType: 'USER_INTERVIEW',
    sourceDescription: null,
    materialPurpose: 'FACT',
    sensitivity: 'INTERNAL',
    confirmedBy: 'CODEx_TEST_UI_R6_E2E_ACTOR',
    confirmedAt: now,
  },
  materialBaselines: [],
  materialImpacts: [],
  questions: [],
  currentGateRun: null,
  gateRuns: [],
  gateExecution: {
    status: 'AVAILABLE',
    capabilityVersion: 'fixture/ui-r6/v1',
    checkedAt: now,
    reasonCode: null,
  },
  createdAt: now,
  updatedAt: now,
} as const;

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

async function installApi(page: Page) {
  const gateQueries: URLSearchParams[] = [];
  const materialQueries: URLSearchParams[] = [];
  const requestMethods: string[] = [];
  let detailReads = 0;
  await page.route('**/api/v1/**', async (route) => {
    requestMethods.push(route.request().method());
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/gate-center') {
      gateQueries.push(url.searchParams);
      return json(route, {
        items: [
          {
            key: `CURRENT:${requirementId}`,
            requirementId,
            requirementName: detail.name,
            requirementStage: 'G3',
            stage: 'G3',
            baselineId,
            gateRunId: 'CODEx_TEST_UI_R6_E2E_GATE',
            mode: 'AUTOMATIC',
            status: 'WARN',
            validity: 'CURRENT',
            ownerId: detail.businessOwnerId,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
            nextAction: '处理门禁警告',
            historyCount: 3,
          },
        ],
        nextCursor: null,
        checkedAt: now,
      });
    }
    if (url.pathname === '/api/v1/material-library') {
      materialQueries.push(url.searchParams);
      return json(route, {
        items: [
          {
            baselineId,
            requirementId,
            requirementName: detail.name,
            requirementStage: 'G3',
            versionNumber: 2,
            status: 'CANDIDATE',
            sourceType: 'USER_INTERVIEW',
            sourceDescription: null,
            materialPurpose: 'FACT',
            sensitivity: 'INTERNAL',
            confirmedBy: detail.initiatorId,
            confirmedAt: now,
            createdAt: now,
            materialRefs: [
              {
                id: 'CODEx_TEST_UI_R6_E2E_REF',
                referenceType: 'USER_INTERVIEW_NOTE',
                source: 'SYNTHETIC_TEST',
                version: '1',
                sensitivity: 'INTERNAL',
                validity: 'VALID',
              },
            ],
            pendingImpact: {
              id: 'CODEx_TEST_UI_R6_E2E_IMPACT',
              requirementId,
              originalBaselineId: 'CODEx_TEST_UI_R6_E2E_BASELINE_1',
              candidateBaselineId: baselineId,
              recommendedStage: 'G1',
              selectedStage: null,
              decision: null,
              reason: null,
              status: 'PENDING',
              confirmedRole: null,
              confirmedBy: null,
              confirmedAt: null,
              invalidatedGateRunIds: [],
              createdAt: now,
            },
          },
        ],
        nextCursor: null,
        checkedAt: now,
      });
    }
    if (url.pathname === `/api/v1/requirements/${requirementId}`) {
      detailReads += 1;
      return json(route, detail);
    }
    if (url.pathname.endsWith('/timeline')) {
      return json(route, {
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
    return route.fulfill({ status: 404 });
  });
  return {
    gateQueries,
    materialQueries,
    requestMethods,
    detailReads: () => detailReads,
  };
}

async function expectReferenceOperationsLayout(page: Page) {
  const metrics = await page.evaluate(() => {
    function read(selector: string) {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(selector);
      const style = getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        height: element.getBoundingClientRect().height,
        lineHeight: style.lineHeight,
      };
    }
    return {
      header: read('.pfc-global-header'),
      heading: read('.operations-page-intro h1'),
      summary: read('.operations-summary-grid .pfc-summary-panel'),
      search: read('.operations-search'),
      select: read('.operations-toolbar select'),
      refresh: read('.operations-toolbar .pfc-button--icon'),
      tableHeader: read('.operations-table th'),
      tableRow: read('.operations-table tbody tr'),
    };
  });

  expect(metrics.header.height).toBe(65);
  expect(metrics.header.fontFamily).toContain('Noto Sans SC');
  expect(metrics.heading).toMatchObject({
    fontSize: '30px',
    fontWeight: '700',
    lineHeight: '36px',
  });
  expect(metrics.summary.height).toBe(130);
  expect(metrics.search.height).toBe(32);
  expect(metrics.select.height).toBe(32);
  expect(metrics.refresh.height).toBe(32);
  expect(metrics.tableHeader).toMatchObject({
    fontSize: '14px',
    fontWeight: '500',
    height: 40,
    lineHeight: '20px',
  });
  expect(metrics.tableRow).toMatchObject({
    fontSize: '14px',
    fontWeight: '400',
    height: 56,
    lineHeight: '20px',
  });
}

test('门禁中心筛选后进入详情并返回原中心', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const api = await installApi(page);
  await page.goto('/gate-center');

  await expect(page).toHaveURL(/\/gate-center/);
  await expect(page.getByRole('heading', { name: '门禁中心' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '门禁中心', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('region', { name: 'UI-R12 门禁中心' }),
  ).toBeVisible();
  await expectReferenceOperationsLayout(page);
  await page.getByRole('button', { name: '刷新门禁' }).click();
  await expect.poll(() => api.gateQueries.length).toBeGreaterThan(1);
  await page.getByLabel('门禁阶段').selectOption('G3');
  await page.getByLabel('门禁状态').selectOption('WARN');
  await page.getByLabel('运行模式').selectOption('AUTOMATIC');
  await expect
    .poll(() => Object.fromEntries(api.gateQueries.at(-1) ?? []))
    .toMatchObject({
      view: 'CURRENT',
      stage: 'G3',
      status: 'WARN',
      mode: 'AUTOMATIC',
    });
  expect(api.detailReads()).toBe(0);

  await page.getByRole('button', { name: detail.name }).click();
  await expect(page).toHaveURL(
    `/requirements/${requirementId}?from=gate-center`,
  );
  await expect(page.getByRole('heading', { name: detail.name })).toBeVisible();
  await page.getByRole('button', { name: '返回门禁中心' }).click();
  await expect(page.getByRole('heading', { name: '门禁中心' })).toBeVisible();
  await expect(page.getByLabel('门禁状态')).toHaveValue('WARN');
  expect(api.detailReads()).toBe(1);
  expect(api.requestMethods.every((method) => method === 'GET')).toBe(true);

  const geometry = await page.evaluate(() => ({
    horizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth,
    toolbarOverflow: Array.from(
      document.querySelectorAll<HTMLElement>(
        '.operations-toolbar input, .operations-toolbar select, .operations-toolbar button',
      ),
    )
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => ({
        tag: node.tagName,
        label: node.getAttribute('aria-label') ?? node.textContent?.trim(),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      })),
  }));
  expect(geometry).toEqual({
    horizontalOverflow: false,
    toolbarOverflow: [],
  });
  expect(browserErrors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('gate-center.png'),
    fullPage: true,
  });
});

test('材料库查看引用并进入待确认影响处理', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const api = await installApi(page);
  await page.goto('/material-library');

  await expect(page.getByRole('heading', { name: '材料库' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '材料库', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('region', { name: 'UI-R12 材料库' }),
  ).toBeVisible();
  await expectReferenceOperationsLayout(page);
  await page.getByRole('button', { name: '刷新材料' }).click();
  await expect.poll(() => api.materialQueries.length).toBeGreaterThan(1);
  await page.getByLabel('基线状态').selectOption('CANDIDATE');
  await page.getByLabel('材料来源').selectOption('USER_INTERVIEW');
  await expect
    .poll(() => Object.fromEntries(api.materialQueries.at(-1) ?? []))
    .toMatchObject({
      status: 'CANDIDATE',
      sourceType: 'USER_INTERVIEW',
    });
  await page
    .getByRole('table', { name: '材料库' })
    .getByText('1 个引用')
    .click();
  await expect(page.getByText('USER_INTERVIEW_NOTE')).toBeVisible();
  await expect(page.getByText('待确认 · 建议回退 G1')).toBeVisible();
  expect(api.detailReads()).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath('material-library.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: '处理影响' }).click();
  await expect(page).toHaveURL(
    `/requirements/${requirementId}?from=material-library`,
  );
  await expect(page.getByRole('heading', { name: detail.name })).toBeVisible();
  expect(api.detailReads()).toBe(1);
  expect(api.requestMethods.every((method) => method === 'GET')).toBe(true);
  expect(browserErrors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('material-detail.png'),
    fullPage: true,
  });
});
