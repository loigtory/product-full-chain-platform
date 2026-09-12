import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  fixture,
  ordinaryPage,
  shellSnapshot,
  referenceEvidence,
} from './flow-browser-fixture.mjs';
const f = await fixture(),
  results = [];
const page = f.page;
const settled = () =>
  page.waitForFunction(
    () =>
      !window.PFC.pendingActions?.size &&
      !document.querySelector('.flow-room [aria-busy="true"]'),
  );
const click = async (action, extra = '') => {
  await page
    .locator('button[data-action="' + action + '"]' + extra)
    .first()
    .click();
  await settled();
};
const command = (type) =>
  click('flow-command', '[data-command="' + type + '"]');
const snapshot = async () => {
  await settled();
  return page.evaluate(() =>
    JSON.parse(JSON.stringify(window.PFC.flowUI.state)),
  );
};
const req = (s) => s.reqs.find((r) => r.id === s.selected);
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    await f.shot('failure');
    throw error;
  }
};
const scenario = async (kind) => {
  await click('flow-options');
  await click('flow-scenario', '[data-kind="' + kind + '"]');
};
let createdIds = [],
  cleanup;
try {
  await check('ordinary-three-width-shell-reference', async () => {
    const reference = (
      await readFile(resolve(referenceEvidence, 'reference-shell.json'), 'utf8')
    ).replace(/\r\n/g, '\n');
    assert.equal(
      createHash('sha256').update(reference).digest('hex'),
      '23f1dbf44773c73561ae29a6271e8adbf3486945d6e4a62e38c00fda35ad7069',
      'accepted reference must remain unchanged',
    );
    const before = JSON.parse(reference);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      await ordinaryPage(page);
      assert.deepEqual(await shellSnapshot(page), before[width]);
    }
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await ordinaryPage(page);
  const original = await page.evaluate(() => ({
    key: window.PFC.KEY,
    value: localStorage.getItem(window.PFC.KEY),
    hash: location.hash,
  }));
  await check('original-entry-and-early-interactive-candidate', async () => {
    await click('scenarios');
    await click('flow-open');
    assert.match(await page.title(), /连续协作演练/);
    await page
      .locator('#flow-goal')
      .fill('CODEx_TEST_ 让会员在积分到期前收到站内提醒');
    await command('generate');
    const s = await snapshot();
    createdIds = s.reqs.map((r) => r.id);
    assert.equal(req(s).stage, 'req');
    assert.equal(req(s).versions[0].businessConfirmed, false);
    await page.locator('#flow-days').fill('0');
    await click('flow-preview');
    assert.match(await page.locator('#flow-preview-error').innerText(), /1–30/);
    await page.locator('#flow-days').fill('3');
    await click('flow-preview');
    assert.match(
      await page.locator('.flow-message-preview').innerText(),
      /3 天/,
    );
    await page.locator('#flow-enabled').uncheck();
    assert.match(
      await page.locator('.flow-message-preview').innerText(),
      /关闭/,
    );
    await page.locator('#flow-enabled').check();
    await click('flow-empty');
    assert.match(
      await page.locator('.flow-message-preview').innerText(),
      /没有/,
    );
    await click('flow-empty');
  });
  await check(
    'three-width-prototype-prd-keyboard-and-expanded-canvas',
    async () => {
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 960 });
        await f.shot('prototype-' + width);
        const fit = await page.evaluate(() => {
          const c = document
              .querySelector('.flow-room .composer')
              .getBoundingClientRect(),
            p = document
              .querySelector('.flow-room .side-panel')
              .getBoundingClientRect();
          return {
            bottom: c.bottom,
            right: p.right,
            width: innerWidth,
            height: innerHeight,
            doc: document.documentElement.scrollWidth,
          };
        });
        assert.ok(
          fit.bottom <= fit.height + 1 &&
            fit.right <= fit.width + 1 &&
            fit.doc <= fit.width + 1,
          JSON.stringify(fit),
        );
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      await page
        .locator('[data-action="flow-tab"][data-tab="prototype"][role="tab"]')
        .focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(
        () =>
          document
            .querySelector(
              '[data-action="flow-tab"][data-tab="prd"][role="tab"]',
            )
            .getAttribute('aria-selected') === 'true',
      );
      assert.match(
        await page.locator('.flow-canvas-content').innerText(),
        /PRD v1/,
      );
      await f.shot('prd');
      await click('flow-tab', '[data-tab="prototype"]');
      await page.locator('#flow-chat').fill('CODEx_TEST_ 保留此窗口的反馈草稿');
      await click('flow-expand');
      assert.ok(await page.locator('.flow-room.is-expanded').count());
      assert.equal(
        await page.locator('#flow-chat').inputValue(),
        'CODEx_TEST_ 保留此窗口的反馈草稿',
      );
      await f.shot('expanded');
      await click('flow-expand');
    },
  );
  if (!process.argv.includes('--smoke')) {
    await check('related-change-quota-failure-retry-and-history', async () => {
      await page.locator('#flow-chat').fill('提醒时间改成提前 3 天');
      await click('flow-send');
      const before = await snapshot();
      assert.equal(req(before).proposal.days, 3);
      await f.shot('related-diff');
      await page.evaluate(() => {
        window.__flowSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k.startsWith('PFC_FLOW_DEMO_V1:') && !k.endsWith(':view'))
            throw Error('CODEx_TEST_QUOTA');
          return window.__flowSet.call(this, k, v);
        };
      });
      await command('apply-proposal');
      assert.match(await page.locator('.flow-notice').innerText(), /QUOTA/);
      assert.equal((await snapshot()).revision, before.revision);
      await page.evaluate(() => {
        Storage.prototype.setItem = window.__flowSet;
        delete window.__flowSet;
      });
      await click('flow-retry');
      const s = await snapshot(),
        versions = req(s).versions;
      assert.equal(versions.length, 2);
      assert.equal(versions[1].prototype.days, 3);
      assert.equal(versions[1].prd.days, 3);
      assert.equal(versions[1].ac.days, 3);
      assert.equal(versions[0].prototype.days, 7);
      await page.locator('#flow-version').selectOption(versions[0].id);
      assert.ok(await page.locator('#flow-days').isDisabled());
      await page.locator('#flow-version').selectOption(versions[1].id);
    });
    await check(
      'refresh-draft-context-and-stage-view-preservation',
      async () => {
        await page.locator('#flow-chat').fill('CODEx_TEST_ 刷新后保留');
        await click('flow-stage', '[data-stage="test"]');
        assert.equal(req(await snapshot()).stage, 'req');
        await click('flow-stage', '[data-stage="req"]');
        await page.reload();
        assert.equal(
          await page.locator('#flow-chat').inputValue(),
          'CODEx_TEST_ 刷新后保留',
        );
        assert.equal(req(await snapshot()).versions.length, 2);
        assert.equal(
          await page.evaluate((key) => localStorage.getItem(key), original.key),
          original.value,
        );
      },
    );
    await check('cross-window-stale-write-and-request-isolation', async () => {
      await page.locator('#flow-chat').fill('提醒时间改成提前 5 天');
      await click('flow-send');
      const second = await f.context.newPage();
      await second.goto(page.url());
      await second.locator('[data-action="flow-options"]').click();
      await second
        .locator('[data-action="flow-scenario"][data-kind="owner"]')
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector('.flow-notice')
          ?.textContent.includes('另一窗口'),
      );
      await command('apply-proposal');
      assert.match(await page.locator('.flow-notice').innerText(), /版本/);
      await click('flow-reload');
      await command('apply-proposal');
      assert.equal(req(await snapshot()).versions.length, 3);
      await second.close();
      const s = await snapshot(),
        first = s.selected;
      await page.locator('#flow-req').selectOption(s.reqs[1].id);
      assert.equal(req(await snapshot()).versions.length, 0);
      await page.locator('#flow-req').selectOption(first);
      assert.equal(req(await snapshot()).versions.at(-1).prototype.days, 5);
    });
    await check('pending-decision-independent-work-and-readonly', async () => {
      await scenario('viewer');
      assert.ok(
        await page.locator('[data-command="confirm-business"]').isDisabled(),
      );
      await scenario('owner');
      await scenario('input');
      await command('prepare');
      assert.equal(req(await snapshot()).question.answer, '');
      await command('answer');
      await command('confirm-business');
      assert.equal(req(await snapshot()).stage, 'design');
      await page.locator('[data-command="confirm-design"]').focus();
      await page.keyboard.press('Enter');
      await settled();
      assert.equal(req(await snapshot()).stage, 'dev');
      assert.equal(
        await page.evaluate(() => document.activeElement?.dataset.command),
        'start-run',
      );
    });
    await check(
      'development-dual-terminals-pause-unknown-and-test-recovery',
      async () => {
        await command('start-run');
        const runId = req(await snapshot()).run.id;
        for (const terminal of ['#flow-panel-term', '#flow-mirror-term'])
          assert.match(await page.locator(terminal).innerText(), /合成演练/);
        await command('step-run');
        await command('pause');
        await command('resume');
        await scenario('unknown');
        await f.shot('unknown');
        await command('verify-run');
        assert.equal(req(await snapshot()).run.id, runId);
        assert.equal(req(await snapshot()).run.status, 'PAUSED');
        await command('resume');
        await command('step-run');
        assert.equal(req(await snapshot()).stage, 'test');
        await scenario('test-failure');
        await command('run-tests');
        assert.equal(req(await snapshot()).tests.status, 'FAIL');
        await command('fix-tests');
        await command('run-tests');
        assert.equal(req(await snapshot()).stage, 'accept');
        assert.equal(req(await snapshot()).acceptance, null);
        await f.shot('acceptance');
      },
    );
    await check(
      'human-acceptance-publication-observation-and-return',
      async () => {
        await command('accept');
        assert.equal(req(await snapshot()).stage, 'release');
        await command('approve-release');
        assert.equal(req(await snapshot()).release.status, 'APPROVED');
        await scenario('release-failure');
        await command('execute-release');
        assert.equal(req(await snapshot()).release.status, 'FAILED');
        await command('retry-release');
        assert.equal(req(await snapshot()).stage, 'observe');
        await command('collect-observation');
        await command('finish');
        assert.equal(req(await snapshot()).closed, true);
        await f.shot('observation');
        await click('flow-exit');
        assert.equal(page.url().split('#')[1], original.hash.slice(1));
        assert.equal(
          await page.evaluate((key) => localStorage.getItem(key), original.key),
          original.value,
        );
        await click('scenarios');
        await click('flow-resume');
        assert.equal(req(await snapshot()).closed, true);
        await click('flow-exit');
      },
    );
    await check('partial-generation-and-xss-as-text', async () => {
      await click('scenarios');
      await click('flow-open');
      await scenario('partial');
      createdIds.push(...(await snapshot()).reqs.map((r) => r.id));
      await page
        .locator('#flow-goal')
        .fill('CODEx_TEST_ <img src=x onerror="window.XSS=1">');
      await command('generate');
      assert.equal(req(await snapshot()).versions[0].complete, false);
      await command('complete-generation');
      await click('flow-tab', '[data-tab="prd"]');
      assert.match(
        await page.locator('.flow-canvas-content').innerText(),
        /<img/,
      );
      assert.equal(await page.evaluate(() => window.XSS), undefined);
      await click('flow-clear');
      await click('flow-clear-confirm');
      assert.equal(await page.locator('.flow-room').count(), 0);
    });
    await check('pg-dto-view-and-mode-isolation', async () => {
      await page.evaluate(() => {
        const P = window.PFC;
        window.PFCAPI.api.pg = true;
        window.PFCAPI.api.user = {
          name: 'CODEx_TEST_PG_VIEWER',
          role: 'viewer',
        };
        P.domainView.reset();
        P.remoteLoading = false;
        P.remoteError = null;
        const id = 'CODEx_TEST_FLOW_PG_VIEW';
        P.domainView.map({
          id,
          name: '合成 PG 只读视图',
          owner: '合成负责人',
          stage: 'req',
          revision: 1,
          materialRevision: 1,
          materials: [],
          questions: [],
          audit: [],
          versions: [
            {
              id: 'db-v1',
              stage: 'req',
              content: {
                id: 'req-v1',
                version: 1,
                title: '合成 PG 需求',
                fields: [{ name: '目标', value: '只验证 DTO 渲染' }],
                comments: [],
              },
              confirmedAt: null,
              stale: false,
              review: '待评审',
            },
          ],
        });
        Object.assign(P.s.ui, {
          route: 'work',
          req: id,
          stage: 'req',
          panel: 'canvas',
          artifactStage: 'req',
        });
        P.render();
      });
      assert.match(
        await page.locator('.panel-body').innerText(),
        /只验证 DTO 渲染/,
      );
      assert.ok(
        await page.locator('[data-action="confirm-artifact"]').isDisabled(),
      );
      await f.shot('pg-dto-view');
      assert.equal(await page.locator('.flow-room').count(), 0);
      const refusal = await page.evaluate(async () => {
        window.PFCStore.setMode('mock');
        try {
          await window.PFC.flowUI.open();
          return false;
        } catch (e) {
          return e.message;
        }
      });
      assert.match(refusal, /本地/);
    });
  }
  assert.deepEqual(f.errors, []);
  assert.equal(
    f.requests.some(
      (r) =>
        r.method !== 'GET' ||
        r.url.includes('/api/') ||
        r.url === 'external-blocked',
    ),
    false,
  );
  console.log(
    JSON.stringify({
      status: process.argv.includes('--smoke') ? 'SMOKE_PASS' : 'PASS',
      checks: results.length,
      results,
    }),
  );
} finally {
  cleanup = await f.cleanup();
  await f.save(
    process.argv.includes('--smoke') ? 'smoke-report' : 'browser-report',
    {
      results,
      createdIds,
      cleanup,
      errors: f.errors,
      requests: f.requests,
      source: 'synthetic local rehearsal; PG DTO view only',
    },
  );
  console.log(JSON.stringify({ cleanup }));
}
