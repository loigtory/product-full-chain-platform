import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  fixture,
  runId,
  planData,
  resultData,
} from '../../server/test-data/m2c-release-fixture.mjs';
const out = resolve(
  'docs/quality-gate/reports/m2c-4-release-observation-20260913/release',
);
mkdirSync(out, { recursive: true });
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  browser: 'Browser plugin not available; existing Playwright Edge',
  results: [],
  errors: [],
  external: [],
};
let f, browser, page;
const test = async (name, work) => {
  let timer;
  try {
    await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error('BROWSER_TIMEOUT ' + name)),
          45000,
        );
      }),
    ]);
    report.results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } finally {
    clearTimeout(timer);
  }
};
try {
  f = await fixture();
  const item = await f.accepted('browser'),
    other = await f.accepted('browser_other');
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    timeout: 30000,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  await ctx.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      report.external.push('NON_LOOPBACK');
      return route.abort();
    }
    return route.continue();
  });
  await ctx.addInitScript(
    ({ base, name }) => {
      window.PFC_DATA_MODE = 'api';
      window.PFC_API_BASE = base;
      window.PFC_USER_NAME = name;
    },
    { base: f.baseUrl, name: runId + '_owner' },
  );
  page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(
    pathToFileURL(resolve('output/pfc-workbench-prototype/index.html')).href,
  );
  await page.waitForFunction(
    () => window.PFCAPI?.api.ready || window.PFC?.remoteError,
  );
  assert.equal(await page.evaluate(() => window.PFC.remoteError), null);
  const go = async (id, stage = 'release') => {
    await page.evaluate(
      ({ id, stage }) =>
        window.PFC.go({ route: 'work', req: id, stage, panel: 'canvas' }),
      { id, stage },
    );
    await page.waitForFunction(
      (id) => !!window.PFC.releaseClient.states[id],
      id,
    );
  };
  const idle = () =>
    page.waitForFunction(() => !window.PFC.pendingActions?.size);
  const click = async (action, suffix = '') => {
    await idle();
    const sel = 'button[data-action="' + action + '"]' + suffix,
      modal = page.locator('#modal-root ' + sel);
    await ((await modal.count()) ? modal : page.locator(sel)).first().click();
    await idle();
  };
  const fill = (name, value) =>
    page.locator('#modal-root [name="' + name + '"]').fill(String(value));
  const closed = () =>
    page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await go(item.id);
  await test('T01/T17 early draft input survives reload and requirement switching', async () => {
    await click('m4-plan-new');
    await fill('scope', 'CODEx_TEST_发布草稿保留');
    await click('close-modal');
    await go(other.id);
    await click('m4-plan-new');
    assert.notEqual(
      await page.locator('[name="scope"]').inputValue(),
      'CODEx_TEST_发布草稿保留',
    );
    await click('close-modal');
    await go(item.id);
    await click('m4-plan-new');
    assert.equal(
      await page.locator('[name="scope"]').inputValue(),
      'CODEx_TEST_发布草稿保留',
    );
    await click('close-modal');
    await page.reload();
    await page.waitForFunction(() => window.PFCAPI?.api.ready);
    await go(item.id);
    await click('m4-plan-new');
    assert.equal(
      await page.locator('[name="scope"]').inputValue(),
      'CODEx_TEST_发布草稿保留',
    );
  });
  let plan, observation;
  await test('T02/T03 structured preparation form, evidence, review and durable readback', async () => {
    const data = planData([item.evidence], runId + '_owner');
    for (const key of [
      'target',
      'scope',
      'versionRef',
      'releaseOwner',
      'dependencies',
      'risks',
      'monitoring',
      'alertOwner',
      'hours',
    ])
      await fill(key, data[key]);
    for (const [key, v] of Object.entries(data.rollback))
      await fill('rollback_' + key, v);
    for (const key of [
      'id',
      'target',
      'scope',
      'versionRef',
      'from',
      'until',
      'actor',
    ])
      await fill('auth_' + key, data.authorization[key]);
    for (const input of await page.locator('[name="authActions"]').all())
      await input.check();
    for (const [key, v] of Object.entries(data.smoke[0]))
      await fill('smoke_0_' + key, v);
    for (const [key, v] of Object.entries(data.metrics[0]))
      await fill('metric_0_' + key, v);
    await page
      .locator('[name="evidence"][value="' + item.evidence.id + '"]')
      .check();
    await page
      .locator('[name="authEvidence"][value="' + item.evidence.id + '"]')
      .check();
    await click('m4-plan-save');
    await closed();
    plan = (await f.api('/reqs/' + item.id + '/release-plans')).items[0];
    assert.equal(plan.completeness, 'READY');
    await click('m4-plan-detail', '[data-id="' + plan.id + '"]');
    await click('m4-plan-submit');
    await closed();
    await click('m4-plan-detail', '[data-id="' + plan.id + '"]');
    await fill('comment', 'CODEx_TEST_Owner人工准备评审');
    await click('m4-plan-review', '[data-decision="APPROVED"]');
    await closed();
    assert.equal(
      (await f.api('/reqs/' + item.id + '/release-workspace')).currentRelease
        .reviewState,
      'APPROVED',
    );
  });
  await test('T07/T08 UNKNOWN result UI requires original-record reconciliation', async () => {
    await click('m4-result-new');
    const data = resultData([item.evidence]);
    await fill('startedAt', data.startedAt);
    await fill('actual', 'CODEx_TEST_待核实原尝试');
    await fill('locator', 'CODEx_TEST_job_1');
    await fill('responsible', runId + '_owner');
    await click('m4-result-save');
    await closed();
    await click('m4-results');
    await click('m4-result-new', '[data-record]');
    await page.locator('[name="status"]').selectOption('SUCCESS');
    await fill('endedAt', data.endedAt);
    await fill('actual', data.actual);
    await page.locator('[name="smoke_0"]').selectOption('PASS');
    await fill('smokeActual_0', 'CODEx_TEST_显示必填');
    await page.locator('[name="evidence"]').first().check();
    await click('m4-result-save');
    await closed();
    observation = (await f.api('/reqs/' + item.id + '/release-workspace'))
      .currentObservation;
    assert.ok(observation);
    assert.equal((await f.refresh(item.id)).stage, 'observe');
  });
  await test('T13 published workspace opens read-only upstream tests and artifacts then returns', async () => {
    await go(item.id, 'observe');
    await click('m4-tests');
    await page.getByText('测试准备与执行记录', { exact: true }).waitFor();
    assert.equal(
      await page.locator('button[data-action="r3-suite-edit"]').isDisabled(),
      true,
    );
    await click('r3-artifacts');
    await page.waitForFunction(
      () => !!window.PFC.artifactClient.states[window.PFC.r().id],
    );
    assert.equal(
      (await f.api('/reqs/' + item.id + '/artifact-workspace')).actions.canEdit,
      false,
    );
    await click('m4-observe');
    await page.getByText('观察与最终验收', { exact: true }).first().waitFor();
  });
  await test('T10/T12 observation metric, explicit final acceptance and three PC widths', async () => {
    await go(item.id, 'observe');
    await click('m4-entry-new');
    await page.locator('[name="status"]').selectOption('MET');
    await fill('sampledFrom', observation.startedAt);
    await fill('sampledTo', observation.endsAt);
    await fill('actual', 'CODEx_TEST_100%');
    await fill('sourceDescription', 'CODEx_TEST_本次观察窗口末端');
    await page.locator('[name="evidence"]').first().check();
    await click('m4-entry-save');
    await closed();
    await click('m4-final-new');
    await page.locator('[name="decision"]').selectOption('ACCEPTED');
    for (const input of await page.locator('[name="checks"]').all())
      await input.check();
    for (const [key, value] of Object.entries({
      actual: 'CODEx_TEST_目标100%，实际100%',
      conclusion: 'CODEx_TEST_完成',
      retrospective: 'CODEx_TEST_完善回归',
      risks: '无',
    }))
      await fill(key, value);
    await click('m4-final-save');
    await closed();
    assert.ok((await f.refresh(item.id)).closed);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      await page.screenshot({
        path: resolve(out, 'observe-' + width + '.png'),
      });
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(
        dimensions.scroll <= dimensions.width + 2,
        JSON.stringify(dimensions),
      );
    }
  });
  await test('T18 knowledge is prefilled and saved separately, acceptance remains closed', async () => {
    await click('m4-knowledge');
    assert.ok(
      (await page.locator('[name="k-content"]').inputValue()).includes(item.id),
    );
    const before = (await f.api('/knowledge')).total;
    await click('save-knowledge');
    await closed();
    const list = await f.api('/knowledge');
    assert.equal(list.total, before + 1);
    assert.ok((await f.refresh(item.id)).closed);
  });
  await test('T14/T17 closed observe chat keeps new attachment and frozen report references after reload', async () => {
    await click('attach-menu');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      click('attach-files'),
    ]);
    await chooser.setFiles({
      name: 'CODEx_TEST_observe.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('CODEx_TEST_本轮复盘附件'),
    });
    await page.waitForFunction(() =>
      window.PFC.uiBag().atts.some((a) => a.status === 'ready'),
    );
    await click('attach-menu');
    await click('attach-artifact-ref');
    await click('pick-ref', '[data-stage="observe"]');
    await page.locator('#chat-input').fill('CODEx_TEST_结案后追溯原复盘');
    await click('send');
    await page.waitForFunction(() =>
      window.PFC.r().messages.some(
        (m) =>
          m.stage === 'observe' && m.text === 'CODEx_TEST_结案后追溯原复盘',
      ),
    );
    const sent = (
      await f.api('/reqs/' + item.id + '/messages?limit=100')
    ).items.find((m) => m.content === 'CODEx_TEST_结案后追溯原复盘');
    assert.ok(
      sent.attachments.length && sent.refs.some((r) => r.kind === 'artifact'),
    );
    await page.reload();
    await page.waitForFunction(() => window.PFCAPI?.api.ready);
    await go(item.id, 'observe');
    assert.ok((await f.refresh(item.id)).closed);
    assert.ok(
      await page.evaluate(() =>
        window.PFC.r().messages.some(
          (m) => m.text === 'CODEx_TEST_结案后追溯原复盘',
        ),
      ),
    );
  });
  await test('T16 503 keeps input and command; same-command retry creates one draft', async () => {
    await go(other.id);
    await click('m4-plan-new');
    await fill('scope', 'CODEx_TEST_503恢复');
    const url = '**/api/reqs/' + other.id + '/release-plans',
      pending = [];
    let reject = true;
    const intercept = async (route) => {
      if (route.request().method() === 'POST') {
        pending.push(route.request().postDataJSON().commandId);
        if (reject) {
          reject = false;
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'STORAGE_UNAVAILABLE',
                message: 'CODEx_TEST_暂时不可用',
              },
            }),
          });
        }
      }
      return route.continue();
    };
    await ctx.route(url, intercept);
    await click('m4-plan-save');
    assert.equal(
      await page.locator('[name="scope"]').inputValue(),
      'CODEx_TEST_503恢复',
    );
    assert.equal(
      await page.locator('#app button[data-action="m4-retry"]').count(),
      1,
    );
    assert.ok(
      await page.evaluate(
        (id) => !!window.PFC.releaseClient.draft(id).pending,
        other.id,
      ),
    );
    await click('close-modal');
    await click('m4-retry');
    await closed();
    await ctx.unroute(url, intercept);
    assert.equal(pending.length, 2);
    assert.equal(pending[0], pending[1]);
    assert.equal(
      (await f.api('/reqs/' + other.id + '/release-plans')).total,
      1,
    );
  });
  await test('T16 conflict preserves draft until explicit current-baseline comparison', async () => {
    await click('m4-plan-new');
    await fill('scope', 'CODEx_TEST_409保留');
    await f.write(
      other.id,
      '/release-plans',
      { target: 'CODEx_TEST_另一窗口' },
      201,
    );
    await click('m4-plan-save');
    assert.equal(
      await page.locator('[name="scope"]').inputValue(),
      'CODEx_TEST_409保留',
    );
    assert.equal(
      await page.evaluate(
        (id) => !!window.PFC.releaseClient.draft(id).pending,
        other.id,
      ),
      false,
    );
    // A background sync may invalidate the workspace while this draft remains
    // open; comparing current facts must not require the invalidated cache.
    await page.evaluate((id) => {
      delete window.PFC.releaseClient.states[id];
    }, other.id);
    await click('m4-check-current');
    await click('m4-use-current');
    await closed();
    await click('m4-plan-new');
    assert.equal(
      await page.locator('[name="scope"]').inputValue(),
      'CODEx_TEST_409保留',
    );
    await click('close-modal');
  });
  await test('T17 late read after requirement switch cannot reopen or paint foreign workspace', async () => {
    const outcome = await page.evaluate(
      async ({ first, second }) => {
        const A = window.PFC.releaseClient,
          api = window.PFCAPI.api,
          original = api.req;
        let release;
        api.req = async (method, path, ...rest) => {
          const value = await original(method, path, ...rest);
          if (path === '/api/reqs/' + first + '/release-plans')
            return new Promise((resolve) => {
              release = () => resolve(value);
            });
          return value;
        };
        const pending = A.request(first, '/release-plans').then(
          () => false,
          () => true,
        );
        while (!release) await new Promise((r) => setTimeout(r, 10));
        window.PFC.go({
          route: 'work',
          req: second,
          stage: 'observe',
          panel: 'canvas',
        });
        release();
        const rejected = await pending;
        api.req = original;
        return rejected;
      },
      { first: other.id, second: item.id },
    );
    assert.equal(outcome, true);
  });
  await test('T16 committed write followed by failed readback retries original command without a second plan', async () => {
    await go(other.id);
    await click('m4-plan-new');
    await fill('scope', 'CODEx_TEST_写成读失败');
    const pattern = '**/api/reqs/' + other.id + '**',
      commands = [];
    let committed = false;
    await page.route(pattern, async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname.endsWith('/release-plans')) {
        commands.push(req.postDataJSON().commandId);
        const response = await route.fetch();
        committed = response.status() === 201;
        return route.fulfill({ response });
      }
      if (
        committed &&
        req.method() === 'GET' &&
        url.pathname.endsWith('/release-workspace')
      )
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'STORAGE_UNAVAILABLE',
              message: 'CODEx_TEST_读回失败',
            },
          }),
        });
      return route.fallback();
    });
    const count = (await f.api('/reqs/' + other.id + '/release-plans')).total;
    await click('m4-plan-save');
    assert.ok(committed);
    assert.equal(
      await page.locator('[name="scope"]').inputValue(),
      'CODEx_TEST_写成读失败',
    );
    assert.ok(
      await page.evaluate(
        (id) => !!window.PFC.releaseClient.draft(id).pending,
        other.id,
      ),
    );
    await page.unroute(pattern);
    await click('close-modal');
    await click('m4-retry');
    await closed();
    assert.equal(
      (await f.api('/reqs/' + other.id + '/release-plans')).total,
      count + 1,
    );
    assert.equal(commands.length, 1);
    assert.equal(
      await page.evaluate(
        (id) => !!window.PFC.releaseClient.draft(id).pending,
        other.id,
      ),
      false,
    );
  });
  await test('T09 browser records rollback UNKNOWN then reconciles original result and explicitly returns to repair', async () => {
    const t = await f.accepted('browser-rollback'),
      p = await f.plan(t);
    await f.approve(t, p);
    await f.write(
      t.id,
      '/releases/' + p.id + '/reported-results',
      resultData([t.evidence]),
      201,
    );
    await page.evaluate(() => window.PFC.domainView.sync());
    await go(t.id, 'release');
    await click('m4-results');
    await click('m4-result-new', '[data-kind="ROLLBACK"]');
    const start = new Date(Date.now() - 1800000).toISOString();
    await fill('startedAt', start);
    await fill('actual', 'CODEx_TEST_回退待核实');
    await fill('locator', 'CODEx_TEST_rollback1');
    await fill('responsible', runId + '_owner');
    await click('m4-result-save');
    await closed();
    await go(t.id, 'release');
    await click('m4-results');
    await click('m4-result-new', '[data-record]');
    await page.locator('[name="status"]').selectOption('SUCCESS');
    await fill('endedAt', new Date(Date.now() - 600000).toISOString());
    await page.locator('[name="evidence"]').first().check();
    await click('m4-result-save');
    await closed();
    await go(t.id, 'release');
    await click('m4-return');
    await fill('comment', 'CODEx_TEST_回退后明确修复');
    await click('m4-return-save');
    await closed();
    assert.equal((await f.refresh(t.id)).stage, 'dev');
    assert.equal(
      (await f.api('/reqs/' + t.id + '/observations')).items[0].status,
      'STOPPED',
    );
  });
  await test('T04/T17 user and server identity isolate drafts and late reads; Viewer sees read-only controls', async () => {
    await go(other.id);
    await click('m4-plan-new');
    await fill('scope', 'CODEx_TEST_owner_private');
    await click('close-modal');
    const result = await page.evaluate(
      async ({ id, name }) => {
        const P = window.PFC,
          A = P.releaseClient,
          api = window.PFCAPI.api,
          original = api.req;
        let release, ready;
        const captured = new Promise((r) => (ready = r));
        api.req = async (method, path, ...args) => {
          const value = await original(method, path, ...args);
          if (path === '/api/reqs/' + id + '/release-workspace') {
            ready();
            return new Promise((r) => (release = () => r(value)));
          }
          return value;
        };
        const late = A.load(id);
        await captured;
        api.req = original;
        P.domainView.clear();
        window.PFC_USER_NAME = name;
        await api.devLogin();
        P.domainView.reset();
        release();
        const value = await late,
          leaked = !!A.states[id];
        await P.domainView.sync();
        return { value, leaked, draft: A.draft(id).forms?.plan?.values?.scope };
      },
      { id: other.id, name: runId + '_viewer' },
    );
    assert.deepEqual(result, { value: null, leaked: false, draft: undefined });
    await go(other.id);
    assert.equal(
      await page
        .locator('button[data-action="m4-plan-new"]')
        .first()
        .isDisabled(),
      true,
    );
    const isolated = await page.evaluate(async (id) => {
      const A = window.PFC.releaseClient,
        api = window.PFCAPI.api,
        original = api.req,
        base = api.base;
      let release, ready;
      const captured = new Promise((r) => (ready = r));
      api.req = async (method, path, ...args) => {
        const value = await original(method, path, ...args);
        if (path === '/api/reqs/' + id + '/release-plans') {
          ready();
          return new Promise((r) => (release = () => r(value)));
        }
        return value;
      };
      const pending = A.request(id, '/release-plans').then(
        () => false,
        () => true,
      );
      await captured;
      api.req = original;
      api.base = () => base() + '/CODEx_TEST_other_server';
      const draft = A.draft(id);
      release();
      const rejected = await pending;
      api.base = base;
      return { rejected, draft };
    }, other.id);
    assert.deepEqual(isolated, { rejected: true, draft: {} });
  });
  await test('D2/D3 current Owner visibly re-reviews frozen acceptance and reconciles disabled author original attempt', async () => {
    // End the preceding identity/failure-injection session before disabling its
    // member. The new Owner's evidence must come from a clean real session.
    await ctx.close();
    const r = await f.recovery('browser-historical', true);
    try {
      const recoveryContext = await browser.newContext({
        viewport: { width: 1440, height: 960 },
      });
      await recoveryContext.route(/^https?:\/\//, (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') {
          report.external.push('NON_LOOPBACK');
          return route.abort();
        }
        return route.continue();
      });
      await recoveryContext.addInitScript(
        ({ base, name }) => {
          window.PFC_DATA_MODE = 'api';
          window.PFC_API_BASE = base;
          window.PFC_USER_NAME = name;
        },
        { base: f.baseUrl, name: runId + '_owner2' },
      );
      page = await recoveryContext.newPage();
      page.setDefaultTimeout(12000);
      report.recoveryUi = {
        console: [],
        httpErrors: [],
        keyboardReview: false,
      };
      page.on('pageerror', (error) => report.errors.push(error.message));
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type()))
          report.recoveryUi.console.push({
            type: message.type(),
            text: message.text(),
          });
      });
      page.on('response', (response) => {
        if (response.status() >= 400)
          report.recoveryUi.httpErrors.push({
            status: response.status(),
            path: new URL(response.url()).pathname,
          });
      });
      const url = pathToFileURL(
        resolve('output/pfc-workbench-prototype/index.html'),
      ).href;
      await page.goto(url);
      await page.waitForFunction(
        () => window.PFCAPI?.api.ready || window.PFC?.remoteError,
      );
      assert.equal(await page.evaluate(() => window.PFC.remoteError), null);
      assert.equal(page.url(), url);
      report.recoveryUi.title = await page.title();
      assert.equal(report.recoveryUi.title, 'PFC · 我的工作台');
      await go(r.item.id);
      await click('m4-plan-detail', '[data-id="' + r.plan.id + '"]');
      assert.ok(
        (await page.locator('#modal-root').innerText()).includes(
          '沿用冻结验收 ' + r.plan.snapshot.acceptanceId,
        ),
      );
      assert.ok(
        (await page.locator('#modal-root').innerText()).includes('已停用'),
      );
      await fill('comment', 'CODEx_TEST_现任Owner核对原冻结验收及未变计划');
      await page.screenshot({ path: resolve(out, 'recovery-review-1440.png') });
      await idle();
      await page
        .locator(
          '#modal-root button[data-action="m4-plan-review"][data-decision="APPROVED"]',
        )
        .focus();
      await page.keyboard.press('Enter');
      await idle();
      await closed();
      report.recoveryUi.keyboardReview = true;
      const reviews = await r.read(
        '/reqs/' + r.item.id + '/releases/' + r.plan.id + '/reviews',
      );
      assert.equal(reviews.total, 2);
      assert.match(reviews.items[0].comment, /沿用冻结验收/);
      await click('m4-results', '[data-id="' + r.plan.id + '"]');
      await click('m4-result-new', '[data-record="' + r.unknown.id + '"]');
      await page.locator('#modal-root [name="status"]').selectOption('SUCCESS');
      await fill('endedAt', r.original.endedAt);
      await fill('checkedAt', new Date().toISOString());
      await fill('actual', 'CODEx_TEST_仅核实原尝试实际结果');
      await page
        .locator(
          '#modal-root [name="evidence"][value="' + r.item.evidence.id + '"]',
        )
        .check();
      await click('m4-result-save');
      await closed();
      await go(r.item.id, 'observe');
      assert.ok((await page.locator('#app').innerText()).includes('观察'));
      const events = await r.read(
        '/reqs/' + r.item.id + '/releases/' + r.plan.id + '/reported-results',
      );
      assert.equal(events.items[0].previousRecordId, r.unknown.id);
      assert.equal(
        events.items[0].reconciliation.acceptanceId,
        r.plan.snapshot.acceptanceId,
      );
      assert.equal(
        (await r.read('/reqs/' + r.item.id + '/observations')).total,
        1,
      );
      await go(r.item.id, 'release');
      await click('m4-results', '[data-id="' + r.plan.id + '"]');
      assert.ok(
        (await page.locator('#modal-root').innerText()).includes(
          '重评依据 ' + reviews.items[0].id,
        ),
      );
      await page.screenshot({ path: resolve(out, 'recovery-result-1440.png') });
      await click('close-modal');
      assert.deepEqual(report.recoveryUi.console, []);
      assert.deepEqual(report.recoveryUi.httpErrors, []);
    } finally {
      await r.restore();
    }
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.external, []);
  report.status = 'PASS';
} catch (e) {
  report.error = { message: e.message, stack: e.stack };
  console.error(e);
  if (page)
    await page
      .screenshot({ path: resolve(out, 'browser-failure.png') })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  report.browserClosed = true;
  if (f)
    try {
      const c = await f.cleanup();
      report.cleanup = { ...c, readback: undefined };
    } catch (e) {
      report.status = 'FAIL';
      report.cleanupError = e.message;
      process.exitCode = 1;
    }
  writeFileSync(
    resolve(out, 'browser-' + report.at.replace(/[:.]/g, '-') + '.json'),
    JSON.stringify(report, null, 2),
  );
}
