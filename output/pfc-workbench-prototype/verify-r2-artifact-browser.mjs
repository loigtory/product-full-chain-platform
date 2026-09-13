import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  fixture,
  toRequirement,
  runId,
} from '../../server/test-data/r2-artifact-fixture.mjs';
const out = resolve(
  'docs/quality-gate/reports/r2-artifacts-20260913/artifacts',
);
mkdirSync(out, { recursive: true });
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  results: [],
  errors: [],
  external: [],
};
let f, browser, page;
const test = async (name, fn) => {
  let timeout;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(Error('R2_BROWSER_SCENARIO_TIMEOUT: ' + name)),
          45000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  report.results.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  f = await fixture();
  const req = await toRequirement(f, 'browser');
  const otherReq = await toRequirement(f, 'browser_other');
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
      report.external.push(route.request().url().replace(/\?.*/, ''));
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
  await page.evaluate(
    (id) =>
      window.PFC.go({ route: 'work', req: id, stage: 'req', panel: 'canvas' }),
    req.id,
  );
  const click = async (action, filter = '', wait = true) => {
    await page.waitForFunction(() => !window.PFC.pendingActions?.size);
    const selector = 'button[data-action="' + action + '"]' + filter,
      modal = page.locator('#modal-root ' + selector);
    const button = (
      (await modal.count()) ? modal : page.locator(selector)
    ).first();
    await button.click({ trial: true });
    // Let the browser present the scrolled iframe and parent hit-test regions.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await button.click();
    if (wait)
      await page.waitForFunction(() => !window.PFC.pendingActions?.size);
  };
  const closed = () =>
    page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await test('A01/A10 template preview before adoption and required validation', async () => {
    await click('r2-template');
    await page.locator('[name="title"]').fill('CODEx_TEST_表单');
    await click('r2-save-template');
    await closed();
    await click('r2-proposal');
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      await page.screenshot({
        path: resolve(out, 'candidate-compare-' + width + '.png'),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page
      .locator('#modal-root button[data-action="r2-preview-candidate"]')
      .focus();
    assert.equal(
      await page
        .locator('#modal-root button[data-action="r2-preview-candidate"]')
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await click('r2-preview-candidate');
    const preview = page.frameLocator('#r2-candidate-preview iframe');
    await preview.getByRole('button', { name: '检查填写内容' }).click();
    assert.match(await preview.locator('[role="status"]').innerText(), /必填/);
    await preview.getByLabel('名称').fill('CODEx_TEST_有效名称');
    await preview.getByRole('button', { name: '检查填写内容' }).click();
    assert.match(
      await preview.locator('[role="status"]').innerText(),
      /填写完整/,
    );
    assert.equal(
      (await f.api('/reqs/' + req.id + '/artifact-workspace')).currentGroup,
      null,
    );
    await click('r2-proposal');
    await click('r2-adopt');
    await closed();
    assert.ok(
      (await f.api('/reqs/' + req.id + '/artifact-workspace')).currentGroup,
    );
  });
  await test('A10 desktop three widths preserve columns and render preview', async () => {
    const canvas = page.frameLocator('#app iframe');
    await canvas.getByLabel('名称').fill('CODEx_TEST_预览输入保留');
    await page.evaluate(() => window.PFC.render());
    assert.equal(
      await page.frameLocator('#app iframe').getByLabel('名称').inputValue(),
      'CODEx_TEST_预览输入保留',
    );
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      await page.screenshot({
        path: resolve(out, 'workbench-' + width + '.png'),
        fullPage: true,
      });
      assert.ok(await page.locator('.side-panel').isVisible());
      assert.equal(await page.locator('#app iframe').count(), 1);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
  });
  await test('A12 background readback during a pointer gesture preserves intended comparison', async () => {
    await page
      .locator('button[data-action="r2-proposal"]')
      .first()
      .scrollIntoViewIfNeeded();
    await page.evaluate(() =>
      document.addEventListener(
        'pointerdown',
        () => window.PFC.render({ quiet: true }),
        { once: true },
      ),
    );
    await page.locator('button[data-action="r2-proposal"]').first().click();
    await page
      .locator('#modal-root button[data-action="r2-preview-candidate"]')
      .waitFor();
    await click('close-modal');
  });
  await test('A06 UI business and design confirmation advance atomically', async () => {
    await click('r2-confirm-business');
    await page.locator('[name="comment"]').fill('CODEx_TEST_业务确认');
    await click('r2-save-confirm');
    await closed();
    assert.equal((await f.api('/reqs/' + req.id)).req.stage, 'design');
    await click('r2-confirm-design');
    for (const name of [
      'comment',
      'goal',
      'files',
      'validation',
      'exit',
      'rollback',
    ])
      await page.locator('[name="' + name + '"]').fill('CODEx_TEST_' + name);
    await click('r2-save-confirm');
    await closed();
    assert.equal((await f.api('/reqs/' + req.id)).req.stage, 'dev');
  });
  await test('A12 503 and committed write followed by failed read preserve receipt', async () => {
    await click('r2-edit');
    const ac = JSON.parse(
      await page.locator('[name="acceptance"]').inputValue(),
    );
    ac.items[0].expected = 'CODEx_TEST_恢复后保留';
    await page.locator('[name="acceptance"]').fill(JSON.stringify(ac));
    let blocked = true;
    await page.route('**/artifact-proposals', (route) =>
      route.request().method() === 'POST' && blocked
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'UNAVAILABLE', msg: 'CODEx_TEST_服务暂不可用' },
            }),
          })
        : route.continue(),
    );
    await click('r2-save');
    await page.waitForFunction(() =>
      document
        .getElementById('form-error')
        ?.textContent.includes('CODEx_TEST_'),
    );
    const command = await page.evaluate(
      (id) => window.PFC.artifactClient.draft(id).pending.commandId,
      req.id,
    );
    blocked = false;
    await page.route('**/artifact-workspace', (route) => {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UNAVAILABLE', msg: 'CODEx_TEST_读取失败' },
        }),
      });
    });
    await click('r2-save');
    await page.waitForFunction(() =>
      document.getElementById('form-error')?.textContent.includes('读取失败'),
    );
    assert.equal(
      await page.evaluate(
        (id) => window.PFC.artifactClient.draft(id).pending.commandId,
        req.id,
      ),
      command,
    );
    await click('close-modal');
    await page.unroute('**/artifact-workspace');
    await click('r2-refresh');
    await click('r2-retry');
    await page.waitForFunction(
      (id) => !window.PFC.artifactClient.draft(id).pending,
      req.id,
    );
    assert.equal(
      (await f.api('/reqs/' + req.id + '/artifact-proposals')).items.length,
      2,
    );
  });
  await test('A11 sandbox destroys iframe and forged messages do not mutate parent', async () => {
    assert.equal(
      await page
        .frameLocator('#app iframe')
        .locator('body')
        .evaluate(() => {
          try {
            void window.parent.document.body;
            return false;
          } catch (e) {
            return e.name === 'SecurityError';
          }
        }),
      true,
    );
    await page.evaluate(() =>
      window.postMessage(
        { type: 'prototype-action', action: 'adopt', data: 'CODEx_TEST_' },
        '*',
      ),
    );
    await click('panel', '[data-panel="terminal"]');
    assert.equal(await page.locator('#app iframe').count(), 0);
    await click('panel', '[data-panel="canvas"]');
    assert.equal(
      await page.locator('#app iframe').getAttribute('sandbox'),
      'allow-scripts',
    );
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
    assert.deepEqual(report.external, []);
  });
  await test('A11 HTML original import is escaped, bytes downloadable, never executed', async () => {
    const bytes = Buffer.from(
      '<script>parent.__unsafe=true;fetch("https://invalid.example")</script>CODEx_TEST_HTML',
    );
    await click('r2-import');
    await page.locator('#r2-file').setInputFiles({
      name: 'CODEx_TEST_original.html',
      mimeType: 'text/html',
      buffer: bytes,
    });
    await click('r2-save-import');
    await closed();
    await click('r2-proposal');
    await click('r2-preview-candidate');
    assert.match(await page.locator('#modal-root pre').innerText(), /<script>/);
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
    const download = page.waitForEvent('download');
    await click('r2-download');
    const file = await download;
    const { readFileSync } = await import('node:fs');
    assert.deepEqual(readFileSync(await file.path()), bytes);
    await click('close-modal');
    assert.deepEqual(report.external, []);
  });
  await test('A10 JSON candidate supports page navigation, dialog, state and rule location', async () => {
    const spec = {
      schemaVersion: 1,
      title: 'CODEx_TEST_交互',
      pages: [
        {
          id: 'first',
          title: 'CODEx_TEST_第一页',
          nodes: [
            {
              id: 'next',
              type: 'button',
              text: '去第二页',
              action: { type: 'page', target: 'second' },
            },
          ],
        },
        {
          id: 'second',
          title: 'CODEx_TEST_第二页',
          nodes: [
            { id: 'summary', type: 'text', text: '待确认', ruleId: 'RULE1' },
            {
              id: 'detail',
              type: 'dialog',
              text: 'CODEx_TEST_确认说明',
              open: false,
            },
            {
              id: 'toggle',
              type: 'button',
              text: '展开说明',
              action: { type: 'toggle', target: 'detail' },
            },
            {
              id: 'confirm',
              type: 'button',
              text: '体验确认',
              action: {
                type: 'state',
                target: 'summary',
                value: 'CODEx_TEST_已确认',
              },
            },
          ],
        },
      ],
    };
    await click('r2-import');
    await page.locator('#r2-file').setInputFiles({
      name: 'CODEx_TEST_interactions.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(spec)),
    });
    await click('r2-save-import');
    await closed();
    await click('r2-proposal');
    await click('r2-preview-candidate');
    const preview = page.frameLocator('#r2-candidate-preview iframe');
    await preview.getByRole('button', { name: '去第二页' }).click();
    assert.equal(
      await preview
        .getByRole('heading', { name: 'CODEx_TEST_第二页' })
        .isVisible(),
      true,
    );
    await preview.getByRole('button', { name: '展开说明' }).click();
    assert.equal(
      await preview
        .getByText('CODEx_TEST_确认说明', { exact: true })
        .isVisible(),
      true,
    );
    await preview.getByRole('button', { name: '体验确认' }).click();
    assert.equal(
      await preview.getByText('CODEx_TEST_已确认', { exact: true }).isVisible(),
      true,
    );
    await click('close-modal');
    await click('r2-tab', '[data-tab="acceptance"]');
    await click('r2-rule');
    assert.equal(await page.locator('#r2-rule-0').isVisible(), true);
    await click('r2-tab', '[data-tab="prototype"]');
  });
  await test('A12 revision conflict keeps editable draft across close, reload and explicit rebase', async () => {
    await click('r2-edit');
    const ac = JSON.parse(
      await page.locator('[name="acceptance"]').inputValue(),
    );
    ac.items[0].expected = 'CODEx_TEST_冲突草稿保留';
    await page.locator('[name="acceptance"]').fill(JSON.stringify(ac));
    const current = (await f.api('/reqs/' + req.id)).req;
    await f.api(
      '/reqs/' + req.id + '/questions/' + current.questions[0].id + '/answer',
      'POST',
      {
        ...f.command(),
        expectedRevision: current.revision,
        answer: 'CODEx_TEST_并发更新问题',
      },
    );
    await click('r2-save');
    assert.match(
      await page.locator('#form-error').innerText(),
      /服务端已有更新.*保留.*草稿/,
    );
    assert.equal(
      await page.evaluate(
        (id) => !!window.PFC.artifactClient.draft(id).pending,
        req.id,
      ),
      false,
    );
    await click('close-modal');
    await page.reload();
    await page.waitForFunction(
      () =>
        window.PFCAPI?.api.ready &&
        window.PFC.artifactClient?.states[window.PFC.s.ui.req],
    );
    await click('r2-edit');
    assert.equal(
      JSON.parse(await page.locator('[name="acceptance"]').inputValue())
        .items[0].expected,
      ac.items[0].expected,
    );
    await click('r2-rebase');
    await click('r2-use-latest');
    assert.equal(
      JSON.parse(await page.locator('[name="acceptance"]').inputValue())
        .items[0].expected,
      ac.items[0].expected,
    );
    await click('r2-save');
    await closed();
    const p = (await f.api('/reqs/' + req.id + '/artifact-proposals')).items[0];
    const detail = (
      await f.api('/reqs/' + req.id + '/artifact-proposals/' + p.id)
    ).proposal;
    assert.equal(
      detail.content.acceptance.items[0].expected,
      ac.items[0].expected,
    );
  });
  await test('A12 late comparison response cannot open an artifact from another requirement', async () => {
    const item = (await f.api('/reqs/' + req.id + '/artifact-proposals'))
      .items[0];
    let release, arrived;
    const pending = new Promise((resolve) => {
        release = resolve;
      }),
      seen = new Promise((resolve) => {
        arrived = resolve;
      });
    const pattern = '**/artifact-proposals/' + item.id;
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      arrived();
      await pending;
      await route.fulfill({ response });
    });
    let arrivalTimeout;
    try {
      await click('r2-proposal', '[data-id="' + item.id + '"]', false);
      await Promise.race([
        seen,
        new Promise((_, reject) => {
          arrivalTimeout = setTimeout(
            () => reject(Error('LATE_RESPONSE_REQUEST_NOT_STARTED')),
            12000,
          );
        }),
      ]);
      await page.evaluate(
        (id) => window.PFC.go({ req: id, stage: 'req', panel: 'canvas' }),
        otherReq.id,
      );
    } finally {
      clearTimeout(arrivalTimeout);
      release();
    }
    await page.waitForFunction(() => !window.PFC.pendingActions?.size);
    assert.equal(await page.locator('#modal-root [role="dialog"]').count(), 0);
    assert.equal(await page.evaluate(() => window.PFC.r().id), otherReq.id);
    assert.equal(
      await page.evaluate(
        (id) => window.PFC.artifactClient.draft(id).forms?.editor,
        otherReq.id,
      ),
      undefined,
    );
    await page.unroute(pattern);
  });
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (e) {
  report.error = { code: e.code, message: e.message };
  console.error(e.stack);
  if (page)
    await page
      .screenshot({
        path: resolve(out, 'browser-failure-' + Date.now() + '.png'),
        fullPage: true,
      })
      .catch(() => {});
} finally {
  await browser?.close();
  if (f)
    try {
      report.cleanup = await f.cleanup();
    } catch (e) {
      report.status = 'FAIL';
      report.cleanupError = e.message;
    }
  writeFileSync(
    resolve(out, 'browser-' + Date.now() + '.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    status: report.status,
    tests: report.results.length,
    error: report.error,
  }),
);
if (report.status !== 'PASS') process.exitCode = 1;
