import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  fixture,
  runId,
} from '../../server/test-data/r3-verification-fixture.mjs';
const out = resolve(
  'docs/quality-gate/reports/r3-test-acceptance-20260913/testing',
);
mkdirSync(out, { recursive: true });
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  browser: 'Browser plugin not available; existing Playwright Edge',
  flow: '现有工作台→测试准备→提测→人工结果→产品验收→发布输入',
  results: [],
  errors: [],
  external: [],
};
let f, browser, page;
async function test(name, work) {
  let timer;
  try {
    await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error('R3_BROWSER_TIMEOUT ' + name)),
          45000,
        );
      }),
    ]);
    report.results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } finally {
    clearTimeout(timer);
  }
}
try {
  f = await fixture();
  const item = await f.prepare('browser', { handoff: false }),
    other = await f.prepare('browser_other', { handoff: false });
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
  const go = async (id, stage) => {
    await page.evaluate(
      ({ id, stage }) =>
        window.PFC.go({ route: 'work', req: id, stage, panel: 'canvas' }),
      { id, stage },
    );
    await page.waitForFunction(
      (id) => !!window.PFC.verificationClient.states[id],
      id,
    );
  };
  const idle = () =>
    page.waitForFunction(() => !window.PFC.pendingActions?.size);
  const click = async (action, suffix = '') => {
    await idle();
    const sel = 'button[data-action="' + action + '"]' + suffix,
      modal = page.locator('#modal-root ' + sel),
      button = ((await modal.count()) ? modal : page.locator(sel)).first();
    await button.click();
    await idle();
  };
  const fill = (name, value) =>
    page.locator('#modal-root [name="' + name + '"]').fill(value);
  const closed = () =>
    page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await go(item.id, 'dev');
  await test('T01 T13 early suite editor, draft refresh and request isolation', async () => {
    await click('r3-tests');
    await click('r3-suite-edit');
    await fill('title', 'CODEx_TEST_草稿保留');
    await click('close-modal');
    await go(other.id, 'dev');
    await click('r3-tests');
    await click('r3-suite-edit');
    assert.notEqual(
      await page.locator('[name="title"]').inputValue(),
      'CODEx_TEST_草稿保留',
    );
    await click('close-modal');
    await go(item.id, 'dev');
    await click('r3-suite-edit');
    assert.equal(
      await page.locator('[name="title"]').inputValue(),
      'CODEx_TEST_草稿保留',
    );
    await page.reload();
    await page.waitForFunction(() => window.PFCAPI?.api.ready);
    await go(item.id, 'dev');
    await click('r3-tests');
    await click('r3-suite-edit');
    assert.equal(
      await page.locator('[name="title"]').inputValue(),
      'CODEx_TEST_草稿保留',
    );
    await click('close-modal');
  });

  await test('T01 T02 suite per-case edit/import/export, explicit comparison and adoption', async () => {
    await click('r3-suite-edit');
    await click('r3-case-edit');
    await fill('dataPolicy', 'CODEx_TEST_空值与正常值');
    await click('r3-case-save');
    const cases = JSON.parse(await page.locator('[name="cases"]').inputValue());
    assert.equal(cases[0].dataPolicy, 'CODEx_TEST_空值与正常值');
    await click('r3-suite-import');
    await page.locator('[name="file"]').setInputFiles({
      name: 'CODEx_TEST_cases.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(cases)),
    });
    await click('r3-suite-import-save');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      click('r3-suite-export'),
    ]);
    const stream = await download.createReadStream(),
      chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks)), cases);
    await click('r3-suite-compare');
    await click('r3-suite-rebase');
    await click('r3-suite-save');
    await click('r3-suite-adopt');
    await closed();
    const state = (await f.refresh(item.id)).verification;
    assert.notEqual(state.currentSuite.id, item.suite.id);
    assert.equal(
      state.currentSuite.cases[0].dataPolicy,
      'CODEx_TEST_空值与正常值',
    );
  });
  await test('T03 T17 handoff form error focus and keyboard at three PC widths', async () => {
    await click('r3-handoff');
    await click('r3-handoff-save');
    assert.ok(await page.locator('#form-error').textContent());
    await page.waitForFunction(
      () => document.activeElement?.id === 'form-error',
    );
    for (const [name, value] of Object.entries({
      versionRef: 'CODEx_TEST_build_browser',
      changes: 'CODEx_TEST_实现必填校验',
      implementation: 'CODEx_TEST_本地实现',
      rollback: 'CODEx_TEST_恢复前一版',
      unimplemented: '无',
    }))
      await fill(name, value);
    await page
      .locator('[name="evidence"][value="' + item.evidence.id + '"]')
      .check();
    await page.waitForFunction(
      () => !document.querySelector('#toast-root .toast'),
    );
    await page.waitForFunction(
      () => !document.querySelector('#toast-root .toast'),
    );
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      await page.screenshot({
        path: resolve(out, 'handoff-' + width + '.png'),
        fullPage: true,
      });
      assert.ok(await page.locator('[role="dialog"]').isVisible());
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await f.saveDev(item.id, 'CODEx_TEST_并发补充交付说明');
    await click('r3-handoff-save');
    assert.match(
      await page.locator('#form-error').textContent(),
      /更新|版本|基线/,
    );
    await click('r3-check-current');
    await click('r3-use-current');
    assert.equal(
      await page.locator('[name="changes"]').inputValue(),
      'CODEx_TEST_实现必填校验',
    );
    await click('r3-handoff-save');
    await closed();
    await page.waitForFunction(() => window.PFC.r().stage === 'test');
    assert.equal((await f.refresh(item.id)).stage, 'test');
  });
  let batch;
  await test('T04 T08 manual result fields and unmet checks stay blocked', async () => {
    await click('r3-batch-new');
    await fill('environment', 'CODEx_TEST_Edge本地环境');
    await click('r3-batch-create');
    batch = (await f.api('/reqs/' + item.id + '/test-batches')).items[0];
    await click('r3-batch-complete');
    assert.match(await page.locator('#form-error').textContent(), /必测|结果/);
    await click('r3-result-open');
    await page.locator('[name="status"]').selectOption('PASS');
    await fill('actual', 'CODEx_TEST_名称为空时阻止保存并显示必填');
    await fill('executedAt', '2026-09-12T18:30');
    await page
      .locator('[name="evidence"][value="' + item.evidence.id + '"]')
      .check();
    await click('r3-result-save');
    assert.equal(
      (await f.api('/reqs/' + item.id + '/test-batches/' + batch.id)).latest[0]
        .status,
      'PASS',
    );
    await click('r3-batch-complete');
    await closed();
    await page.waitForFunction(() => window.PFC.r().stage === 'accept');
  });
  await test('T09 T13 Owner acceptance, 503 retains original input and command', async () => {
    await click('r3-accept-open');
    await click('r3-accept-save');
    assert.ok(await page.locator('#form-error').textContent());
    for (const key of ['functionality', 'exceptions', 'evidence'])
      await page.locator('[name="checks"][value="' + key + '"]').check();
    await fill('comment', 'CODEx_TEST_本轮三项均已核对');
    await fill('risks', '无');
    let injected = false;
    const pattern = '**/api/reqs/' + item.id + '/product-acceptances';
    await page.route(pattern, async (route) => {
      if (route.request().method() === 'POST' && !injected) {
        injected = true;
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'UNAVAILABLE', msg: 'CODEx_TEST_临时不可用' },
          }),
        });
      }
      return route.fallback();
    });
    await click('r3-accept-save');
    assert.equal(
      await page.locator('[name="comment"]').inputValue(),
      'CODEx_TEST_本轮三项均已核对',
    );
    const pending = await page.evaluate(
      (id) => window.PFC.verificationClient.draft(id).pending,
      item.id,
    );
    assert.ok(pending.commandId);
    await click('close-modal');
    await click('r3-retry');
    await page.unroute(pattern);
    assert.equal((await f.refresh(item.id)).stage, 'release');
    await go(item.id, 'release');
    await click('r3-release-inputs');
    assert.match(
      await page.locator('[role="dialog"]').innerText(),
      /输入已就绪/,
    );
    await click('close-modal');
  });
  await test('T12 T17 release chat attachment/report refs, keyboard and visual continuity', async () => {
    await page.waitForFunction(
      () => !document.querySelector('#toast-root .toast'),
    );
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      await page.screenshot({
        path: resolve(out, 'acceptance-' + width + '.png'),
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflow, false);
    }
    await page.setViewportSize({ width: 1440, height: 960 });

    await click('attach-menu');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      click('attach-files'),
    ]);
    await chooser.setFiles({
      name: 'CODEx_TEST_release.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('CODEx_TEST_release attachment'),
    });
    await page.waitForFunction(() =>
      window.PFC.uiBag().atts.some((a) => a.status === 'ready'),
    );
    await click('attach-menu');
    await click('attach-artifact-ref');
    await click('pick-ref', '[data-stage="test"]');
    await page.locator('#chat-input').fill('CODEx_TEST_核对验收后发布输入');
    await click('send');
    await page.waitForFunction(() =>
      window.PFC.r().messages.some(
        (m) =>
          m.stage === 'release' &&
          m.text.includes('CODEx_TEST_核对验收后发布输入'),
      ),
    );

    const sent = (
      await f.api('/reqs/' + item.id + '/messages?limit=100')
    ).items.find((m) => m.content === 'CODEx_TEST_核对验收后发布输入');
    assert.ok(sent.refs.some((r) => r.kind === 'artifact'));
    assert.ok(sent.attachments.length);
    await click('r3-release-inputs');
    await page.keyboard.press('Tab');
    assert.ok(
      await page.evaluate(
        () => !!document.activeElement.closest('[role="dialog"]'),
      ),
    );
    await page.keyboard.press('Escape');
    await closed();
    assert.equal(
      (await f.api('/reqs/' + item.id + '/release-inputs')).inputsReady,
      true,
    );
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.external, []);
  });

  await test('T13 committed POST with failed GET retains command and retries exactly once', async () => {
    await other.handoff();
    await page.evaluate(
      (id) => window.PFC.verificationClient.load(id),
      other.id,
    );
    await go(other.id, 'test');
    await click('r3-batch-new');
    await fill('environment', 'CODEx_TEST_readback_retry');
    let committed = false;
    const pattern = '**/api/reqs/' + other.id + '**';
    await page.route(pattern, async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        request.method() === 'POST' &&
        url.pathname.endsWith('/test-batches')
      ) {
        const response = await route.fetch();
        committed = response.status() === 201;
        return route.fulfill({ response });
      }
      if (
        committed &&
        request.method() === 'GET' &&
        url.pathname === '/api/reqs/' + other.id
      )
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'UNAVAILABLE', msg: 'CODEx_TEST_读回暂不可用' },
          }),
        });
      return route.fallback();
    });
    await click('r3-batch-create');
    const pending = await page.evaluate(
      (id) => window.PFC.verificationClient.draft(id).pending,
      other.id,
    );
    assert.ok(committed && pending.commandId);
    assert.equal(
      await page.locator('[name="environment"]').inputValue(),
      'CODEx_TEST_readback_retry',
    );
    assert.equal((await f.api('/reqs/' + other.id + '/test-batches')).total, 1);
    await page.unroute(pattern);
    await click('close-modal');
    await click('r3-retry');
    assert.equal((await f.api('/reqs/' + other.id + '/test-batches')).total, 1);
    assert.equal(
      await page.evaluate(
        (id) => window.PFC.verificationClient.draft(id).pending,
        other.id,
      ),
      undefined,
    );
  });

  await test('T07 failed result carries case, actual value and evidence into defect draft', async () => {
    await click('r3-tests');
    await click('r3-batch');
    await click('r3-result-open');
    await page.locator('[name="status"]').selectOption('FAIL');
    await fill('actual', 'CODEx_TEST_空名称仍然保存');
    await fill('executedAt', '2026-09-12T18:30');
    await page
      .locator('[name="evidence"][value="' + other.evidence.id + '"]')
      .check();
    await click('r3-result-save');
    await click('r3-defect-open');
    assert.match(
      await page.locator('[name="description"]').inputValue(),
      /空名称仍然保存/,
    );
    assert.match(await page.locator('[role="dialog"]').innerText(), /验收项/);
    await click('r3-defect-create');
    await closed();
    const defects = await f.api('/reqs/' + other.id + '/defects');
    assert.equal(defects.total, 1);
    await click('r3-defect');
    assert.match(
      await page.locator('[role="dialog"]').innerText(),
      /空名称仍然保存/,
    );
    await click('close-modal');
  });
  await test('T13 user switch rejects late old response and isolates drafts; Viewer controls disabled', async () => {
    await click('r3-tests');
    await click('r3-suite-edit');
    await fill('title', 'CODEx_TEST_owner_only');
    await click('close-modal');
    await page.evaluate(
      async ({ id, name }) => {
        const P = window.PFC,
          api = window.PFCAPI.api,
          original = api.req;
        let release, captured;
        const ready = new Promise((resolve) => (captured = resolve));
        api.req = async (method, path, ...args) => {
          const value = await original(method, path, ...args);
          if (method === 'GET' && path === '/api/reqs/' + id) {
            captured();
            return new Promise((resolve) => (release = () => resolve(value)));
          }
          return value;
        };
        const old = P.verificationClient.load(id);
        await ready;
        api.req = original;
        P.domainView.clear();
        window.PFC_USER_NAME = name;
        await api.devLogin();
        P.domainView.reset();
        release();
        window.CODEx_TEST_late = await old;
        window.CODEx_TEST_leak = !!P.verificationClient.states[id];
        await P.domainView.sync();
      },
      { id: other.id, name: runId + '_viewer' },
    );
    assert.equal(await page.evaluate(() => window.CODEx_TEST_late), null);
    assert.equal(await page.evaluate(() => window.CODEx_TEST_leak), false);
    assert.equal(
      await page.evaluate(
        (id) =>
          window.PFC.verificationClient.draft(id).forms?.editor?.values?.title,
        other.id,
      ),
      undefined,
    );
    await go(other.id, 'test');
    await click('r3-tests');
    assert.equal(
      await page.evaluate(
        (id) => window.PFC.verificationClient.states[id].actions.canWrite,
        other.id,
      ),
      false,
    );
    const buttons = page.locator('button[data-action="r3-batch-new"]');
    assert.ok(await buttons.count());
    assert.ok(await buttons.first().isDisabled());
  });
  report.status = 'PASS';
} catch (e) {
  report.error = { code: e.code, message: e.message };
  console.error(report.error);
  process.exitCode = 1;
  if (page)
    await page
      .screenshot({ path: resolve(out, 'browser-failure.png'), fullPage: true })
      .catch(() => {});
} finally {
  if (browser) await browser.close();
  if (f)
    try {
      report.cleanup = await f.cleanup();
    } catch (e) {
      report.cleanupError = e.message;
      report.status = 'FAIL';
      process.exitCode = 1;
    }
  writeFileSync(
    resolve(out, 'browser.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
