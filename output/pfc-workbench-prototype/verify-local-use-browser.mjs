import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  fixture,
  gate,
  out,
  prefix,
} from '../../server/test-data/local-use-fixture.mjs';
await gate('browser', async (report, test) => {
  const f = await fixture();
  let ctx, page;
  report.browser =
    'Browser plugin unavailable; existing Playwright Edge; PC only';
  report.errors = [];
  report.external = [];
  report.ws = [];
  try {
    await f.start();
    ctx = await chromium.launchPersistentContext(
      resolve(f.target.root, 'browser-profile'),
      {
        channel: 'msedge',
        headless: true,
        viewport: { width: 1440, height: 960 },
        timeout: 30000,
        acceptDownloads: true,
      },
    );
    await ctx.route(/^https?:\/\//, (route) => {
      if (
        !route
          .request()
          .url()
          .startsWith(f.base + '/')
      ) {
        report.external.push('NON_LOOPBACK_REQUEST');
        return route.abort();
      }
      return route.continue();
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('pfc.prototype.dataMode', 'mock');
      localStorage.setItem('pfc.prototype.token', 'CODEx_TEST_old_token');
    });
    page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => report.errors.push(e.message));
    page.on('websocket', (socket) => {
      report.ws.push(
        new URL(socket.url()).pathname + new URL(socket.url()).search,
      );
    });
    const unlock = async () => {
      await page.locator('#local-access-key').fill(f.key);
      await page.locator('#local-access-key').press('Enter');
      await page.waitForFunction(
        () => window.PFCAPI.api.ready && !window.PFC.localSession.locked,
      );
    };
    await test('L04 fixed same-origin personal mode, keyboard unlock and no legacy token/seed fallback', async () => {
      await page.goto(f.base);
      await page.locator('#local-access-key').waitFor();
      await page.waitForFunction(() => !window.PFC.remoteLoading);
      assert.equal(await page.evaluate(() => window.PFCStore.mode), 'api');
      assert.equal(await page.evaluate(() => window.PFCAPI.api.token()), '');
      await page.screenshot({ path: resolve(out, 'unlock-1440.png') });
      await page.locator('#local-access-key').fill('x'.repeat(43));
      await page.locator('#local-access-key').press('Enter');
      await page
        .getByText('密钥不正确，请重新输入。', { exact: true })
        .waitFor();
      await unlock();
      assert.equal(
        await page.evaluate(() => Object.keys(window.PFC.s.reqs).length),
        0,
      );
      await page.evaluate(() => {
        window.PFCStore.setMode('local');
        window.PFCStore.cycle();
        window.PFC_API_BASE = 'https://invalid.invalid';
      });
      assert.equal(await page.evaluate(() => window.PFCStore.mode), 'api');
      assert.equal(await page.evaluate(() => window.PFCAPI.api.base()), f.base);
      assert.equal(await page.locator('[data-action="data-mode"]').count(), 0);
      await page.getByRole('button', { name: '本地状态', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByText('0 个原件，校验可读', { exact: false })
        .waitFor();
      await page
        .getByRole('dialog')
        .getByText('尚无完成备份', { exact: false })
        .waitFor();
      await page.screenshot({ path: resolve(out, 'local-status-1440.png') });
      await page.locator('.dialog-footer [data-action="close-modal"]').click();
    });
    await test('L04 create via UI, persist/readback and desktop reference states at three widths', async () => {
      await page.locator('[data-action="new-requirement"]').first().click();
      await page.locator('#modal-root [name="name"]').fill(prefix + '_browser');
      await page
        .locator('#modal-root [name="goal"]')
        .fill('CODEx_TEST_本机需求保存');
      await page
        .locator('#modal-root [name="scope"]')
        .fill('CODEx_TEST_仅当前本地工作空间');
      await page.locator('[data-action="create-requirement"]').click();
      await page.locator('#chat-input').waitFor();
      const id = await page.evaluate(() => window.PFC.r().id);
      f.createdIds.push(id);
      await page.waitForFunction(
        (id) => !!window.PFC.artifactClient?.states[id],
        id,
      );
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 960 });
        await page.waitForFunction(() => {
          const height = document
            .querySelector('[data-local-logout]')
            ?.getBoundingClientRect().height;
          return height > 0 && height <= 36;
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: resolve(out, 'personal-work-' + width + '.png'),
        });
      }
      await page.reload();
      await page.waitForFunction(
        () => window.PFCAPI.api.ready && !window.PFC.localSession.locked,
      );
      assert.equal(
        await page.evaluate((id) => !!window.PFC.s.reqs[id], id),
        true,
      );
    });
    await test('L04 session loss preserves current unsent input, re-unlock reads back without replay', async () => {
      await page.locator('#chat-input').fill('CODEx_TEST_未提交的输入');
      let writes = 0;
      const listener = (r) => {
        if (r.method() === 'POST' && r.url().includes('/messages')) writes++;
      };
      page.on('request', listener);
      await ctx.request.delete(f.base + '/api/auth/local-session', {
        headers: { Origin: f.base, 'Content-Type': 'application/json' },
        data: {},
      });
      await page.locator('#local-access-key').waitFor();
      const unavailable = (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: '{"error":{"code":"STORAGE_UNAVAILABLE"}}',
            })
          : route.continue();
      await page.route('**/api/auth/local-session', unavailable);
      await page.locator('#local-access-key').fill(f.key);
      await page.locator('#local-access-key').press('Enter');
      await page
        .getByText('暂时无法解锁，请核对本地服务状态。', { exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.PFCStore.mode), 'api');
      await page.unroute('**/api/auth/local-session', unavailable);
      await unlock();
      assert.equal(
        await page.locator('#chat-input').inputValue(),
        'CODEx_TEST_未提交的输入',
      );
      assert.equal(writes, 0);
      page.off('request', listener);
      assert.ok(report.ws.length > 0);
      assert.ok(report.ws.every((url) => url === '/ws/web'));
    });
    await test('L03 two tabs revoke together and an unsaved form is restored without a duplicate requirement', async () => {
      await page
        .locator('#global-header [data-action="navigate"][data-route="home"]')
        .click();
      await page.locator('[data-action="new-requirement"]').first().click();
      await page
        .locator('#modal-root [name="name"]')
        .fill(prefix + '_unsaved_form');
      await page
        .locator('#modal-root [name="goal"]')
        .fill('CODEx_TEST_表单暂存');
      const other = await ctx.newPage();
      try {
        other.setDefaultTimeout(10000);
        other.on('pageerror', (e) => report.errors.push(e.message));
        await other.goto(f.base);
        await other.waitForFunction(
          () => window.PFCAPI.api.ready && !window.PFC.localSession.locked,
        );
        await ctx.request.delete(f.base + '/api/auth/local-session', {
          headers: { Origin: f.base, 'Content-Type': 'application/json' },
          data: {},
        });
        await page.locator('#local-access-key').waitFor();
        await other.locator('#local-access-key').waitFor();
        await unlock();
        assert.equal(
          await page.locator('#modal-root [name="name"]').inputValue(),
          prefix + '_unsaved_form',
        );
        assert.equal(
          await page.locator('#modal-root [name="goal"]').inputValue(),
          'CODEx_TEST_表单暂存',
        );
        assert.equal(
          await page.evaluate(() => Object.keys(window.PFC.s.reqs).length),
          1,
        );
        await page
          .locator('#modal-root [data-action="close-modal"]')
          .filter({ hasText: '关闭' })
          .first()
          .click();
      } finally {
        await other.close();
      }
    });
    await test('L04 explicit logout clears current business page and scoped drafts; saved facts remain', async () => {
      await page
        .getByRole('button', { name: '退出并锁定', exact: true })
        .click();
      await page
        .getByText('已退出，当前工作空间的页面缓存与草稿已清除。', {
          exact: true,
        })
        .waitFor();
      assert.equal(await page.locator('#chat-input').count(), 0);
      assert.equal(
        await page.evaluate(
          () =>
            Object.keys(localStorage).filter((k) =>
              /^pfc\.(r2|r3|m4|pg\.preferences):/.test(k),
            ).length,
        ),
        0,
      );
      await unlock();
      assert.equal(
        await page.evaluate(() => Object.keys(window.PFC.s.reqs).length),
        1,
      );
      if (!(await page.locator('#chat-input').count()))
        await page.locator('[data-action="open-work"]').first().click();
      assert.equal(await page.locator('#chat-input').inputValue(), '');
      const cookies = await ctx.cookies();
      assert.equal(cookies.length, 1);
      assert.equal(cookies[0].httpOnly, true);
      assert.equal(cookies[0].sameSite, 'Strict');
    });
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.external, []);
  } finally {
    if (page && !page.isClosed()) {
      await page
        .locator('#local-access-key')
        .fill('')
        .catch(() => {});
    }
    await ctx?.close();
    report.cleanup = await f.cleanup();
  }
});
