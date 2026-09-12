import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const baseline = process.argv.includes('--baseline');
const target = pathToFileURL(
  join(root, baseline ? 'index.html' : 'index-v3.html'),
).href;
const evidence = await mkdtemp(join(tmpdir(), 'pfc-prototype-v3-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const errors = [];
const outbound = [];
let page;
let status = 'FAIL';
const screenshots = [];
const KEY = 'pfc.prototype.v3';
const fixture = 'CODEx_TEST_PROTOTYPE_V3';
const act = (action, attrs = '') =>
  page.locator(`[data-action="${action}"]${attrs}`).first();
const saved = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
async function shot(name) {
  const path = join(evidence, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  screenshots.push(path);
}
async function route(req, stage, panel = 'canvas') {
  await page.goto(`${target}#/work?req=${req}&stage=${stage}&panel=${panel}`);
  await page.locator('#actual-stage').waitFor();
  assert.match(
    await page.locator('.work-title h1').innerText(),
    new RegExp(req),
  );
}
async function stage(id) {
  await act('view-stage', `[data-stage="${id}"]`).click();
  await page.waitForFunction(
    (id) =>
      new URLSearchParams(location.hash.split('?')[1]).get('stage') === id,
    id,
  );
  await page
    .locator(`.stage-node[data-stage="${id}"][aria-current="step"]`)
    .waitFor();
}
async function advance(next) {
  assert.equal(
    await act('advance').isEnabled(),
    true,
    `advance-to-${next}-enabled`,
  );
  await act('advance').click();
  await page.waitForFunction(
    (next) =>
      document.querySelector('#actual-stage')?.textContent.includes(next),
    next,
  );
}
async function section(name, run) {
  await run();
  results.push(name);
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.route(/^https?:/, (route) => {
    outbound.push(route.request().url());
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(target);
  await section('01-stop-preserves-state', async () => {
    await act('continue-work').click();
    await act('stop-run').click();
    const stream = await page.locator('#stream').innerText();
    assert.ok(
      stream.includes('已停止'),
      'STOP_MUST_SHOW_STOPPED: 停止不能显示已完成',
    );
    assert.ok(
      !/已完成[\s\S]{0,90}100%/.test(stream),
      'STOP_MUST_PRESERVE_PROGRESS',
    );
    if (!baseline) {
      assert.equal(await page.locator('#run-percent').innerText(), '8%');
      assert.equal(await act('advance').isEnabled(), false);
      await page.reload();
      assert.equal(await page.locator('#run-percent').innerText(), '8%');
      assert.match(await page.locator('#stream').innerText(), /已停止/);
    }
    await shot('stopped-1440');
  });
  if (!baseline) {
    await section('02-stage-browsing-does-not-advance', async () => {
      await stage('release');
      assert.match(await page.locator('#actual-stage').innerText(), /开发/);
      assert.equal(await act('approve').isEnabled(), false);
      assert.equal(await page.locator('.stage-node.passed').count(), 3);
      assert.equal(await act('advance').count(), 0);
      await stage('req');
      assert.match(await page.locator('#actual-stage').innerText(), /开发/);
      assert.equal(await act('edit-artifact').count(), 0);
      await act('open-diff').click();
      await page.locator('.field-diffs').waitFor();
      assert.match(
        await page.locator('.artifact-title').innerText(),
        /需求文档/,
      );
      assert.match(await page.locator('.field-diffs').innerText(), /会员|积分/);
    });
    await section('03-requirement-evidence-and-route-isolation', async () => {
      await act('switch-req').click();
      await act('pick-req', '[data-req="R-1031"]').click();
      await page.waitForFunction(() =>
        document
          .querySelector('.work-title h1')
          ?.textContent.includes('R-1031'),
      );
      await act('panel', '[data-panel="evidence"]').click();
      await page.waitForFunction(() =>
        document.querySelector('#result-panel')?.textContent.includes('R-132'),
      );
      let text = await page.locator('#result-panel').innerText();
      assert.ok(
        text.includes('R-1031') &&
          text.includes('R-132') &&
          text.includes('pfc-claim'),
      );
      assert.ok(!text.includes('R-102') && !text.includes('pfc-notify'));
      await page.locator('#message-input').fill(`${fixture} 刷新后保留的草稿`);
      const before = page.url();
      await page.reload();
      assert.equal(page.url(), before);
      assert.equal(
        await page.locator('#message-input').inputValue(),
        `${fixture} 刷新后保留的草稿`,
      );
      assert.match(await page.locator('#result-panel').innerText(), /R-132/);
      await act('switch-req').click();
      await act('pick-req', '[data-req="R-1042"]').click();
      await page.waitForFunction(() =>
        document
          .querySelector('.work-title h1')
          ?.textContent.includes('R-1042'),
      );
      assert.equal(await page.locator('#message-input').inputValue(), '');
      assert.match(await page.locator('#stream').innerText(), /已停止/);
    });
    await section('04-clarification-empty-guard-and-confirmation', async () => {
      await route('R-1056', 'idea');
      assert.equal(await act('advance').isEnabled(), false);
      await act('confirm-artifact').click();
      assert.match(await page.locator('#toast').innerText(), /先回答/);
      assert.equal(await page.locator('.clarify-q.picked').count(), 0);
      for (const [id, answer] of [
        ['q1', '到期前 30 天和 7 天各提醒一次。'],
        ['q2', 'App 推送；用户可以关闭提醒。'],
      ]) {
        await act('answer-question', `[data-question="${id}"]`).click();
        await page.locator('#answer-input').fill('');
        await page.locator('#answer-form button[type="submit"]').click();
        assert.equal(await page.locator('#dialog').isVisible(), true);
        await page.locator('#answer-input').fill(answer);
        await page.locator('#answer-form button[type="submit"]').click();
      }
      assert.equal(await page.locator('.clarify-q.picked').count(), 2);
      assert.match(
        await page.locator('.artifact-document').innerText(),
        /到期前 30 天和 7 天各提醒一次/,
      );
      await act('confirm-artifact').click();
      const eventCount = (await saved()).requirements['R-1056'].events.filter(
        (e) => e.text.startsWith('确认「'),
      ).length;
      assert.equal(eventCount, 1);
      await page.reload();
      assert.equal(await act('confirm-artifact').count(), 0);
      assert.equal(
        (await saved()).requirements['R-1056'].events.filter((e) =>
          e.text.startsWith('确认「'),
        ).length,
        1,
      );
      await advance('需求');
    });
    await section(
      '05-draft-version-diff-and-immutable-confirmation',
      async () => {
        await act('run-gate').click();
        assert.match(
          await page.locator('#toast').innerText(),
          /先确认需求文档/,
        );
        await act('edit-artifact').click();
        await page
          .locator('#field-0')
          .fill(`${fixture} 修订背景 <img src=x onerror=alert(1)>`);
        await page.locator('#edit-form button[type="submit"]').click();
        await page.locator('.field-diffs').waitFor();
        assert.equal(
          await page.locator('#artifact-version').inputValue(),
          'R-1056-req-v2',
        );
        assert.match(
          await page.locator('.field-diffs .after').first().innerText(),
          /修订背景 <img/,
        );
        assert.equal(await page.locator('.field-diffs img').count(), 0);
        await page.locator('#artifact-version').selectOption('R-1056-req-v1');
        await page.waitForFunction(() =>
          document
            .querySelector('.field-diffs')
            ?.textContent.includes('用户容易遗漏'),
        );
        assert.ok(
          !(await page.locator('.field-diffs').innerText()).includes(fixture),
        );
        await page.locator('#artifact-version').selectOption('R-1056-req-v2');
        await act('confirm-artifact').click();
        await act('run-gate').click();
        const r = (await saved()).requirements['R-1056'];
        assert.equal(r.artifacts.req.length, 2);
        assert.equal(r.artifacts.req[0].confirmed, false);
        assert.equal(r.artifacts.req[1].confirmed, true);
        assert.ok(!r.artifacts.req[0].fields[0].value.includes(fixture));
        await act('toggle-focus').click();
        await page.locator('.artifact-focused').waitFor();
        assert.equal(await page.locator('.chat-main').isVisible(), false);
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () => !document.querySelector('.artifact-focused'),
        );
        await advance('设计');
      },
    );
    await section(
      '06-full-lifecycle-guards-and-approval-execution-separation',
      async () => {
        await act('confirm-artifact').click();
        await advance('开发');
        await act('resume-run').click();
        await act('run-step').click();
        assert.equal(await page.locator('#run-percent').innerText(), '25%');
        await act('stop-run').click();
        assert.equal(await page.locator('.v3-step-list .complete').count(), 1);
        assert.equal(await act('advance').isEnabled(), false);
        await act('resume-run').click();
        for (let i = 0; i < 3; i++) await act('run-step').click();
        assert.equal(await page.locator('#run-percent').innerText(), '100%');
        await advance('测试');
        assert.equal(await act('advance').isEnabled(), false);
        await act('run-gate').click();
        await advance('验收');
        assert.equal(await act('confirm-artifact').isEnabled(), false);
        for (const input of await page.locator('[data-check]').all())
          await input.check();
        await act('confirm-artifact').click();
        await advance('发布');
        assert.equal(await act('simulate-release').count(), 0);
        await act('reject-approval').click();
        assert.equal(await act('advance').isEnabled(), false);
        await act('approve').click();
        let r = (await saved()).requirements['R-1056'];
        assert.equal(r.approval, 'approved');
        assert.equal(r.released, false);
        assert.equal(await act('advance').isEnabled(), false);
        await page.reload();
        assert.match(await page.locator('#stream').innerText(), /尚未执行/);
        await act('simulate-release').click();
        await advance('观察复盘');
        await act('complete-retro').click();
        r = (await saved()).requirements['R-1056'];
        assert.equal(r.retro, true);
        assert.equal(r.released, true);
        assert.equal(
          r.events.filter((e) => e.text === '执行模拟发布完成').length,
          1,
        );
        assert.equal(
          (await saved()).requirements['R-1042'].currentStage,
          'dev',
        );
        await act('nav', '[data-route="home"]').click();
        await page.locator('.home-wrap').waitFor();
        assert.equal(
          await page.locator('.v3-todo[data-req="R-1056"]').count(),
          0,
          'completed work leaves the todo list',
        );
        assert.match(
          await page.locator('.v3-todo[data-req="R-1042"]').innerText(),
          /继续已停止/,
        );
      },
    );
    await section('07-capability-scopes-and-binding-action', async () => {
      await route('R-1042', 'dev');
      await act('session-caps').click();
      await page.locator('#session-form input[value="codex"]').uncheck();
      await page.locator('#session-form button[type="submit"]').click();
      assert.ok(
        !(await page.locator('.cap-chips').innerText()).includes('Codex'),
      );
      let s = await saved();
      assert.equal(s.enabled.codex, true);
      assert.ok(s.bindings.dev.includes('codex'));
      assert.equal(s.requirements['R-1031'].sessionCaps.dev, undefined);
      await act('nav', '[data-route="governance"]').click();
      await act('config-tab', '[data-tab="bindings"]').click();
      await act('toggle-bind', '[data-cap="zed"][data-stage="dev"]').click();
      assert.equal(
        await act('toggle-bind', '[data-cap="zed"]').getAttribute(
          'aria-pressed',
        ),
        'false',
      );
      assert.equal(new URL(page.url()).hash.startsWith('#/governance'), true);
      await act('config-tab', '[data-tab="directory"]').click();
      await act('toggle-global', '[data-cap="mcp-db"]').click();
      assert.equal(
        await act('toggle-global', '[data-cap="mcp-db"]').getAttribute(
          'aria-checked',
        ),
        'false',
      );
      s = await saved();
      assert.ok(s.bindings.dev.includes('mcp-db'));
      await route('R-1042', 'dev');
      assert.ok(
        !(await page.locator('.cap-chips').innerText()).includes('数据库查询'),
      );
      await act('session-caps').click();
      assert.equal(
        await page.locator('#session-form input[value="mcp-db"]').isDisabled(),
        true,
      );
      await act('restore-default-caps').click();
      assert.ok(
        (await page.locator('.cap-chips').innerText()).includes('Codex'),
      );
      assert.ok(
        !(await page.locator('.cap-chips').innerText()).includes('Zed'),
      );
    });
    await section(
      '08-ime-multiline-keyboard-dialog-and-navigation',
      async () => {
        const input = page.locator('#message-input');
        await input.fill(`${fixture} 中文组合输入`);
        await input.dispatchEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          isComposing: true,
          bubbles: true,
        });
        assert.equal(await input.inputValue(), `${fixture} 中文组合输入`);
        assert.equal(await page.locator('.msg.user').count(), 1);
        await input.press('End');
        await input.press('Shift+Enter');
        await input.press('x');
        assert.ok((await input.inputValue()).includes('\n'));
        await input.press('Enter');
        assert.equal(await page.locator('.msg.user').count(), 2);
        assert.equal(await input.inputValue(), '');
        assert.equal(
          (await saved()).requirements['R-1042'].run.status,
          'stopped',
        );
        await act('switch-req').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#dialog').isVisible(), true);
        for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
        assert.equal(
          await page.evaluate(() =>
            document.querySelector('#dialog').contains(document.activeElement),
          ),
          true,
        );
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#dialog').isVisible(), false);
        assert.equal(
          await page.evaluate(() => document.activeElement.dataset.action),
          'switch-req',
        );
        await page.locator('#tab-terminal').focus();
        await page.keyboard.press('ArrowRight');
        await page.locator('#tab-evidence[aria-selected="true"]').waitFor();
        await page.reload();
        assert.equal(
          await page.locator('#tab-evidence').getAttribute('aria-selected'),
          'true',
        );
        const before = page.url();
        await stage('req');
        await page.goBack();
        assert.equal(page.url(), before);
        assert.match(await page.locator('#actual-stage').innerText(), /开发/);
        await act('search').click();
        await page.locator('#search-input').fill('不存在的需求');
        assert.match(
          await page.locator('#search-results').innerText(),
          /未找到/,
        );
        await page.locator('#search-input').fill('续保');
        await act('pick-req', '[data-req="R-1018"]').click();
        await page.waitForFunction(() =>
          document
            .querySelector('.work-title h1')
            ?.textContent.includes('R-1018'),
        );
        assert.match(
          await page.locator('.work-title h1').innerText(),
          /续保提醒优化/,
        );
      },
    );
    await section('09-desktop-layouts-and-real-rendered-screens', async () => {
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [name, url] of [
          ['home', target],
          ['work', `${target}#/work?req=R-1042&stage=dev&panel=terminal`],
          ['artifact', `${target}#/work?req=R-1031&stage=accept&panel=canvas`],
          ['governance', `${target}#/governance`],
        ]) {
          await page.goto(url);
          await page.locator('#main').waitFor();
          const layout = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            header: document
              .querySelector('.global-header')
              .getBoundingClientRect().height,
            oversize: [...document.querySelectorAll('svg')].filter(
              (el) => el.getBoundingClientRect().width > 32,
            ).length,
          }));
          assert.ok(
            layout.scrollWidth <= layout.width,
            `no-horizontal-overflow-${width}-${name}`,
          );
          assert.equal(layout.header, 52, `header-single-row-${width}-${name}`);
          assert.equal(layout.oversize, 0, `icons-bounded-${width}-${name}`);
          if (name === 'work') {
            assert.ok(
              (await page.locator('#message-input').boundingBox()).y < 850,
            );
            if (width === 1280) {
              await act('toggle-context').click();
              assert.equal(await page.locator('.ctx-rail').isVisible(), true);
              await act('close-context').click();
              assert.equal(await page.locator('.ctx-rail').isVisible(), false);
              await act('toggle-context').click();
              await page.keyboard.press('Escape');
              assert.equal(await page.locator('.ctx-rail').isVisible(), false);
            }
          }
          await shot(`${name}-${width}`);
        }
      }
      await route('R-1031', 'accept');
      await act('toggle-focus').click();
      await page.locator('.artifact-focused').waitFor();
      await shot('artifact-focus-1920');
    });
    await section('10-reset-is-scoped-and-corrupt-state-recovers', async () => {
      await page.evaluate(() =>
        localStorage.setItem('CODEx_TEST_OTHER_KEY', 'keep'),
      );
      await page.goto(target);
      await act('reset').click();
      await act('close-dialog').click();
      assert.equal(
        (await saved()).requirements['R-1056'].currentStage,
        'observe',
      );
      await act('reset').click();
      await act('confirm-reset').click();
      await act('continue-work').click();
      assert.equal(await page.locator('#run-percent').innerText(), '8%');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('CODEx_TEST_OTHER_KEY')),
        'keep',
      );
      await page.evaluate(
        (key) => localStorage.setItem(key, '{invalid json'),
        KEY,
      );
      await page.reload();
      assert.match(
        await page.locator('#toast').innerText(),
        /保存记录无法读取/,
      );
      assert.equal(await page.locator('#run-percent').innerText(), '8%');
      // 独立上下文关闭即销毁测试数据；不碰用户浏览器。
      await page.evaluate(() => localStorage.clear());
    });
    await section('11-original-artifact-unchanged', async () => {
      const manifest = JSON.parse(
        await readFile(join(root, 'v3-baseline.json'), 'utf8'),
      );
      const hash = createHash('sha256')
        .update(await readFile(join(root, 'index.html')))
        .digest('hex');
      assert.equal(hash, manifest.sha256.toLowerCase());
    });
  }
  assert.deepEqual(errors, [], 'no-page-errors');
  assert.deepEqual(outbound, [], 'no-external-requests');
  status = 'PASS';
} catch (error) {
  if (page && !page.isClosed()) await shot('failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  const report = {
    status,
    results,
    errors,
    outbound,
    screenshots,
    evidence,
    browserClosed: true,
    data: 'isolated browser context; synthetic fixtures only; context destroyed on browser close',
  };
  await writeFile(
    join(evidence, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
