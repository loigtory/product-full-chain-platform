import { expect, test, type Page, type Route } from 'playwright/test';

const requirementId = 'CODEx_TEST_T3_E2E_REQ_001';
const deniedRequirementId = 'CODEx_TEST_T3_E2E_REQ_DENIED';

const incompleteDetail = {
  id: requirementId,
  name: '渠道规则统一登记',
  originalIdea: '统一多渠道需求的优先级判断和登记依据。',
  initiatorId: 'CODEx_TEST_T3_E2E_ACTOR_PM',
  businessOwnerId: null,
  currentStage: 'G0',
  rowVersion: 0,
  registration: {},
  missingFields: [
    'sourceType',
    'businessOwnerId',
    'materialPurpose',
    'sensitivity',
  ],
  gateProjection: 'BLOCK',
  currentBaseline: null,
  questions: [],
  currentGateRun: null,
  gateRuns: [],
  gateExecution: {
    status: 'UNAVAILABLE',
    capabilityVersion: 'fixture/t5/v1',
    checkedAt: '2026-09-05T02:00:00.000Z',
    reasonCode: 'CAPABILITY_NOT_CONFIGURED',
  },
  createdAt: '2026-09-05T02:00:00.000Z',
  updatedAt: '2026-09-05T02:00:00.000Z',
} as const;

const completeDetail = {
  ...incompleteDetail,
  businessOwnerId: 'CODEx_TEST_T3_E2E_ACTOR_OWNER',
  rowVersion: 1,
  registration: {
    sourceType: 'OTHER',
    sourceDescription: '来自跨部门专题讨论，原分类无法准确覆盖',
    businessOwnerId: 'CODEx_TEST_T3_E2E_ACTOR_OWNER',
    materialPurpose: 'CONSTRAINT',
    sensitivity: 'RESTRICTED',
  },
  missingFields: [],
  gateProjection: 'NOT_STARTED',
  currentBaseline: {
    id: 'CODEx_TEST_T3_E2E_BASELINE_001',
    versionNumber: 1,
    sourceType: 'OTHER',
    sourceDescription: '来自跨部门专题讨论，原分类无法准确覆盖',
    materialPurpose: 'CONSTRAINT',
    sensitivity: 'RESTRICTED',
    confirmedBy: 'CODEx_TEST_T3_E2E_ACTOR_PM',
    confirmedAt: '2026-09-05T02:05:00.000Z',
  },
} as const;

function listItem(id = requirementId, name = incompleteDetail.name) {
  return {
    id,
    name,
    currentStage: 'G0',
    gateProjection: 'BLOCK',
    ownerId: 'CODEx_TEST_T3_E2E_ACTOR_PM',
    nextAction: '补齐 G0 登记',
    updatedAt: incompleteDetail.updatedAt,
    dependencyStatus: 'AVAILABLE',
    warningCode: null,
  };
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
      checkedAt: '2026-09-05T02:00:00.000Z',
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

async function installApi(page: Page) {
  let detail: typeof incompleteDetail | typeof completeDetail =
    incompleteDetail;
  const creates: Array<{ body: unknown; key: string | undefined }> = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/requirements' && request.method() === 'GET') {
      const items = url.searchParams.get('search') ? [] : [listItem()];
      return json(route, 200, {
        items,
        nextCursor: null,
        partial: false,
        checkedAt: '2026-09-05T02:00:00.000Z',
      });
    }
    if (
      url.pathname === '/api/v1/requirements' &&
      request.method() === 'POST'
    ) {
      creates.push({
        body: request.postDataJSON(),
        key: request.headers()['idempotency-key'],
      });
      detail = incompleteDetail;
      return json(route, 201, { replayed: false, requirement: detail });
    }
    if (
      url.pathname ===
        `/api/v1/requirements/${requirementId}/g0-registration` &&
      request.method() === 'PATCH'
    ) {
      expect(request.headers()['if-match']).toBe('"0"');
      expect(request.headers()['idempotency-key']).toMatch(
        /^CODEx_TEST_T4_E2E_COMPLETE_/,
      );
      detail = completeDetail;
      return json(route, 200, { replayed: false, requirement: detail });
    }
    if (url.pathname === `/api/v1/requirements/${requirementId}`) {
      return json(route, 200, detail);
    }
    if (url.pathname === `/api/v1/requirements/${deniedRequirementId}`) {
      return json(route, 403, {
        code: 'PERMISSION_DENIED',
        message: '你没有执行此操作的权限。',
        requestId: 'CODEx_TEST_T3_E2E_REQUEST_DENIED',
        retryable: false,
        recoveryAction: 'RETURN_TO_WORKLIST',
      });
    }
    const timelineRead = emptyTimelineRead(route, url);
    if (timelineRead) return timelineRead;
    return json(route, 404, {
      code: 'NOT_FOUND',
      message: '目标需求不存在或不可用。',
      requestId: 'CODEx_TEST_T3_E2E_REQUEST_NOT_FOUND',
      retryable: false,
      recoveryAction: 'RETURN_TO_WORKLIST',
    });
  });
  return { creates };
}

test('PC 工作台完成缺项草稿到 G0 NOT_STARTED', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  const sensitiveRequestHeaders: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('request', (request) => {
    const headers = request.headers();
    if (headers.authorization || headers.cookie)
      sensitiveRequestHeaders.push(request.url());
  });
  const api = await installApi(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '需求工作台' })).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: '当前阶段' }),
  ).toBeVisible();
  const workbenchLayout = await page.evaluate(() => {
    const header = document
      .querySelector('.pfc-global-header')
      ?.getBoundingClientRect();
    const intro = document
      .querySelector('.pfc-page-intro')
      ?.getBoundingClientRect();
    const controls = document.querySelector('.worklist-controls');
    const table = document
      .querySelector("table[aria-label='需求列表']")
      ?.getBoundingClientRect();
    return {
      compactHeader:
        document
          .querySelector('.pfc-global-header')
          ?.getAttribute('data-density') === 'compact',
      compactIntro:
        document
          .querySelector('.pfc-page-intro')
          ?.getAttribute('data-density') === 'compact',
      controlsContainScope: Boolean(
        controls?.querySelector("nav[aria-label='需求范围']"),
      ),
      controlsContainSearch: Boolean(
        controls?.querySelector("input[aria-label='搜索需求']"),
      ),
      controlsContainView: Boolean(
        controls?.querySelector("[aria-label='视图']"),
      ),
      headerHeight: header?.height,
      introHeight: intro?.height,
      tableTop: table?.top,
      tableWidth: table?.width,
    };
  });
  expect(workbenchLayout).toMatchObject({
    compactHeader: true,
    compactIntro: true,
    controlsContainScope: true,
    controlsContainSearch: true,
    controlsContainView: true,
    headerHeight: 56,
  });
  expect(workbenchLayout.introHeight).toBeLessThanOrEqual(96);
  expect(workbenchLayout.tableTop).toBeLessThan(320);
  expect(workbenchLayout.tableWidth).toBeLessThanOrEqual(1320);
  await expect(page.getByText(requirementId, { exact: true })).toHaveCount(0);
  const supportedViewport = page.viewportSize();
  expect(supportedViewport).not.toBeNull();
  await expect(page.locator('.desktop-width-notice')).toBeHidden();
  await page.setViewportSize({
    width: 1119,
    height: supportedViewport!.height,
  });
  await expect(page.locator('.desktop-width-notice')).toBeVisible();
  const compatibilityGeometry = await page.evaluate(() => {
    const notice = document
      .querySelector('.desktop-width-notice')
      ?.getBoundingClientRect();
    const header = document
      .querySelector('.pfc-global-header')
      ?.getBoundingClientRect();
    return { headerTop: header?.top, noticeBottom: notice?.bottom };
  });
  expect(compatibilityGeometry).toEqual({ headerTop: 44, noticeBottom: 44 });
  await page.setViewportSize(supportedViewport!);
  await expect(page.locator('.desktop-width-notice')).toBeHidden();
  await page.screenshot({
    path: `docs/quality-gate/reports/assets/CAP-PFC-01-T3/${testInfo.project.name}-worklist.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '按阶段' }).click();
  await expect(page.getByTestId('stage-board')).toContainText('G12');
  await expect(page.locator('[draggable="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: '表格' }).click();
  await page.getByRole('searchbox', { name: '搜索需求' }).fill('无匹配项');
  await expect(page.getByText('没有匹配的需求')).toBeVisible();
  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(
    page.getByRole('button', { name: incompleteDetail.name }),
  ).toBeVisible();

  const createTrigger = page.getByRole('button', { name: '新建需求' });
  await createTrigger.focus();
  await createTrigger.click();
  const createDialog = page.getByRole('dialog', { name: '新建需求' });
  await expect(page.getByLabel('需求名称')).toBeFocused();
  await createDialog.getByRole('button', { name: '保存草稿' }).focus();
  await page.keyboard.press('Tab');
  await expect(
    createDialog.getByRole('button', { name: '关闭' }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    createDialog.getByRole('button', { name: '保存草稿' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(createDialog).toBeHidden();
  await expect(createTrigger).toBeFocused();
  await createTrigger.click();
  await page.getByLabel('需求名称').fill(incompleteDetail.name);
  await page.getByLabel('原始想法').fill(incompleteDetail.originalIdea);
  await page.getByRole('button', { name: '保存草稿' }).click();

  await expect(
    page.getByRole('heading', { name: '补齐 G0 登记信息' }),
  ).toBeVisible();
  await expect(page.getByText('阻断')).toBeVisible();
  await expect(page.getByText('敏感边界')).toBeVisible();
  expect(api.creates).toHaveLength(1);
  expect(api.creates[0]?.key).toMatch(/^CODEx_TEST_T4_E2E_CREATE_/);

  await page.getByRole('button', { name: '补齐 G0 信息' }).click();
  await expect(page.getByLabel('需求名称')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('原始想法')).toHaveAttribute('readonly', '');
  await page.getByLabel('来源').selectOption('OTHER');
  await page
    .getByLabel('来源说明')
    .fill('来自跨部门专题讨论，原分类无法准确覆盖');
  await page.getByLabel('业务责任人').fill('CODEx_TEST_T3_E2E_ACTOR_OWNER');
  await page.getByLabel('材料用途').selectOption('CONSTRAINT');
  await page.getByLabel('内部受限').check();
  await page.getByRole('button', { name: '保存补充' }).click();

  await expect(
    page.getByRole('heading', { name: 'G0 登记已完整' }),
  ).toBeVisible();
  await expect(page.getByText('未开始').first()).toBeVisible();
  await expect(page.getByText('G0 PASS')).toHaveCount(0);
  await expect(
    page.getByText('来自跨部门专题讨论，原分类无法准确覆盖'),
  ).toBeVisible();

  const geometry = await page.evaluate(() => {
    const header = document
      .querySelector('.pfc-global-header')
      ?.getBoundingClientRect();
    const workspace = document
      .querySelector('.workspace')
      ?.getBoundingClientRect();
    return {
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      regionsOverlap: Boolean(
        header && workspace && header.bottom > workspace.top,
      ),
    };
  });
  expect(geometry).toEqual({
    horizontalOverflow: false,
    regionsOverlap: false,
  });
  const browserStorage = await page.evaluate(() => ({
    localStorageKeys: Object.keys(localStorage),
    sessionStorageKeys: Object.keys(sessionStorage),
    viewState: sessionStorage.getItem('pfc.workbench.view.v1'),
  }));
  expect(browserStorage).toEqual({
    localStorageKeys: [],
    sessionStorageKeys: ['pfc.workbench.view.v1'],
    viewState: JSON.stringify({ scope: 'ALL', view: 'TABLE', search: '' }),
  });
  expect(browserStorage.viewState).not.toContain(incompleteDetail.originalIdea);
  expect(sensitiveRequestHeaders).toEqual([]);
  expect(browserErrors).toEqual([]);
  await page.screenshot({
    path: `docs/quality-gate/reports/assets/CAP-PFC-01-T3/${testInfo.project.name}-detail.png`,
    fullPage: true,
  });
});

test('无权详情不渲染受保护正文', async ({ page }) => {
  await installApi(page);
  await page.goto(`/requirements/${deniedRequirementId}`);
  await expect(page.getByText('你没有查看该需求的权限')).toBeVisible();
  await expect(page.getByText('protected-original-idea')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '返回需求工作台' }),
  ).toBeVisible();
});

test('创建结果未知时只读核验后进入唯一草稿', async ({ page }) => {
  let createAttempts = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/requirements' && request.method() === 'GET') {
      return json(route, 200, {
        items: [listItem()],
        nextCursor: null,
        partial: false,
        checkedAt: '2026-09-05T02:00:00.000Z',
      });
    }
    if (
      url.pathname === '/api/v1/requirements' &&
      request.method() === 'POST'
    ) {
      createAttempts += 1;
      return route.abort('timedout');
    }
    if (url.pathname.startsWith('/api/v1/requirement-submissions/')) {
      return json(route, 200, {
        status: 'CREATED',
        existingResourceId: requirementId,
      });
    }
    if (url.pathname === `/api/v1/requirements/${requirementId}`) {
      return json(route, 200, incompleteDetail);
    }
    const timelineRead = emptyTimelineRead(route, url);
    if (timelineRead) return timelineRead;
    return route.fallback();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新建需求' }).click();
  await page.getByLabel('需求名称').fill(incompleteDetail.name);
  await page.getByLabel('原始想法').fill(incompleteDetail.originalIdea);
  await page.getByRole('button', { name: '保存草稿' }).click();

  await expect(page.getByText('保存结果待核验')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '再次提交' })).toHaveCount(0);
  await page.getByRole('button', { name: '核验保存结果' }).click();
  await expect(
    page.getByRole('heading', { name: '补齐 G0 登记信息' }),
  ).toBeVisible();
  expect(createAttempts).toBe(1);
});

test('问题抽屉保存原始回答但不执行 GateRun', async ({ page }, testInfo) => {
  const questionId = 'CODEx_TEST_T4_E2E_QUESTION_001';
  const baselineId = 'CODEx_TEST_T4_E2E_BASELINE_001';
  const browserErrors: string[] = [];
  const sensitiveRequestHeaders: string[] = [];
  const answers: Array<{
    body: unknown;
    idempotencyKey: string | undefined;
    ifMatch: string | undefined;
  }> = [];
  const openQuestion = {
    id: questionId,
    requirementId,
    baselineId,
    prompt: '本版本采用哪种结算口径？',
    reason: '当前门禁必须有唯一口径。',
    candidates: ['按实结算', '按预算结算'],
    ownerId: 'CODEx_TEST_T4_E2E_ACTOR_OWNER',
    closeByStage: 'G1',
    status: 'OPEN',
    currentDecisionId: null,
    rowVersion: 0,
    supersededByQuestionId: null,
    decisions: [],
    createdAt: '2026-09-05T05:00:00.000Z',
    updatedAt: '2026-09-05T05:00:00.000Z',
  } as const;
  const answeredQuestion = {
    ...openQuestion,
    status: 'ANSWERED',
    currentDecisionId: 'CODEx_TEST_T4_E2E_DECISION_001',
    rowVersion: 1,
    decisions: [
      {
        id: 'CODEx_TEST_T4_E2E_DECISION_001',
        questionId,
        kind: 'ANSWER',
        rawAnswer: '按实结算',
        explanation: '以实际核定金额为准。',
        scope: {
          questionId,
          requirementId,
          baselineId,
          closeByStage: 'G1',
        },
        versionNumber: 1,
        confirmedRole: null,
        confirmedBy: null,
        confirmedAt: null,
        validity: 'CURRENT',
        supersedesDecisionId: null,
        createdAt: '2026-09-05T05:01:00.000Z',
      },
    ],
    updatedAt: '2026-09-05T05:01:00.000Z',
  } as const;
  let currentQuestion: typeof openQuestion | typeof answeredQuestion =
    openQuestion;

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('request', (request) => {
    const headers = request.headers();
    if (headers.authorization || headers.cookie) {
      sensitiveRequestHeaders.push(request.url());
    }
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.pathname ===
        `/api/v1/requirements/${requirementId}/questions/${questionId}/answers` &&
      request.method() === 'POST'
    ) {
      answers.push({
        body: request.postDataJSON(),
        idempotencyKey: request.headers()['idempotency-key'],
        ifMatch: request.headers()['if-match'],
      });
      currentQuestion = answeredQuestion;
      return json(route, 200, {
        action: 'ANSWER',
        replayed: false,
        question: answeredQuestion,
      });
    }
    if (url.pathname === `/api/v1/requirements/${requirementId}`) {
      return json(route, 200, {
        ...completeDetail,
        currentBaseline: {
          ...completeDetail.currentBaseline,
          id: baselineId,
        },
        questions: [currentQuestion],
      });
    }
    const timelineRead = emptyTimelineRead(route, url);
    if (timelineRead) return timelineRead;
    return json(route, 404, {
      code: 'NOT_FOUND',
      message: '测试目标不存在。',
      requestId: 'CODEx_TEST_T4_E2E_REQUEST_NOT_FOUND',
      retryable: false,
      recoveryAction: 'RETURN_TO_WORKLIST',
    });
  });

  await page.goto(`/requirements/${requirementId}`);
  const questionTrigger = page.getByRole('button', {
    name: /处理问题.*结算口径/,
  });
  await questionTrigger.focus();
  await questionTrigger.click();
  const drawer = page.getByRole('dialog', { name: '问题与决定' });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole('button', { name: '关闭问题与决定' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(questionTrigger).toBeFocused();
  await questionTrigger.click();
  await expect(drawer.getByText(baselineId)).toBeVisible();
  await drawer.getByRole('button', { name: '按实结算' }).click();
  await drawer.getByLabel('回答说明').fill('以实际核定金额为准。');
  await drawer.getByRole('button', { name: '保存原始回答' }).click();

  await expect(drawer.getByTitle('原始状态：ANSWERED')).toHaveText('已回答');
  await expect(drawer.getByText('GateRun PASS')).toHaveCount(0);
  expect(answers).toEqual([
    {
      body: {
        rawAnswer: '按实结算',
        explanation: '以实际核定金额为准。',
      },
      idempotencyKey: expect.stringMatching(
        /^CODEx_TEST_T4_E2E_QUESTION_ANSWER_/,
      ),
      ifMatch: '"0"',
    },
  ]);

  const geometry = await drawer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const overflowingText = Array.from(
      element.querySelectorAll<HTMLElement>('button, dd, h2, h3, p, span'),
    ).some((node) => node.scrollWidth > node.clientWidth + 1);
    return {
      leftWithinViewport: bounds.left >= 0,
      rightWithinViewport: bounds.right <= window.innerWidth,
      overflowingText,
    };
  });
  expect(geometry).toEqual({
    leftWithinViewport: true,
    rightWithinViewport: true,
    overflowingText: false,
  });
  expect(sensitiveRequestHeaders).toEqual([]);
  expect(browserErrors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('question-drawer-answered.png'),
    fullPage: false,
  });
});
