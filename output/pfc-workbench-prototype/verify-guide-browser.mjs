import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url)),
  url = pathToFileURL(join(root, 'index.html')).href;
const evidence = await mkdtemp(join(tmpdir(), 'pfc-guide-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const results = [],
  errors = [],
  outbound = [];
let failed = false;
await context.route(/^https?:/, (route) => {
  outbound.push(route.request().url());
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
page.setDefaultNavigationTimeout(15000);
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
await page.clock.install({ time: new Date('2026-09-10T23:59:00Z') });
await page.clock.pauseAt(new Date('2026-09-11T00:00:00Z'));
const act = (name, extra = '') => {
  if (process.env.PFC_DEBUG_FLOW) console.log('ACTION ' + name + ' ' + extra);
  return page.locator(`button[data-action="${name}"]${extra}`).first();
};
const fill = (name, value) => page.locator(`[name="${name}"]`).fill(value);
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem(window.PFC.KEY)));
async function fresh(route = 'work') {
  await page.goto(url + '#/' + route);
  await page.evaluate(() => localStorage.removeItem(window.PFC.KEY));
  await page.reload();
  await page.locator('#global-header .brand').waitFor();
}
async function scenario(name) {
  await act('scenarios').click();
  await act('scenario', `[data-scenario="${name}"]`).click();
}
async function verify(observed) {
  await act('run-control', '[data-control="verify"]').click();
  await page.locator('[name="observed"]').selectOption(observed);
  await act('confirm-verification').click();
  await page.clock.runFor(1200);
}
async function shot(name) {
  await page.screenshot({
    path: join(evidence, name + '.png'),
    fullPage: false,
  });
}
async function check(name, fn) {
  if (process.argv[2] && !name.startsWith(process.argv[2])) return;
  console.log(JSON.stringify({ case: name, phase: 'start' }));
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(JSON.stringify({ case: name, status: 'PASS' }));
  } catch (error) {
    failed = true;
    console.log(
      JSON.stringify({ case: name, status: 'FAIL', error: error.message }),
    );
    results.push({
      name,
      status: 'FAIL',
      error: error.stack?.slice(0, 1700) || error.message,
    });
    await shot('failure-' + name).catch(() => {});
  }
}
async function advance(stage) {
  await act('advance').click();
  assert.match(
    await page.locator('.req-context-bar').innerText(),
    new RegExp('阶段 · ' + stage),
  );
}
try {
  await check('01-original-entry-and-mirrors', async () => {
    await fresh();
    assert.match(await page.title(), /PFC/);
    assert.equal(await page.locator('.ctx-rail').count(), 1);
    assert.equal(await page.locator('.stage-node').count(), 8);
    assert.equal(await page.locator('[role="tab"]').count(), 3);
    assert.deepEqual(
      await page.locator('#mirror-term .term-line').allTextContents(),
      await page.locator('#panel-term .term-line').allTextContents(),
    );
    await shot('development-1440');
  });
  await check('02-new-requirement-full-lifecycle', async () => {
    await fresh('home');
    await act('new-requirement').click();
    await act('create-requirement').click();
    assert.match(await page.locator('#form-error').innerText(), /填写/);
    await fill('name', 'CODEx_TEST_GUIDE 到期提醒');
    await fill('goal', '在到期前 30 天和 7 天提醒用户，允许关闭');
    await fill('scope', '仅演示提醒规则与结果展示');
    await act('create-requirement').click();
    const id = (await state()).ui.req;
    assert.match(
      await page.locator('.req-context-bar').innerText(),
      /阶段 · 想法/,
    );
    assert.equal(await act('advance').isEnabled(), false);
    for (const q of ['q1', 'q2']) {
      await act('answer-question', `[data-id="${q}"]`).click();
      await fill('answer', 'CODEx_TEST_GUIDE 合成用户；关闭即停，失败可重试');
      await act('save-answer').click();
    }
    await act('confirm-artifact', '[data-stage="idea"]').click();
    await advance('需求');
    await act('confirm-artifact', '[data-stage="req"]').click();
    await advance('设计');
    await act('confirm-artifact', '[data-stage="design"]').click();
    await advance('开发');
    await act('plan-run').click();
    assert.match(
      await page.locator('.guide-dialog').innerText(),
      /Shell|网络关闭/,
    );
    await act('start-run').click();
    const run = (await state()).reqs[id].runs.at(-1);
    assert.ok(run.snapshot.length > 0);
    await page.clock.runFor(15600);
    assert.match(await page.locator('#run-percent').innerText(), /100%/);
    assert.deepEqual(
      await page.locator('#mirror-term .term-line').allTextContents(),
      await page.locator('#panel-term .term-line').allTextContents(),
    );
    await act('preview-toggle').click();
    await act('preview-open').click();
    assert.match(
      await page.locator('.guide-dialog').innerText(),
      /CODEx_TEST_GUIDE/,
    );
    await act('close-modal').click();
    await act('preview-toggle').click();
    await act('confirm-artifact', '[data-stage="dev"]').click();
    await advance('测试');
    await act('run-tests', '[data-fail="1"]').click();
    assert.equal(await act('advance').isEnabled(), false);
    await act('resolve-defect').click();
    await fill('note', 'CODEx_TEST_GUIDE 修复边界判断，准备复测');
    await act('save-defect').click();
    await act('run-tests', ':not([data-fail])').click();
    await advance('验收');
    /* 吸收项：验收前先跑客观质量门（coverage 演示随机性置回全绿，阻断路径由 08 用例覆盖） */
    await act('run-quality-gates').click();
    await page.evaluate((rid) => {
      const q = window.PFC.s.reqs[rid];
      q.runs.at(-1).qualityGates.forEach((g) => (g.status = '通过'));
      window.PFC.save();
      window.PFC.render();
    }, id);
    await act('accept-review').click();
    for (const n of [0, 1, 2]) await page.locator(`[name="check${n}"]`).check();
    await fill(
      'note',
      'CODEx_TEST_GUIDE 已按 AC 与版本核对，示例残余风险已记录',
    );
    await act('save-accept').click();
    await advance('发布');
    await act('release-form').click();
    await fill('rollback', '关闭功能入口并恢复上个已验证版本（演示）');
    await fill('hours', '1');
    await act('submit-release').click();
    await act('release-action', '[data-control="approve"]').click();
    assert.match(
      await page.locator('.req-context-bar').innerText(),
      /阶段 · 发布/,
    );
    assert.equal((await state()).reqs[id].release.status, 'APPROVED');
    await act('release-action', '[data-control="execute"]').click();
    assert.match(
      await page.locator('.req-context-bar').innerText(),
      /阶段 · 观察复盘/,
    );
    await act('observe-form').click();
    await fill('metrics', 'CODEx_TEST_GUIDE 合成指标：送达率 98%，异常数 0');
    await fill('conclusion', '完成目标；下轮补充渠道覆盖（演示）');
    await act('finish-observation').click();
    assert.match(await page.locator('#form-error').innerText(), /尚未结束/);
    await act('close-modal').click();
    await scenario('window');
    await act('observe-form').click();
    await fill('metrics', 'CODEx_TEST_GUIDE 合成指标：送达率 98%，异常数 0');
    await fill('conclusion', '完成目标；下轮补充渠道覆盖（演示）');
    await act('finish-observation').click();
    assert.equal((await state()).reqs[id].closed, true);
    await shot('lifecycle-complete');
    await page.reload();
    assert.equal((await state()).reqs[id].closed, true);
    await act('navigate', '[data-route="home"]').click();
    assert.ok(
      !(await page.locator('.guide-grid>.card').first().innerText()).includes(
        id,
      ),
    );
  });
  await check('03-cancel-unknown-verification-retry', async () => {
    await fresh();
    const before = (await state()).reqs['R-1042'].runs.at(-1);
    await act('run-control', '[data-control="cancel"]').click();
    assert.match(await page.locator('#stream').innerText(), /正在停止/);
    await page.clock.runFor(1200);
    assert.match(await page.locator('#stream').innerText(), /已取消/);
    assert.equal((await state()).reqs['R-1042'].runs.at(-1).pct, before.pct);
    assert.equal(await act('plan-retry').count(), 0);
    await verify('CANCELLED');
    await act('plan-retry').click();
    await act('start-run').click();
    const runs = (await state()).reqs['R-1042'].runs;
    assert.equal(runs.at(-1).parentId, before.id);
    assert.equal(runs[0].status, 'CANCELLED');
    await page.reload();
    assert.equal((await state()).reqs['R-1042'].runs.at(-1).status, 'UNKNOWN');
    await verify('CANCELLED');
    assert.equal((await state()).reqs['R-1042'].runs.at(-1).verified, true);
  });
  await check('04-input-scope-and-controller-handoff', async () => {
    await fresh();
    await scenario('input');
    await act('run-input').click();
    await fill('answer', 'CODEx_TEST_GUIDE 只处理本次后端范围');
    await act('resume-input').click();
    await act('run-control', '[data-control="handoff"]').click();
    assert.equal((await state()).reqs['R-1042'].runs.at(-1).controller, 'Zed');
    await act('run-control', '[data-control="handoff"]').click();
    await scenario('approval');
    await act('scope-approval').click();
    await act('run-control', '[data-control="grant"]').click();
    assert.equal((await state()).reqs['R-1042'].runs.at(-1).status, 'RUNNING');
  });
  await check('05-version-edit-diff-conflict-and-immutability', async () => {
    await fresh();
    await act('view-stage', '[data-stage="req"]').click();
    const old = JSON.stringify((await state()).reqs['R-1042'].artifacts.req[0]);
    await act('edit-artifact', '[data-stage="req"]').click();
    await fill('field0', 'CODEx_TEST_GUIDE <b>新版背景</b>');
    await act('save-artifact').click();
    let s = await state();
    assert.equal(JSON.stringify(s.reqs['R-1042'].artifacts.req[0]), old);
    assert.equal(s.reqs['R-1042'].stage, 'req');
    assert.equal(s.reqs['R-1042'].artifacts.design.at(-1).stale, true);
    await act('compare-artifact').click();
    assert.match(
      await page.locator('.comparison').innerText(),
      /<b>新版背景<\/b>/,
    );
    assert.equal(
      await page
        .locator('.comparison b')
        .filter({ hasText: '新版背景' })
        .count(),
      0,
    );
    await act('close-modal').click();
    await scenario('version-conflict');
    await act('edit-artifact', '[data-stage="req"]').click();
    await fill('field0', 'CODEx_TEST_GUIDE 保留冲突草稿');
    await act('save-artifact').click();
    assert.match(await page.locator('#form-error').innerText(), /已有新版本/);
    assert.equal(
      await page.locator('[name="field0"]').inputValue(),
      'CODEx_TEST_GUIDE 保留冲突草稿',
    );
    await shot('version-conflict');
  });
  await check('06-material-scope-upload-impact', async () => {
    await fresh();
    await act('add-material').click();
    await fill('name', 'CODEx_TEST_GUIDE 边界补充');
    await page.locator('#material-file').setInputFiles({
      name: 'CODEx_TEST_GUIDE.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('关闭规则变更：所有渠道停止触达'),
    });
    await act('save-material').click();
    await page.locator('.guide-dialog').waitFor({ state: 'hidden' });
    assert.match(await page.locator('#stream').innerText(), /评估/);
    await act('material-impact').click();
    await act('apply-impact').click();
    const s = await state(),
      q = s.reqs['R-1042'];
    assert.equal(q.baseline, 2);
    assert.equal(q.stage, 'req');
    assert.equal(q.materials.at(-1).status, '已纳入');
    await act('add-material').click();
    await fill('name', 'CODEx_TEST_GUIDE 受限材料');
    await fill('content', '仅元信息');
    await page.locator('[name="classification"]').selectOption('受限');
    await act('save-material').click();
    assert.match(await page.locator('#form-error').innerText(), /仅登记/);
  });
  await check('07-session-team-policy-and-readonly', async () => {
    await fresh();
    const enabled = JSON.stringify((await state()).enabled);
    await act('session-caps').click();
    await act('toggle-session', '[data-id="codex"]').click();
    assert.equal(JSON.stringify((await state()).enabled), enabled);
    await act('close-modal').click();
    await act('switch-req').click();
    await act('pick-req', '[data-req="R-1031"]').click();
    assert.equal((await state()).reqs['R-1031'].overrides.dev, undefined);
    await scenario('viewer');
    await act('navigate', '[data-route="gov"]').click();
    const before = JSON.stringify((await state()).enabled);
    await act('toggle-cap', '[data-id="codex"]').click();
    assert.equal(JSON.stringify((await state()).enabled), before);
    assert.match(await page.locator('#toast-root').innerText(), /只读/);
  });
  await check('08-search-route-drafts-keyboard', async () => {
    await fresh();
    await page.locator('#chat-input').fill('CODEx_TEST_GUIDE 未发送草稿');
    await page.locator('#chat-input').dispatchEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
    });
    assert.equal((await state()).reqs['R-1042'].messages.length, 0);
    await act('panel', '[data-panel="canvas"]').click();
    assert.equal(
      await page.locator('#chat-input').inputValue(),
      'CODEx_TEST_GUIDE 未发送草稿',
    );
    await page.reload();
    assert.equal(
      await page.locator('#chat-input').inputValue(),
      'CODEx_TEST_GUIDE 未发送草稿',
    );
    await act('search').click();
    await page.locator('#global-query').fill('理赔');
    await page.locator('#global-query').press('Enter');
    assert.match(await page.locator('.req-context-bar').innerText(), /R-1031/);
    await page.goBack();
    assert.match(await page.locator('.req-context-bar').innerText(), /R-1042/);
    await act('switch-req').click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
  });
  await check('09-error-empty-reset-and-storage-isolation', async () => {
    await fresh();
    await page.evaluate(() => localStorage.setItem('CODEx_TEST_OTHER', 'keep'));
    await scenario('loading');
    assert.match(await page.locator('#app').innerText(), /加载/);
    await act('clear-view').click();
    await scenario('error');
    await act('clear-view').click();
    await scenario('empty');
    await act('confirm-empty').click();
    assert.equal(Object.keys((await state()).reqs).length, 0);
    assert.ok(await act('new-requirement').isVisible());
    await act('scenarios').click();
    await act('reset-prototype').click();
    await act('confirm-reset').click();
    assert.equal(Object.keys((await state()).reqs).length, 3);
    assert.equal(
      await page.evaluate(() => localStorage.getItem('CODEx_TEST_OTHER')),
      'keep',
    );
  });
  await check('10-team-capability-workspace-bridge-and-audit', async () => {
    await fresh('gov');
    await act('register-cap').click();
    await fill('name', 'CODEx_TEST_GUIDE 文档读取');
    await fill('src', '合成登记');
    await fill('ver', 'v1');
    await fill('desc', '只读检查演示');
    await act('save-cap').click();
    const cap = (await state()).caps.at(-1);
    assert.equal(cap.pending, true);
    assert.ok(!(await state()).enabled.includes(cap.id));
    await act('review-cap', `[data-id="${cap.id}"]`).click();
    await act('toggle-cap', `[data-id="${cap.id}"]`).click();
    await act('gov-tab', '[data-tab="team"]').click();
    await act('add-member').click();
    await fill('name', 'CODEx_TEST_GUIDE 同事');
    await act('save-member').click();
    assert.equal((await state()).team.members.at(-1).role, '只读');
    await act('gov-tab', '[data-tab="workspace"]').click();
    await act('edit-workspace').click();
    await fill('path', 'D:\\CODEx_TEST_GUIDE\\workspace');
    await act('save-workspace').click();
    await act('bridge-revoke', '[data-id="BR-01"]').click();
    await act('confirm-revoke').click();
    assert.equal((await state()).bridges[0].status, 'REVOKED');
    await act('pair-bridge').click();
    const code = await page.evaluate(() => window.PFC.pairCode);
    await fill('code', code);
    await act('confirm-pair').click();
    assert.equal((await state()).bridges.at(-1).status, 'ONLINE');
    await act('gov-tab', '[data-tab="audit"]').click();
    assert.match(await page.locator('#app').innerText(), /配对完成|成员登记/);
  });
  await check('11-verification-outcomes-and-mcp-evidence', async () => {
    await fresh();
    await scenario('unknown');
    await verify('UNKNOWN');
    assert.equal(await act('plan-retry').count(), 0);
    await verify('RUNNING');
    assert.equal((await state()).reqs['R-1042'].runs.at(-1).status, 'RUNNING');
    await scenario('unknown');
    await verify('SUCCEEDED');
    assert.equal((await state()).reqs['R-1042'].runs.at(-1).exitCode, 0);
    assert.ok(await act('plan-run').isVisible());
    await shot('verified-success');
    await act('view-stage', '[data-stage="req"]').click();
    await act('panel', '[data-panel="evidence"]').click();
    await act('mcp-read').click();
    assert.match(
      (await state()).reqs['R-1042'].artifacts.req.at(-1).fields.at(-1).value,
      /合成参考信息/,
    );
    await act('panel', '[data-panel="evidence"]').click();
    await act('export-evidence').click();
    const summary = JSON.parse(
      await page.locator('.evidence-export').inputValue(),
    );
    assert.equal(summary.demo, true);
    assert.ok(summary.events.some((x) => x.action === 'MCP 只读结果归档'));
  });
  await check(
    '12-acceptance-rejection-rework-release-expiry-and-rollback',
    async () => {
      await fresh();
      await act('switch-req').click();
      await act('pick-req', '[data-req="R-1031"]').click();
      await act('accept-reject').click();
      await fill('note', 'CODEx_TEST_GUIDE 边界行为不符，补充实现');
      await act('save-rejection').click();
      assert.equal((await state()).reqs['R-1031'].stage, 'dev');
      await act('confirm-artifact', '[data-stage="dev"]').click();
      assert.equal(await act('advance').isEnabled(), false);
      await act('plan-run').click();
      await act('start-run').click();
      await page.clock.runFor(15600);
      await act('confirm-artifact', '[data-stage="dev"]').click();
      await advance('测试');
      await act('run-tests', ':not([data-fail])').click();
      await advance('验收');
      /* 吸收项：验收前先跑客观质量门（随机性置回全绿） */
      await act('run-quality-gates').click();
      await page.evaluate(() => {
        const q = window.PFC.s.reqs['R-1031'];
        q.runs.at(-1).qualityGates.forEach((g) => (g.status = '通过'));
        window.PFC.save();
        window.PFC.render();
      });
      await act('accept-review').click();
      for (const n of [0, 1, 2])
        await page.locator(`[name="check${n}"]`).check();
      await fill('note', 'CODEx_TEST_GUIDE 修复已核对，当前版本通过');
      await act('save-accept').click();
      await advance('发布');
      await act('release-form').click();
      await fill('rollback', 'CODEx_TEST_GUIDE 恢复旧版本');
      await act('submit-release').click();
      await scenario('expiry');
      await act('release-action', '[data-control="approve"]').click();
      assert.equal((await state()).reqs['R-1031'].release.status, 'PENDING');
      await shot('release-expired');
      await act('release-form').click();
      await act('submit-release').click();
      await act('release-action', '[data-control="approve"]').click();
      await scenario('release-failure');
      await act('release-action', '[data-control="execute"]').click();
      assert.equal((await state()).reqs['R-1031'].release.status, 'FAILED');
      await shot('release-failed');
      await act('release-action', '[data-control="rollback"]').click();
      assert.equal(
        (await state()).reqs['R-1031'].release.status,
        'ROLLED_BACK',
      );
      assert.equal((await state()).reqs['R-1031'].releaseHistory.length, 1);
      await act('release-form').click();
      await act('submit-release').click();
      await act('release-action', '[data-control="reject"]').click();
      assert.equal((await state()).reqs['R-1031'].release.status, 'REJECTED');
    },
  );
  await check('13-three-width-reference-and-navigation', async () => {
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      for (const route of ['home', 'work', 'product', 'delivery', 'gov']) {
        await fresh(route);
        await shot(route + '-' + width);
        const d = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          width: innerWidth,
          header: document
            .querySelector('#global-header')
            .getBoundingClientRect().height,
          maxIcon: Math.max(
            ...[...document.querySelectorAll('svg')].map(
              (s) => s.getBoundingClientRect().width,
            ),
          ),
        }));
        assert.ok(d.scroll <= d.width, JSON.stringify(d));
        assert.equal(d.header, 52);
        assert.ok(d.maxIcon <= 32);
      }
      await fresh();
      await act('view-stage', '[data-stage="req"]').click();
      await act('open-artifact', '[data-stage="req"]').click();
      await shot('artifact-' + width);
    }
  });
} finally {
  await browser.close();
  const report = {
    status: failed || errors.length || outbound.length ? 'FAIL' : 'PASS',
    results,
    errors,
    outbound,
    evidence,
    environment:
      'Windows / project Node / isolated Edge / blocked page HTTP(S)',
    data: 'CODEx_TEST_GUIDE; deterministic local prototype factory; isolated context destroyed',
  };
  await writeFile(
    join(evidence, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
process.exitCode = failed || errors.length || outbound.length ? 1 : 0;
