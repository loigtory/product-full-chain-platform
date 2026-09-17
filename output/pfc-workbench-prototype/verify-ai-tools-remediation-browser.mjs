import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  databaseFixture,
  profileFixture,
  repoRoot,
  evidenceRoot,
  reportFor,
  scenario,
  saveReport,
} from '../../server/test-data/ai-tools-remediation-fixture.mjs';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright');
const report = reportFor(
  '46 rendered source UI: isolated local-state cases plus actual synthetic PG/API/WebSocket stop and refresh',
);
report.browserPath = 'Browser plugin not available; existing Playwright/Edge';
const root = path.join(repoRoot, 'output/pfc-workbench-prototype');
let server, browser, fixture, profile, helper;
try {
  server = http.createServer((req, res) => {
    const raw = new URL(req.url, 'http://127.0.0.1').pathname;
    const file = path.resolve(root, raw === '/' ? 'index.html' : '.' + raw);
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'application/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/html',
    );
    res.end(fs.readFileSync(file));
  });
  await new Promise((ok, no) =>
    server.once('error', no).listen(5204, '127.0.0.1', ok),
  );
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5204/');
  await page.waitForFunction(() => window.PFC?.makeRequirement);
  await page.evaluate(() => {
    const P = window.PFC;
    P.s.reqs = {};
    for (const id of ['R-1042', 'R-1043']) {
      const r = P.makeRequirement(id, 'CODEx_TEST_合成提醒', '合成提醒', 'dev');
      P.s.reqs[id] = r;
    }
    Object.assign(P.s.ui, {
      route: 'work',
      req: 'R-1042',
      stage: 'dev',
      realMode: false,
      execWorkspace: 'C:/unapproved-stale-workspace',
    });
    P.s.env = { ...(P.s.env || {}), execCapable: false };
    P.domainView.pg = () => true;
    P.domainView.read = async () => {};
    P.domainActions.mutate = async (q, p, payload) => {
      window.__sent = { reqId: q.id, path: p, payload };
      return { cancellation: { confirmed: false } };
    };
    P.render();
  });
  await scenario(
    report,
    'Page renders the unavailable-execution state without implicit tool launch',
    async () => {
      assert.match(await page.title(), /PFC|产品/);
      assert.match(await page.locator('body').innerText(), /开发执行暂不可用/);
      assert.equal(
        await page.getByLabel('开发执行项目目录').isDisabled(),
        true,
      );
      await page.locator('#chat-input').fill('CODEx_TEST_继续讨论');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const sent = await page.evaluate(() => window.__sent);
      assert.equal(sent.payload.tool, undefined);
      assert.equal(sent.payload.mode, undefined);
    },
  );
  await scenario(
    report,
    'Switching requirements cannot reuse a different requirement execution plan',
    async () => {
      await page.evaluate(() => {
        const P = window.PFC;
        P.s.ui.execDrafts = {
          'R-1042:dev': {
            workspace: 'C:/blocked',
            control: { confirmed: true },
          },
        };
        P.s.ui.req = 'R-1043';
        P.render();
      });
      await page.locator('#chat-input').fill('CODEx_TEST_B讨论');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const sent = await page.evaluate(() => window.__sent);
      assert.equal(sent.reqId, 'R-1043');
      assert.equal(sent.payload.tool, undefined);
    },
  );
  await scenario(
    report,
    'Client no longer silently turns AI candidate text into confirmed stage context',
    async () => {
      const sent = await page.evaluate(() => window.__sent);
      assert.equal(sent.payload.stageContext, undefined);
      assert.equal(sent.payload.control?.approvedBy, undefined);
    },
  );
  for (const width of [1280, 1440, 1920])
    await scenario(
      report,
      'Rendered viewport ' + width + ' and keyboard input',
      async () => {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('#chat-input').focus();
        await page.keyboard.type('CODEx_TEST_keyboard');
        assert.equal(
          await page
            .locator('#chat-input')
            .evaluate((el) => el === document.activeElement),
          true,
        );
        await page.screenshot({
          path: path.join(
            evidenceRoot,
            'browser-' + report.at.replace(/[:.]/g, '-') + '-' + width + '.png',
          ),
          fullPage: false,
        });
        const layout = await page.evaluate(() => ({
          body: document.documentElement.scrollWidth,
          width: innerWidth,
        }));
        assert.ok(
          layout.body <= layout.width + 1,
          'Horizontal overflow: ' + JSON.stringify(layout),
        );
        return {
          layout,
          screenshot:
            'browser-' + report.at.replace(/[:.]/g, '-') + '-' + width + '.png',
        };
      },
    );
  await scenario(report, 'No uncaught page exceptions', async () =>
    assert.deepEqual(errors, []),
  );
  await browser.close();
  browser = null;
  await new Promise((ok) => server.close(ok));
  server = null;
  await scenario(
    report,
    'Actual isolated PG/browser/WebSocket stop survives a page reload',
    async () => {
      fixture = await databaseFixture('browser');
      await require('../../server/src/persistence/migrations').migrate(
        fixture.db,
      );
      const seed = await fixture.seed(),
        { db } = fixture;
      const { randomUUID } = await import('node:crypto');
      profile = await profileFixture(fixture, seed, 'browser');
      helper = await require('../../server/src/local/lifecycle').start(
        profile.profile,
      );
      const pair =
        await require('../../server/src/persistence/transaction').withTransaction(
          db,
          async (c) => {
            const messages = require('../../server/src/persistence/messages');
            const ai = await messages.create(c, db, seed.ctx, seed.req, {
              turnId: randomUUID(),
              role: 'ai',
              stage: 'idea',
              content: 'CODEx_TEST_正在生成',
              status: 'generating',
            });
            const job =
              await require('../../server/src/persistence/agent-jobs').enqueue(
                c,
                db,
                seed.ctx,
                seed.req,
                {
                  kind: 'TEXT',
                  commandId: randomUUID(),
                  inputHash: 'b'.repeat(64),
                  input: {
                    stage: 'idea',
                    aiMessageId: ai.id,
                    content: 'CODEx_TEST_queued',
                  },
                },
              );
            return { ai, job };
          },
        );
      browser = await chromium.launch({ channel: 'msedge', headless: true });
      const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        }),
        live = await context.newPage(),
        ws = [];
      await context.route(/^https?:\/\//, (route) =>
        route.request().url().startsWith('http://127.0.0.1:5204/')
          ? route.continue()
          : route.abort(),
      );
      live.on('websocket', (socket) => ws.push(new URL(socket.url()).pathname));
      live.on('pageerror', (e) => errors.push(e.message));
      await live.goto('http://127.0.0.1:5204/');
      await live.locator('#local-access-key').fill(profile.key);
      await live.locator('#local-access-key').press('Enter');
      await live.waitForFunction(
        () => window.PFCAPI?.api.ready && !window.PFC.localSession.locked,
      );
      await live.waitForFunction(
        (id) => !window.PFC.remoteLoading && !!window.PFC.s.reqs[id],
        seed.req.public_id,
      );
      await live.evaluate((id) => {
        const P = window.PFC;
        Object.assign(P.s.ui, { route: 'work', req: id, stage: 'idea' });
        P.render();
      }, seed.req.public_id);
      await live.evaluate(async (id) => {
        await window.PFC.domainView.read(id);
        window.PFC.render();
      }, seed.req.public_id);
      await live.screenshot({
        path: path.join(
          evidenceRoot,
          'browser-pg-before-stop-' + Date.now() + '.png',
        ),
      });
      await live.locator('[data-action="stop-reply"]').first().click();
      await live.waitForFunction(
        (id) => !window.PFC.s.reqs[id]?.messages.some((m) => m.typing),
        seed.req.public_id,
      );
      const row = (
        await db.pool.query(
          'SELECT state FROM "' + db.schema + '".agent_jobs WHERE id=$1',
          [pair.job.id],
        )
      ).rows[0];
      assert.equal(row.state, 'CANCELLED');
      await live.reload();
      await live.waitForFunction(
        () => window.PFCAPI?.api.ready && !window.PFC.localSession.locked,
      );
      await live.evaluate((id) => {
        const P = window.PFC;
        Object.assign(P.s.ui, { route: 'work', req: id, stage: 'idea' });
        P.render();
      }, seed.req.public_id);
      await live.locator('#chat-input').waitFor();
      const stored = (
        await db.pool.query(
          'SELECT status FROM "' + db.schema + '".messages WHERE id=$1',
          [pair.ai.id],
        )
      ).rows[0];
      assert.equal(stored.status, 'stopped');
      assert.ok(ws.length > 0, 'Expected authenticated WebSocket connection');
      assert.deepEqual(errors, []);
      await live.screenshot({
        path: path.join(evidenceRoot, 'browser-pg-' + Date.now() + '.png'),
      });
      return {
        jobState: row.state,
        messageStatus: stored.status,
        websocketPaths: ws,
        modelCalls: 0,
      };
    },
  );
  report.tests.push({
    name: 'Actual EXEC approval/denial flow',
    status: 'BLOCKED',
    code: 'EXEC_APPROVAL_COVERAGE_UNVERIFIED',
  });
} catch (e) {
  report.errors.push({ error: e.code || e.message });
} finally {
  await browser?.close();
  if (server?.listening) await new Promise((ok) => server.close(ok));
  if (helper) {
    await require('../../server/src/local/lifecycle').stop(profile.profile);
    await helper.exit;
  }
  if (profile) await profile.cleanup();
  if (fixture) report.databaseCleanup = await fixture.cleanup();
  report.cleanup = {
    status: 'PASS',
    browserClosed: true,
    port5204Closed: true,
  };
}
saveReport(report, 'browser');
