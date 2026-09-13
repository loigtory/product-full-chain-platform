import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  fixture,
  context,
  secondContext,
  runId,
  schema,
} from '../../server/test-data/m2c-domain-fixture.mjs';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url),
  root = fileURLToPath(new URL('.', import.meta.url));
if (
  process.env.PFC_M2C_EVIDENCE_DIR !==
  'docs/quality-gate/reports/local-use-baseline-20260913/domain'
)
  throw Error('EXPLICIT_EVIDENCE_TARGET_REQUIRED');
const evidence = resolve(process.env.PFC_M2C_EVIDENCE_DIR);
mkdirSync(evidence, { recursive: true });
const results = [],
  errors = [],
  requests = [];
let f, browser, server, cleanup;
const check = async (name, fn) => {
  await fn();
  results.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  f = await fixture();
  await require('../../server/src/persistence/migrations').migrate(f.db);
  await f.admin.query(
    `INSERT INTO "${schema}".tenants(id,name) VALUES($1,$2),($3,$4)`,
    [
      context.tenantId,
      runId + '_tenant',
      secondContext.tenantId,
      runId + '_other',
    ],
  );
  await f.prepareRuntime();
  server = await f.startServer();
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
  await ctx.addInitScript((name) => {
    window.PFC_DATA_MODE = 'api';
    window.PFC_API_BASE = 'http://127.0.0.1:5196';
    window.PFC_USER_NAME = name;
  }, f.users[0].name);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().startsWith('http://127.0.0.1:5196'))
      requests.push({ method: r.method(), path: new URL(r.url()).pathname });
  });
  const click = async (action, qualifier = '') => {
    await page.waitForFunction(() => !window.PFC.pendingActions?.size);
    const target = page
      .locator(`button[data-action="${action}"]${qualifier}`)
      .first();
    await target.click({ trial: true });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await target.click();
    await page.waitForFunction(() => !window.PFC.pendingActions?.size);
  };
  const ready = async () => {
    await page.waitForFunction(
      () => window.PFCAPI?.api.ready || window.PFC?.remoteError,
    );
    assert.equal(await page.evaluate(() => window.PFC.remoteError), null);
  };
  await page.goto(pathToFileURL(resolve(root, 'index.html')).href);
  await ready();
  await check('PG empty browser does not upload factory seed', async () => {
    assert.equal(
      await page.evaluate(() => Object.keys(window.PFC.s.reqs).length),
      0,
    );
    assert.ok(
      !requests.some((r) => r.path === '/api/state' && r.method === 'PUT'),
    );
    await page.screenshot({ path: resolve(evidence, 'pg-empty.png') });
  });
  await click('new-requirement');
  for (const [key, value] of Object.entries({
    name: runId + '_browser',
    goal: '合成到期提醒',
    scope: '仅合成范围',
    owner: runId + '_owner',
  }))
    await page.locator(`[name="${key}"]`).fill(value);
  await click('create-requirement');
  await page.waitForFunction(
    () => window.PFC.r()?.id && window.PFC.s.ui.route === 'work',
  );
  const reqId = await page.evaluate(() => window.PFC.r().id);
  f.createdIds.push(reqId);
  await check(
    'UI creates persisted requirement and unanswered questions',
    async () => {
      assert.equal(
        Number(
          (await f.admin.query(`SELECT count(*) n FROM "${schema}".reqs`))
            .rows[0].n,
        ),
        1,
      );
      assert.equal(
        await page.evaluate(
          () => window.PFC.r().questions.filter((q) => !q.answer).length,
        ),
        2,
      );
    },
  );
  const questions = await page.evaluate(() =>
    window.PFC.r().questions.map((q) => q.id),
  );
  for (const qid of questions) {
    await click('answer-question', `[data-id="${qid}"]`);
    await page.locator('[name="answer"]').fill('合成回答 ' + qid);
    await click('save-answer');
    await page.waitForFunction(
      (qid) => !!window.PFC.r().questions.find((q) => q.id === qid).answer,
      qid,
    );
    await page.waitForFunction(
      () => !document.querySelector('[role="dialog"]'),
    );
  }
  await check('UI answers create matching immutable versions', async () => {
    assert.equal(
      await page.evaluate(() => window.PFC.r().artifacts.idea.length),
      3,
    );
    assert.equal(
      Number(
        (
          await f.admin.query(
            `SELECT count(*) n FROM "${schema}".questions WHERE answer<>''`,
          )
        ).rows[0].n,
      ),
      2,
    );
  });
  for (const stage of ['idea']) {
    await page.evaluate(() =>
      document.addEventListener(
        'pointerdown',
        () => window.PFC.render({ quiet: true }),
        { once: true },
      ),
    );
    await click('confirm-artifact', `[data-stage="${stage}"]`);
    await page.waitForFunction(
      (stage) => window.PFC.latest(window.PFC.r(), stage).confirmed,
      stage,
    );
    await click('advance');
    await page.waitForFunction(
      (stage) => window.PFC.r().stage !== stage,
      stage,
    );
  }
  await click('r2-template');
  assert.equal(
    await page.evaluate(
      () =>
        window.PFC.artifactClient.states[window.PFC.r().id].inputFingerprint,
    ),
    await page.evaluate(async () => {
      const P = window.PFC;
      return (
        await window.PFCAPI.api.req(
          'GET',
          '/api/reqs/' + P.r().id + '/artifact-workspace',
        )
      ).inputFingerprint;
    }),
    'Template dialog must use the current input baseline',
  );
  await click('r2-save-template');
  assert.equal(
    await page.evaluate(
      () => document.getElementById('form-error')?.textContent || '',
    ),
    '',
    'Template creation must succeed with the current baseline',
  );
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await click('r2-proposal');
  await click('r2-adopt');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  for (const kind of ['business', 'design']) {
    await click('r2-confirm-' + kind);
    await page.locator('[name="comment"]').fill('CODEx_TEST_确认');
    if (kind === 'design')
      for (const name of ['goal', 'files', 'validation', 'exit', 'rollback'])
        await page.locator('[name="' + name + '"]').fill('CODEx_TEST_' + name);
    await click('r2-save-confirm');
    await page.waitForFunction(
      () => !document.querySelector('[role="dialog"]'),
    );
  }
  await check('UI confirmation and advancement reach dev', async () => {
    assert.equal(await page.evaluate(() => window.PFC.r().stage), 'dev');
    assert.equal(
      (
        await f.admin.query(
          `SELECT stage FROM "${schema}".reqs WHERE public_id=$1`,
          [reqId],
        )
      ).rows[0].stage,
      'dev',
    );
  });
  await click('edit-artifact', '[data-stage="dev"]');
  await page.locator('[name="field0"]').fill('合成开发说明已编辑');
  await click('save-artifact');
  await page.waitForFunction(() => window.PFC.r().artifacts.dev.length === 2);
  await check('unconfirmed draft survives browser reload', async () => {
    await page.reload();
    await ready();
    assert.equal(
      await page.evaluate(
        () => window.PFC.latest(window.PFC.r(), 'dev').fields[0].value,
      ),
      '合成开发说明已编辑',
    );
  });
  const bytes = Buffer.from('CODEx_TEST_M2C 浏览器原件\n');
  await click('attach-menu');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    click('attach-files'),
  ]);
  await chooser.setFiles({
    name: 'browser.txt',
    mimeType: 'text/plain',
    buffer: bytes,
  });
  await page.waitForFunction(() =>
    window.PFC.uiBag().atts.some((a) => a.status === 'ready'),
  );
  await page.locator('#chat-input').fill('将目标改为合成对话修改');
  await click('send');
  await page.waitForFunction(() => window.PFC.r().messages.length >= 2);
  await page.waitForFunction(
    () =>
      window.PFC.r().messages.some(
        (m) => m.role === 'ai' && m.status === 'ok',
      ) && document.querySelector('#stream')?.textContent.includes('模拟回复'),
  );
  await check('chat attachment and simulated reply persist', async () => {
    assert.equal(
      Number(
        (await f.admin.query(`SELECT count(*) n FROM "${schema}".messages`))
          .rows[0].n,
      ),
      2,
    );
    assert.match(await page.locator('#stream').innerText(), /模拟回复/);
  });
  await click('accept-diff');
  await page.waitForFunction(
    () =>
      window.PFC.latest(window.PFC.r(), 'dev').fields[0].value ===
      '合成对话修改',
  );
  await check('Diff acceptance appends a version', async () => {
    assert.equal(
      await page.evaluate(() => window.PFC.r().artifacts.dev.length),
      3,
    );
  });
  await click('plan-run');
  await click('start-run');
  await page.waitForFunction(
    () => window.PFC.run(window.PFC.r())?.status === 'SUCCEEDED',
  );
  await check('persisted simulated run visible in both terminals', async () => {
    for (const id of ['panel-term', 'mirror-term'])
      assert.match(await page.locator('#' + id).innerText(), /模拟/);
  });
  await check(
    'three desktop widths keyboard and screenshot evidence',
    async () => {
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 960 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await page.screenshot({
          path: resolve(evidence, 'pg-workbench-' + width + '.png'),
        });
      }
      await page.locator('#chat-input').focus();
      await page.evaluate(() => window.PFC.render({ quiet: true }));
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        'chat-input',
        'Background repaint must preserve chat keyboard focus',
      );
      await page.keyboard.type('未提交合成草稿');
      assert.equal(
        await page.locator('#chat-input').inputValue(),
        '未提交合成草稿',
      );
    },
  );
  await check(
    'server and browser restart restore data and original download',
    async () => {
      await f.stopServer(server);
      server = await f.startServer();
      await page.reload();
      await ready();
      assert.equal(
        await page.evaluate(() => window.PFC.run(window.PFC.r()).status),
        'SUCCEEDED',
      );
      assert.equal(
        await page.locator('#chat-input').inputValue(),
        '未提交合成草稿',
      );
      const attachment = await page.evaluate(
        () => window.PFC.r().attachments[0].id,
      );
      await click('open-attachment', `[data-id="${attachment}"]`);
      const downloading = page.waitForEvent('download');
      await click('download-attachment-original');
      const download = await downloading;
      assert.equal(
        createHash('sha256')
          .update(readFileSync(await download.path()))
          .digest('hex'),
        createHash('sha256').update(bytes).digest('hex'),
      );
      await page.screenshot({
        path: resolve(evidence, 'pg-file-restored.png'),
      });
      await click('close-modal');
    },
  );
  await check(
    'image original preview renders and releases the temporary URL',
    async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9sAAAAASUVORK5CYII=',
        'base64',
      );
      await click('attach-menu');
      const [imageChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        click('attach-files'),
      ]);
      await imageChooser.setFiles({
        name: 'synthetic.png',
        mimeType: 'image/png',
        buffer: png,
      });
      await page.waitForFunction(() =>
        window.PFC.uiBag().atts.some(
          (a) => a.name === 'synthetic.png' && a.status === 'ready',
        ),
      );
      const imageId = await page.evaluate(
        () =>
          window.PFC.uiBag().atts.find((a) => a.name === 'synthetic.png').id,
      );
      await click('open-attachment', '[data-id="' + imageId + '"]');
      await page.waitForFunction(
        () => document.querySelector('.att-preview-img')?.naturalWidth === 1,
      );
      const url = await page.locator('.att-preview-img').getAttribute('src');
      await page.screenshot({
        path: resolve(evidence, 'pg-image-preview.png'),
      });
      await click('close-modal');
      assert.equal(
        await page.evaluate(async (url) => {
          try {
            await fetch(url);
            return false;
          } catch {
            return true;
          }
        }, url),
        true,
      );
      await page.locator('#chat-input').fill('合成截图');
      await click('send');
      await page.waitForFunction(() =>
        window.PFC.r().messages.some((m) =>
          m.attachments?.some((a) => a.name === 'synthetic.png'),
        ),
      );
    },
  );
  await check(
    'message keeps historical attachment version after replacement',
    async () => {
      await page.evaluate(async () => {
        const P = window.PFC,
          q = P.r(),
          a = q.attachments.find((a) => a.name === 'browser.txt');
        await P.domainActions.mutate(q, '/materials/' + a.id + '/versions', {
          file: {
            name: 'browser-v2.txt',
            mimeType: 'text/plain',
            encoding: 'base64',
            content: btoa('replacement bytes'),
          },
        });
        await P.domainView.read(q.id);
        P.render();
      });
      const attachment = await page.evaluate(
        () =>
          window.PFC.r().messages.find((m) =>
            m.attachments?.some((a) => a.name === 'browser.txt'),
          ).attachments[0],
      );
      assert.equal(attachment.version, 1);
      await click('open-attachment', '[data-id="' + attachment.id + '"]');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        click('download-attachment-original'),
      ]);
      assert.equal(
        createHash('sha256')
          .update(readFileSync(await download.path()))
          .digest('hex'),
        createHash('sha256').update(bytes).digest('hex'),
      );
      await click('close-modal');
    },
  );
  await check(
    'message paging bounds browser restore and exposes older history',
    async () => {
      await page.evaluate(async () => {
        const P = window.PFC,
          api = window.PFCAPI.api;
        let q = P.r();
        for (let n = 0; n < 50; n++) {
          q = (
            await api.req('POST', '/api/reqs/' + q.id + '/messages', {
              commandId: 'CODEx_TEST_M2C_page_' + n,
              expectedRevision: q.revision,
              content: '合成分页 ' + n,
            })
          ).req;
        }
        await P.domainView.read(q.id);
        P.render();
      });
      await page.waitForFunction(
        () =>
          window.PFC.r().messageTotal > 100 &&
          window.PFC.r().messages.length === 100,
      );
      assert.equal(
        await page.evaluate(() => window.PFC.r().messages.length),
        100,
      );
      await click('pg-messages-page');
      await page.waitForFunction(() => window.PFC.r().messageOffset === 0);
      assert.equal(await page.evaluate(() => window.PFC.r().messageOffset), 0);
      await click('pg-messages-page', '[data-offset="latest"]');
      await page.waitForFunction(() => window.PFC.r().messageOffset > 0);
      assert.ok(await page.evaluate(() => window.PFC.r().messageOffset > 0));
    },
  );
  await check(
    'PG read failure is visible and preserves the pending draft',
    async () => {
      await page.locator('#chat-input').fill('合成网络失败草稿');
      await f.stopServer(server);
      await page.reload();
      await page.waitForFunction(() => !!window.PFC.remoteError);
      assert.ok(await page.locator('[role="alert"]').count());
      await page.screenshot({ path: resolve(evidence, 'pg-read-error.png') });
      server = await f.startServer();
      await click('pg-reload');
      await ready();
      assert.equal(
        await page.locator('#chat-input').inputValue(),
        '合成网络失败草稿',
      );
    },
  );
  await check('unsupported PG writes cannot change local facts', async () => {
    const result = await page.evaluate(() => {
      const P = window.PFC,
        before = JSON.stringify(P.s.reqs);
      try {
        // Projects are implemented by 003; release remains outside this package.
        P.actions['submit-release']({});
      } catch {
        return before === JSON.stringify(P.s.reqs);
      }
      return false;
    });
    assert.equal(result, true);
    assert.ok(
      !requests.some((r) => r.path === '/api/state' && r.method !== 'GET'),
    );
  });
  assert.deepEqual(errors, []);
} catch (e) {
  results.push({ status: 'FAIL', message: e.message });
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (f)
    try {
      cleanup = await f.cleanup();
    } catch (e) {
      results.push({ status: 'FAIL', cleanup: e.message });
      process.exitCode = 1;
    }
  writeFileSync(
    resolve(evidence, 'browser.json'),
    JSON.stringify({ runId, results, errors, requests, cleanup }, null, 2),
  );
  console.log(
    JSON.stringify({
      status: process.exitCode ? 'FAIL' : 'PASS',
      tests: results.length,
      cleanup: cleanup
        ? {
            remaining: cleanup.remaining,
            filesRemaining: cleanup.filesRemaining,
            processesRemaining: cleanup.processesRemaining,
          }
        : null,
    }),
  );
}
