import { expect, test, type Route } from 'playwright/test';

const items = [
  {
    id: 'CODEx_TEST_UI_R10_E2E_REQ_BLOCKED',
    name: '待补齐登记的渠道需求',
    currentStage: 'G0',
    gateProjection: 'BLOCK',
    ownerId: 'CODEx_TEST_UI_R10_E2E_OWNER_A',
    nextAction: '补齐 G0 登记',
    updatedAt: '2026-09-05T08:03:00.000Z',
    dependencyStatus: 'AVAILABLE',
    warningCode: null,
  },
  {
    id: 'CODEx_TEST_UI_R10_E2E_REQ_WARN',
    name: '材料变更影响评估',
    currentStage: 'G3',
    gateProjection: 'WARN',
    ownerId: 'CODEx_TEST_UI_R10_E2E_OWNER_B',
    nextAction: '处理门禁警告',
    updatedAt: '2026-09-05T08:02:00.000Z',
    dependencyStatus: 'AVAILABLE',
    warningCode: null,
  },
  {
    id: 'CODEx_TEST_UI_R10_E2E_REQ_READY',
    name: '可执行门禁的结算规则',
    currentStage: 'G6',
    gateProjection: 'NOT_STARTED',
    ownerId: 'CODEx_TEST_UI_R10_E2E_OWNER_C',
    nextAction: '运行当前门禁',
    updatedAt: '2026-09-05T08:01:00.000Z',
    dependencyStatus: 'AVAILABLE',
    warningCode: null,
  },
] as const;

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

test('UI-R11 独立工作台保持真实读取边界与完整桌面交互', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  const requestMethods: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requestMethods.push(request.method());
    if (url.pathname === '/api/v1/requirements') {
      const search = url.searchParams.get('search') ?? '';
      return json(route, 200, {
        items: items.filter((item) => item.name.includes(search)),
        nextCursor: null,
        partial: false,
        checkedAt: '2026-09-05T08:05:00.000Z',
      });
    }
    const selected = items.find(
      (item) => url.pathname === `/api/v1/requirements/${item.id}`,
    );
    if (selected) {
      return json(route, 200, {
        ...selected,
        originalIdea: '核对材料变化对当前产品需求和后续交付的影响。',
        initiatorId: 'CODEx_TEST_UI_R10_E2E_INITIATOR',
        businessOwnerId: selected.ownerId,
        rowVersion: 2,
        registration: {
          sourceType: 'BUSINESS_FEEDBACK',
          businessOwnerId: selected.ownerId,
          materialPurpose: 'CONSTRAINT',
          sensitivity: 'INTERNAL',
        },
        missingFields: [],
        currentBaseline: null,
        questions: [],
        currentGateRun: null,
        gateRuns: [],
        gateExecution: {
          status: 'AVAILABLE',
          capabilityVersion: 'fixture/ui-r10/v1',
          checkedAt: '2026-09-05T08:05:00.000Z',
          reasonCode: null,
        },
        createdAt: '2026-09-05T07:00:00.000Z',
      });
    }
    return json(route, 404, {
      code: 'NOT_FOUND',
      message: '测试目标不存在。',
      requestId: 'CODEx_TEST_UI_R10_E2E_NOT_FOUND',
      retryable: false,
      recoveryAction: 'RETURN_TO_WORKLIST',
    });
  });

  await page.goto(
    '/ui-preview/workbench?scope=ALL&view=TABLE&sort=UPDATED_DESC',
  );
  const main = page.getByRole('main', {
    name: 'UI-R11 需求工作台预览',
  });
  await expect(main).toBeVisible();
  await expect(page).toHaveTitle(/Product Full Chain/);
  await expect(main.getByText('本地数据库 · 只读')).toBeVisible();
  await expect(page.getByRole('button', { name: '新建需求' })).toHaveCount(0);
  await expect(main.getByLabel('当前需求 3')).toBeVisible();
  await expect(page.getByRole('button', { name: '需求管理' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const visualContract = await page.evaluate(() => {
    function metrics(selector: string) {
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
    const metricCard = document.querySelector('.pfc-metric-card');
    const previewMain = document.querySelector('.preview-main');
    const workContent = document.querySelector('.preview-container');
    if (!(metricCard instanceof HTMLElement)) throw new Error('metric card');
    if (!(previewMain instanceof HTMLElement)) throw new Error('preview main');
    if (!(workContent instanceof HTMLElement)) throw new Error('work content');
    const workContentRect = workContent.getBoundingClientRect();
    return {
      shell: metrics('.preview-shell'),
      heading: metrics('.preview-page-heading h1'),
      metricLabel: metrics('.pfc-metric-card__label'),
      metricValue: metrics('.pfc-metric-card strong'),
      metricCard: metrics('.pfc-metric-card'),
      summaryPanel: metrics('.pfc-summary-panel'),
      selectedFilter: metrics(
        ".preview-filter-panel .pfc-segmented__item[aria-pressed='true']",
      ),
      search: metrics('.preview-filter-panel .pfc-search-field'),
      tableHeader: metrics('.preview-table th'),
      tableRow: metrics('.preview-table tbody tr'),
      metricAccent: getComputedStyle(metricCard, '::before').content,
      pageBackground: getComputedStyle(previewMain).backgroundColor,
      workContent: {
        left: workContentRect.left,
        width: workContentRect.width,
      },
    };
  });
  expect(visualContract.shell.fontFamily).toContain('Noto Sans SC');
  expect(visualContract.shell.fontFamily.indexOf('Noto Sans SC')).toBeLessThan(
    visualContract.shell.fontFamily.indexOf('Segoe UI'),
  );
  expect(visualContract.heading).toMatchObject({
    fontSize: '30px',
    fontWeight: '700',
    lineHeight: '36px',
  });
  expect(visualContract.metricLabel).toMatchObject({
    fontSize: '14px',
    fontWeight: '400',
    lineHeight: '20px',
  });
  expect(visualContract.metricValue).toMatchObject({
    fontSize: '30px',
    fontWeight: '700',
    lineHeight: '36px',
  });
  expect(visualContract.metricCard.height).toBe(152);
  expect(visualContract.summaryPanel.height).toBe(130);
  expect(visualContract.selectedFilter).toMatchObject({
    fontSize: '14px',
    fontWeight: '400',
    height: 32,
    lineHeight: '20px',
  });
  expect(visualContract.search.height).toBe(32);
  expect(visualContract.tableHeader).toMatchObject({
    fontSize: '14px',
    fontWeight: '500',
    height: 40,
    lineHeight: '20px',
  });
  expect(visualContract.tableRow).toMatchObject({ height: 45 });
  expect(visualContract.metricAccent).toBe('none');
  expect(visualContract.pageBackground).toBe('rgb(255, 255, 255)');
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const expectedContentWidth = Math.min(viewportWidth - 32, 1248);
  expect(visualContract.workContent).toEqual({
    left: (viewportWidth - expectedContentWidth) / 2,
    width: expectedContentWidth,
  });

  const search = page.getByRole('searchbox', { name: '搜索需求' });
  await search.focus();
  const focusStyle = await search.locator('..').evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderColor: style.borderColor, boxShadow: style.boxShadow };
  });
  expect(focusStyle.boxShadow).not.toBe('none');
  await search.fill('材料');
  await expect(page).toHaveURL(/search=%E6%9D%90%E6%96%99/);
  await expect(page.getByText('材料变更影响评估')).toBeVisible();
  await expect(page.getByText('待补齐登记的渠道需求')).toHaveCount(0);
  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(page.getByText('待补齐登记的渠道需求')).toBeVisible();

  await page.getByRole('button', { name: '按阶段' }).click();
  await expect(page).toHaveURL(/view=STAGE/);
  await expect(page.getByTestId('preview-stage-board')).toBeVisible();
  const detailTrigger = page.getByRole('button', {
    name: /材料变更影响评估，查看详情/,
  });
  await detailTrigger.focus();
  await detailTrigger.click();
  const detail = page.getByRole('complementary', { name: '需求详情' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('只读详情')).toBeVisible();
  await expect(
    detail.getByText('核对材料变化对当前产品需求和后续交付的影响。'),
  ).toBeVisible();
  await expect(page).toHaveURL(/selected=CODEx_TEST_UI_R10_E2E_REQ_WARN/);
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(detailTrigger).toBeFocused();

  await page.evaluate(() => window.scrollTo(0, 0));
  const geometry = await page.evaluate(() => {
    const header = document
      .querySelector('.pfc-reference-header')
      ?.getBoundingClientRect();
    const main = document
      .querySelector('.preview-main')
      ?.getBoundingClientRect();
    const overflowingText = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.preview-table td, .preview-filter-panel button, .pfc-metric-card',
      ),
    ).some((node) => node.scrollWidth > node.clientWidth + 1);
    return {
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      regionsOverlap: Boolean(header && main && header.bottom > main.top),
      overflowingText,
    };
  });
  expect(geometry).toEqual({
    horizontalOverflow: false,
    regionsOverlap: false,
    overflowingText: false,
  });
  expect(requestMethods.every((method) => method === 'GET')).toBe(true);
  expect(browserErrors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('ui-r10-workbench.png'),
    fullPage: true,
  });
});
