import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import {
  fixture,
  runId,
  schema,
  context,
} from '../../server/test-data/m2c-governance-fixture.mjs';
const evidence = resolve(
  'docs/quality-gate/reports/m2c-4-release-observation-20260913/governance',
);
mkdirSync(evidence, { recursive: true });
const results = [],
  errors = [],
  requests = [];
let f, browser, cleanup, page;
const test = async (name, fn) => {
  await fn();
  results.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  f = await fixture();
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    timeout: 30000,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  await ctx.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort(),
  );
  await ctx.addInitScript(
    ({ base, name }) => {
      window.PFC_DATA_MODE = 'api';
      window.PFC_API_BASE = base;
      window.PFC_USER_NAME = name;
    },
    { base: f.baseUrl, name: runId + '_owner' },
  );
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().startsWith(f.baseUrl))
      requests.push({ method: r.method(), path: new URL(r.url()).pathname });
  });
  const click = async (action, filter = '') =>
    page
      .locator('button[data-action="' + action + '"]' + filter)
      .first()
      .click();
  const fill = async (values) => {
    for (const [key, value] of Object.entries(values))
      await page.locator('#modal-root [name="' + key + '"]').fill(value);
  };
  const closed = () =>
    page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const tab = async (name) => {
    await click('gov-tab', '[data-tab="' + name + '"]');
    await page.waitForFunction(() => !window.PFC.governanceDomain.loading);
  };
  await page.goto(
    pathToFileURL(resolve('output/pfc-workbench-prototype/index.html')).href,
  );
  await page.waitForFunction(
    () => window.PFCAPI?.api.ready || window.PFC?.remoteError,
  );
  assert.equal(await page.evaluate(() => window.PFC.remoteError), null);
  await test('G12 empty governance and current identity use real PG facts', async () => {
    await click('navigate', '[data-route="gov"]');
    assert.equal(await page.locator('.data-table tbody tr').count(), 1);
    assert.match(await page.locator('#app').innerText(), /暂无记录/);
    await tab('team');
    assert.match(
      await page.locator('#app').innerText(),
      new RegExp(runId + '_owner'),
    );
    assert.doesNotMatch(
      await page.locator('#app').innerText(),
      /企业 SSO 已登录|陈立（负责人）/,
    );
  });
  let capId;
  await test('G05 G06 UI registers reviews enables and binds a capability', async () => {
    await tab('catalog');
    await click('register-cap');
    await fill({
      name: runId + '_browser_cap',
      endpoint: 'synthetic://tool',
      src: '合成测试',
      ver: '1',
      desc: '仅登记的测试能力',
    });
    await click('save-cap');
    await closed();
    capId = (await f.api('/caps')).items[0].id;
    assert.match(await page.locator('#app').innerText(), /待复核/);
    await click('review-cap', '[data-id="' + capId + '"]');
    await page.waitForFunction(
      (id) => window.PFC.s.caps.find((c) => c.id === id)?.pending === false,
      capId,
    );
    await click('toggle-cap', '[data-id="' + capId + '"]');
    await page.waitForFunction(
      (id) => window.PFC.s.enabled.includes(id),
      capId,
    );
    await tab('bind');
    await click(
      'toggle-binding',
      '[data-stage="dev"][data-id="' + capId + '"]',
    );
    await page.waitForFunction(
      (id) => window.PFC.s.bindings.dev.includes(id),
      capId,
    );
    assert.deepEqual(
      (await f.api('/bindings')).items.find((b) => b.stage === 'dev').capIds,
      [capId],
    );
  });
  let project;
  await test('G08 G09 UI project and knowledge persist, scripts render as text', async () => {
    await tab('workspace');
    await click('load-project');
    await fill({
      'p-name': runId + '_项目',
      'p-path': 'synthetic://workspace',
      'p-repo': '',
      'p-branch': 'main',
      'p-tech': 'Node,TypeScript',
    });
    await click('save-project');
    await closed();
    project = (await f.api('/projects')).items[0];
    assert.equal(project.scanned, false);
    assert.match(await page.locator('#app').innerText(), /已登记，未扫描/);
    await tab('knowledge');
    await click('add-knowledge');
    await fill({
      'k-title': runId + '_续期知识',
      'k-content': '<script>window.__unsafe = true</script>',
      'k-tags': '续期',
    });
    await click('save-knowledge');
    await closed();
    await click('gov-knowledge-detail');
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
    assert.match(await page.locator('.doc-body').innerText(), /<script>/);
    await click('close-modal');
    await page.reload();
    await page.waitForFunction(() => window.PFCAPI?.api.ready);
    assert.match(await page.locator('#app').innerText(), /续期知识/);
  });
  await test('G16 503 and 409 preserve modal draft and retry uses current server result', async () => {
    await tab('catalog');
    await click('register-cap');
    await fill({
      name: runId + '_draft',
      endpoint: 'synthetic://draft',
      src: '合成',
      ver: '1',
      desc: '网络恢复后登记',
    });
    const requestBodies = [];
    await page.route('**/api/caps', async (route) => {
      if (route.request().method() === 'POST') {
        requestBodies.push(route.request().postDataJSON());
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'STORAGE_UNAVAILABLE', msg: 'CODEx_TEST_暂不可用' },
          }),
        });
      } else await route.continue();
    });
    await click('save-cap');
    await page.waitForFunction(() =>
      document.querySelector('#form-error')?.textContent.includes('暂不可用'),
    );
    assert.equal(
      await page.locator('[name="name"]').inputValue(),
      runId + '_draft',
    );
    assert.equal((await f.api('/caps')).total, 1);
    await page.unroute('**/api/caps');
    const sent = page.waitForRequest(
      (r) => r.url().endsWith('/api/caps') && r.method() === 'POST',
    );
    await click('save-cap');
    assert.equal(
      (await sent).postDataJSON().commandId,
      requestBodies[0].commandId,
    );
    await closed();
    await tab('team');
    const member = (await f.api('/members')).items.find(
      (m) => m.name === runId + '_executor',
    );
    await click('edit-member', '[data-id="' + member.id + '"]');
    await page.locator('[name="role"]').selectOption('viewer');
    const updated = (
      await f.api('/members/' + member.id + '/role', 'PATCH', {
        role: 'owner',
        expectedRevision: member.revision,
        ...f.command(),
      })
    ).member;
    await click('save-member-role');
    await page.waitForFunction(() =>
      document.querySelector('#form-error')?.textContent.includes('更新'),
    );
    assert.equal(await page.locator('[name="role"]').inputValue(), 'viewer');
    assert.equal(
      (await f.api('/members')).items.find((m) => m.id === member.id).role,
      'owner',
    );
    await click('close-modal');
    await f.api('/members/' + member.id + '/role', 'PATCH', {
      role: 'executor',
      expectedRevision: updated.revision,
      ...f.command(),
    });
  });
  await test('G16 committed write followed by failed read does not create a duplicate on retry', async () => {
    await tab('workspace');
    await click('load-project');
    await fill({
      'p-name': runId + '_commit_read_error',
      'p-path': 'synthetic://committed',
    });
    let committed = false,
      firstId;
    await page.route('**/api/projects**', async (route) => {
      if (route.request().method() === 'POST') {
        const response = await route.fetch();
        firstId ??= route.request().postDataJSON().commandId;
        assert.equal(route.request().postDataJSON().commandId, firstId);
        committed = true;
        await route.fulfill({ response });
      } else if (committed)
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'STORAGE_UNAVAILABLE',
              msg: 'CODEx_TEST_回读暂不可用',
            },
          }),
        });
      else await route.continue();
    });
    await click('save-project');
    await page.waitForFunction(() =>
      document
        .querySelector('#form-error')
        ?.textContent.includes('回读暂不可用'),
    );
    assert.equal(
      (await f.api('/projects?q=' + runId + '_commit_read_error')).total,
      1,
    );
    await page.unroute('**/api/projects**');
    await click('save-project');
    await closed();
    assert.equal(
      (await f.api('/projects?q=' + runId + '_commit_read_error')).total,
      1,
    );
  });
  await test('G10 G11 real CSV download and unconfigured budget', async () => {
    await tab('audit');
    await page.locator('#gov-filter [name="action"]').fill('cap.created');
    await click('gov-filter', '[data-tab="audit"]');
    const download = page.waitForEvent('download');
    await click('export-audit');
    const file = await download;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');
    assert.match(csv, /cap.created/);
    assert.equal((await f.api('/audit?action=audit.export')).total, 1);
    await file.delete();
    await tab('budget');
    assert.match(await page.locator('#app').innerText(), /未配置/);
    assert.equal((await f.api('/budgets/me')).budget.used, null);
  });
  let req, runIdCreated;
  await test('G14 G16 current workbench shows saved context before approval', async () => {
    req = await f.readyRequirement({
      name: runId + '_续期工作台',
      projectId: project.id,
    });
    await page.evaluate(() => window.PFC.domainView.sync());
    const { req: detail } = await f.api('/reqs/' + req.id);
    assert.ok(detail.effectiveCaps.some((cap) => cap.id === capId));
    assert.deepEqual(detail.caps, [], '工具能力不能成为产品 CAP');
    await page.evaluate(
      (id) =>
        window.PFC.go({
          route: 'product',
          req: id,
          productTab: 'requirements',
        }),
      req.id,
    );
    assert.match(
      await page.locator('#app').innerText(),
      /CAP \/ Unit 尚未建立/,
    );
    await page.evaluate(() => window.PFC.go({ productTab: 'trace' }));
    assert.deepEqual(
      await page.evaluate(() => window.PFC.capStatus(window.PFC.r())),
      { caps: [], done: 0, total: 0, blocked: [] },
    );
    assert.doesNotMatch(
      await page.locator('#app').innerText(),
      /全部完成|CAP 完成/,
    );
    await page.evaluate(
      (id) =>
        window.PFC.go({
          route: 'work',
          req: id,
          stage: 'dev',
          panel: 'terminal',
        }),
      req.id,
    );
    assert.match(await page.locator('.ctx-rail').innerText(), /续期知识/);
    assert.match(await page.locator('.ctx-rail').innerText(), /已登记，未扫描/);
    await click('plan-run');
    await page.waitForSelector('[data-plan-fingerprint]');
    const snapshot = await page
      .locator('[data-plan-fingerprint]')
      .getAttribute('data-plan-fingerprint');
    runIdCreated = await page.evaluate(() => window.PFC.domainPlan.runId);
    const plan = await f.api('/runs/' + runIdCreated);
    assert.equal(plan.plan.contextFingerprint, snapshot);
    assert.equal(plan.plan.approvedAt, null);
    const sql = (
      await f.db.pool.query(
        `SELECT context_fingerprint FROM "${schema}".run_plans WHERE public_id=$1`,
        [plan.plan.id],
      )
    ).rows[0];
    assert.equal(sql.context_fingerprint, snapshot);
    const reason = runId + '_补充拒绝原因';
    await fill({ 'reject-reason': reason });
    await click('close-modal');
    await closed();
    await click('gov-plan-context', '[data-id="' + runIdCreated + '"]');
    assert.equal(
      await page.locator('#modal-root [name="reject-reason"]').inputValue(),
      reason,
      '重新打开同一计划必须恢复拒绝原因草稿',
    );
    await page.reload();
    await page.waitForFunction(() => window.PFCAPI?.api.ready);
    await click('gov-plan-context', '[data-id="' + runIdCreated + '"]');
    assert.equal(
      await page.locator('#modal-root [name="reject-reason"]').inputValue(),
      reason,
      '刷新后必须恢复同一计划草稿',
    );
    await page.screenshot({
      path: resolve(evidence, 'governance-plan-review.png'),
    });
    await click('start-run');
    await closed();
    await page.waitForFunction(
      (id) =>
        window.PFC.r().runs.find((r) => r.id === id)?.status === 'SUCCEEDED',
      runIdCreated,
    );
    assert.equal(
      (await f.api('/runs/' + runIdCreated)).plan.contextFingerprint,
      snapshot,
    );
    assert.equal(
      await page.evaluate(
        (id) => window.PFC.s.ui.governance.drafts['plan:' + id] ?? null,
        runIdCreated,
      ),
      null,
      '成功处理后清理当前计划草稿',
    );
  });
  await test('G12 G16 three desktop widths, original columns and keyboard interaction', async () => {
    await page.waitForFunction(
      () => document.querySelector('#toast-root').children.length === 0,
    );
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      assert.equal(await page.locator('.ctx-rail').count(), 1);
      assert.equal(await page.locator('#panel-term').count(), 1);
      assert.equal(await page.locator('#mirror-term').count(), 1);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        cols: [...document.querySelector('.work-layout').children].map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, width: r.width };
        }),
      }));
      assert.ok(layout.scroll <= width + 1, JSON.stringify(layout));
      await page.screenshot({
        path: resolve(evidence, 'governance-work-' + width + '.png'),
      });
      await click('navigate', '[data-route="gov"]');
      await tab('catalog');
      await page.screenshot({
        path: resolve(evidence, 'governance-catalog-' + width + '.png'),
      });
      await page.evaluate(
        (id) =>
          window.PFC.go({
            route: 'work',
            req: id,
            stage: 'dev',
            panel: 'terminal',
          }),
        req.id,
      );
    }
    await click('gov-plan-context');
    await page.keyboard.press('Tab');
    assert.ok(
      await page
        .locator('[role="dialog"]')
        .evaluate((el) => el.contains(document.activeElement)),
    );
    await page.keyboard.press('Escape');
    await closed();
  });
  await test('G03 G16 current role refresh revokes visible controls without losing draft', async () => {
    await click('navigate', '[data-route="gov"]');
    await tab('catalog');
    await click('register-cap');
    await fill({ name: runId + '_permission_draft' });
    const me = (await f.api('/members')).items.find(
      (m) => m.name === runId + '_owner',
    );
    await f.api(
      '/members/' + me.id + '/role',
      'PATCH',
      { role: 'viewer', expectedRevision: me.revision, ...f.command() },
      'owner2',
    );
    await page.waitForFunction(() => window.PFC.s.role === 'viewer');
    assert.equal(
      await page.locator('[name="name"]').inputValue(),
      runId + '_permission_draft',
    );
    assert.equal(
      await page.locator('[data-action="save-cap"]').isDisabled(),
      true,
    );
    await click('close-modal');
    await page.reload();
    await page.waitForFunction(() => window.PFCAPI?.api.ready);
    assert.equal(await page.evaluate(() => window.PFC.s.role), 'viewer');
  });
  await test('G13 browser and database evidence have no seed or real execution', async () => {
    assert.deepEqual(errors, []);
    assert.ok(
      !requests.some((r) => r.path === '/api/state' && r.method === 'PUT'),
    );
    assert.equal(
      (
        await f.db.pool.query(
          `SELECT count(*) n FROM "${schema}".runs WHERE tenant_id=$1 AND execution_mode NOT IN ('server-simulation','bridge-simulation') AND status='SUCCEEDED'`,
          [context.tenantId],
        )
      ).rows[0].n,
      '0',
    );
  });
} catch (e) {
  results.push({
    name: 'browser flow',
    status: 'FAIL',
    error: e.message,
    stack: e.stack,
    diagnostic: page
      ? await page.evaluate(() => ({
          toasts: document.querySelector('#toast-root')?.textContent,
          body: document.querySelector('#form-error')?.textContent,
          caps: window.PFC?.s.caps,
          pending: [...(window.PFC?.pendingActions || [])],
        }))
      : null,
    requests,
  });
  if (page)
    await page
      .screenshot({
        path: resolve(
          evidence,
          'governance-browser-failure-' + Date.now() + '.png',
        ),
      })
      .catch(() => {});
} finally {
  await browser?.close();
  if (f) cleanup = await f.cleanup();
}
const report = {
  status: results.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL',
  browser: 'installed Microsoft Edge / Playwright; Browser plugin unavailable',
  results,
  errors,
  cleanup,
  sourceFingerprint: createHash('sha256')
    .update(readFileSync(new URL(import.meta.url)))
    .digest('hex'),
};
writeFileSync(
  resolve(evidence, 'browser-' + Date.now() + '.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      status: report.status,
      results,
      cleanup: cleanup
        ? {
            remaining: cleanup.remaining,
            filesRemaining: cleanup.filesRemaining,
            processesRemaining: cleanup.processesRemaining,
          }
        : null,
    },
    null,
    2,
  ),
);
if (report.status !== 'PASS') process.exitCode = 1;
