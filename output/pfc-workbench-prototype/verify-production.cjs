const { createRequire } = require('node:module');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const req = createRequire(__filename);
const { chromium } = req('playwright');
const root = __dirname;
const url = pathToFileURL(join(root, 'index.html')).href;
const evidence = require('node:fs').mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'pfc-remediation-'),
  ),
  results = [];
let browser, context, page, errors, outbound, notes;
const act = (name, extra = '', p = page) =>
  p.locator(`button[data-action="${name}"]${extra}`).first();
const fill = (name, value, p = page) =>
  p.locator(`[name="${name}"]`).fill(value);
const snap = () =>
  page.evaluate(() => {
    const P = window.PFC,
      s = JSON.parse(JSON.stringify(P.s)),
      bag = P.uiBag();
    s.ui.pendingAttachments = JSON.parse(JSON.stringify(bag.atts));
    s.ui.pendingRefs = JSON.parse(JSON.stringify(bag.refs));
    return { s, conflict: P.conflict || false };
  });
const observe = (value) => notes.push(value);
async function clock(p) {
  await p.clock.install({ time: new Date('2026-09-10T23:59:00Z') });
  await p.clock.pauseAt(new Date('2026-09-11T00:00:00Z'));
}
async function fresh(stage = 'dev') {
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  await context.route(/^https?:/, (r) => {
    outbound.push(r.request().url());
    return r.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(2500);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await clock(page);
  await page.goto(url + '#/work?req=R-1042&stage=' + stage);
  await page.locator('.composer').waitFor();
}
async function upload(
  name = 'CODEx_TEST_PROD_REVIEW.md',
  body = '# 合成材料\n不得包含真实客户数据',
  mime = 'text/markdown',
) {
  await act('attach-menu').click();
  const pending = page.waitForEvent('filechooser');
  await act('attach-files').click();
  const chooser = await pending;
  await chooser.setFiles({ name, mimeType: mime, buffer: Buffer.from(body) });
  await page.locator('.guide-dialog').waitFor({ state: 'hidden' });
}
async function send(text) {
  await page.locator('#chat-input').fill(text);
  await act('send').click();
}
async function pick(id, p = page) {
  await act('switch-req', '', p).click();
  await act('pick-req', `[data-req="${id}"]`, p).click();
}
async function scenario(id) {
  await act('scenarios').click();
  await act('scenario', `[data-scenario="${id}"]`).click();
}
async function download(button) {
  const pending = page.waitForEvent('download');
  await button.click();
  const d = await pending;
  const path = join(evidence, Date.now() + '-' + d.suggestedFilename());
  await d.saveAs(path);
  return { name: d.suggestedFilename(), body: await readFile(path, 'utf8') };
}
async function check(id, title, stage, fn) {
  if (process.argv[2] && !process.argv[2].split(',').includes(id)) return;
  errors = [];
  outbound = [];
  notes = [];
  let status = 'PASS',
    error = '';
  try {
    await fresh(stage);
    await fn();
    assert.equal(errors.length, 0, '页面存在未处理异常');
    assert.equal(outbound.length, 0, '页面尝试外部请求');
  } catch (e) {
    status = 'FAIL';
    error = e.message;
  }
  const screenshot = id + '-' + status + '.png';
  if (page)
    await page.screenshot({ path: join(evidence, screenshot) }).catch(() => {});
  results.push({
    id,
    title,
    status,
    error,
    notes,
    errors,
    outbound,
    screenshot,
  });
  console.log(JSON.stringify({ id, status, error, notes }));
  if (context) await context.close();
}
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await check('A01', '纯附件发送与已发送文本预览', 'dev', async () => {
      await upload();
      await act('send').click();
      const r = (await snap()).s.reqs['R-1042'];
      const m = r.messages.find((x) => x.role === 'user');
      assert.equal(m.text, '');
      assert.equal(m.attachments[0].status, 'ready');
      await page
        .locator('.msg-atts button[data-action="open-attachment"]')
        .click();
      assert.match(await page.locator('.guide-dialog').innerText(), /合成材料/);
      observe({
        attachment: m.attachments[0].name,
        version: 'user updated original',
      });
    });
    await check('A02', '待发送附件可预览', 'dev', async () => {
      await upload();
      await page
        .locator('.attach-tray button[data-action="open-attachment"]')
        .click();
      observe({
        toast: await page.locator('#toast-root').innerText(),
        dialog: await page.locator('.guide-dialog').count(),
      });
      assert.equal(
        await page.locator('.guide-dialog').count(),
        1,
        '发送前点预览没有打开预览',
      );
    });
    await check('A03', '附件草稿按需求隔离', 'dev', async () => {
      await upload('CODEx_TEST_A_ONLY.md', 'A需求独有合成内容');
      await pick('R-1031');
      const s = (await snap()).s;
      observe({
        req: s.ui.req,
        queue: s.ui.pendingAttachments.map((x) => x.name),
      });
      assert.equal(
        s.ui.pendingAttachments.length,
        0,
        '切换需求后仍携带前一需求附件',
      );
    });
    await check('A04', '引用草稿按需求隔离', 'dev', async () => {
      await act('attach-menu').click();
      await act('attach-material-ref').click();
      await act('pick-ref').click();
      await pick('R-1031');
      await send('请只分析当前需求');
      const m = (await snap()).s.reqs['R-1031'].messages.find(
        (x) => x.role === 'user',
      );
      observe({ req: 'R-1031', refs: m.refs });
      assert.equal(m.refs.length, 0, '新需求消息带有旧需求材料引用');
    });
    await check(
      'A05',
      '受限且禁止AI材料不能加入本轮上下文',
      'dev',
      async () => {
        await act('add-material').click();
        await fill('name', 'CODEx_TEST_RESTRICTED');
        await fill('content', '合成受限资料');
        await page.locator('[name="classification"]').selectOption('受限');
        await page.locator('[name="allowed"]').selectOption('no');
        await act('save-material').click();
        await act('attach-menu').click();
        await act('attach-material-ref').click();
        const restricted = page
          .locator('button[data-action="pick-ref"]')
          .filter({ hasText: 'CODEx_TEST_RESTRICTED' });
        const allowed =
          (await restricted.count()) && (await restricted.isEnabled());
        if (allowed) {
          await restricted.click();
          await send('参考这份材料回答');
          await page.clock.runFor(900);
        }
        const s = (await snap()).s;
        observe({
          material: s.reqs['R-1042'].materials.at(-1),
          message: s.reqs['R-1042'].messages.at(-1)?.text,
        });
        assert.equal(
          Boolean(allowed),
          false,
          '禁止用于AI的材料仍可引用，答复声称已使用',
        );
      },
    );
    await check('A06', '重试不能绕过不支持文件类型', 'dev', async () => {
      await upload(
        'CODEx_TEST_INVALID.exe',
        'synthetic-not-an-executable',
        'application/octet-stream',
      );
      let a = (await snap()).s.ui.pendingAttachments[0];
      assert.equal(a.status, 'error');
      await act('retry-pending').click();
      await page.clock.runFor(600);
      await page.waitForFunction(
        () => window.PFC.uiBag().atts[0].status !== 'parsing',
      );
      a = (await snap()).s.ui.pendingAttachments[0];
      observe(a);
      assert.equal(
        a.status,
        'error',
        '重试未重做校验，直接把无效文件改为可引用',
      );
    });
    await check(
      'A07',
      '文件读取中发送不能留下永久解析附件',
      'dev',
      async () => {
        await page.evaluate(() => {
          const file = new File(['合成异步读取内容'], 'CODEx_TEST_SLOW.md', {
            type: 'text/markdown',
          });
          file.text = () =>
            new Promise((resolve) => {
              window.releaseSyntheticRead = () => resolve('合成异步读取内容');
            });
          window.pendingSyntheticRead = window.PFC.enqueueFile(file);
        });
        if (await act('send').isEnabled()) await act('send').click();
        await page.evaluate(async () => {
          window.releaseSyntheticRead();
          await window.pendingSyntheticRead;
        });
        const s = (await snap()).s,
          msg = s.reqs['R-1042'].messages.find((x) => x.role === 'user');
        observe({ sent: !!msg, attachment: msg?.attachments[0] });
        assert.ok(
          !msg || msg.attachments[0].status === 'ready',
          '已发送附件永久解析中，完成的读取未回写消息',
        );
      },
    );
    await check('A08', '截图粘贴和放大预览保留原图尺寸', 'dev', async () => {
      await page.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 1200;
        c.height = 800;
        c.getContext('2d').fillText('CODEx_TEST_PROD_REVIEW', 50, 60);
        const blob = await new Promise((r) => c.toBlob(r));
        const dt = new DataTransfer();
        dt.items.add(
          new File([blob], 'CODEx_TEST_SCREEN.png', { type: 'image/png' }),
        );
        document.querySelector('#chat-input').dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.waitForFunction(
        () => window.PFC.uiBag().atts[0]?.status === 'ready',
      );
      await act('send').click();
      await act('open-attachment').click();
      await page.locator('.att-preview-img').waitFor();
      const dimensions = await page
        .locator('.att-preview-img')
        .evaluate((img) => ({
          width: img.naturalWidth,
          height: img.naturalHeight,
        }));
      observe(dimensions);
      assert.equal(
        dimensions.width,
        1200,
        '放大预览只能拿到160px缩略图，原图已丢失',
      );
    });
    await check('A09', '上下文引用可以回到来源', 'dev', async () => {
      await act('attach-menu').click();
      await act('attach-material-ref').click();
      await act('pick-ref').click();
      await send('依据引用给出建议');
      await page.clock.runFor(900);
      const chip = page.locator('.msg-refs .ref-chip').first();
      await chip.click();
      observe({
        dialog: await page.locator('.guide-dialog').count(),
        clickable: await chip.evaluate(
          (x) =>
            x.matches('a,button,[role="button"]') ||
            !!x.querySelector('a,button'),
        ),
      });
      assert.equal(
        await page.locator('.guide-dialog').count(),
        1,
        '引用仅是标签，没有来源定位',
      );
    });
    await check('D01', '单个差异采纳保存并立即更新画布', 'idea', async () => {
      await send('把30 天改为45 天');
      await page.clock.runFor(900);
      assert.ok(await act('accept-diff').count());
      await act('accept-diff').click();
      const s = await snap(),
        mem = s.s.reqs['R-1042'].artifacts.idea.at(-1).id;
      const stored = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem(window.PFC.KEY)).reqs[
            'R-1042'
          ].artifacts.idea.at(-1).id,
      );
      observe({
        memory: mem,
        storage: stored,
        remainingButtons: await act('accept-diff').count(),
      });
      assert.equal(stored, mem, '采纳只改内存；静止时钟下没有保存，刷新可丢失');
      assert.equal(
        await act('accept-diff').count(),
        0,
        '采纳后按钮和画布未立即更新',
      );
    });
    await check('D02', '点击哪条差异就处理哪条', 'idea', async () => {
      await send('把30 天改为45 天');
      await page.clock.runFor(900);
      await send('把30 天改为60 天');
      await page.clock.runFor(900);
      assert.equal(
        await page.locator('button[data-action="accept-diff"]').count(),
        2,
      );
      await page.locator('button[data-action="accept-diff"]').first().click();
      const v = (await snap()).s.reqs['R-1042'].artifacts.idea.at(-1);
      observe({
        version: v.id,
        content: v.fields.map((x) => x.value).join('\n'),
      });
      assert.ok(
        v.fields.some((x) => x.value.includes('45 天')),
        '点击第一条45天建议，实际应用了最新60天建议',
      );
    });
    await check('D03', '选择历史版本后下载相同版本', 'req', async () => {
      const old = (await snap()).s.reqs['R-1042'].artifacts.req[0].id;
      await act('edit-artifact', '[data-stage="req"]').click();
      await fill('field0', 'CODEx_TEST_NEW_VERSION');
      await act('save-artifact').click();
      await page.locator('#version-select').selectOption(old);
      const d = await download(
        page.locator('.side-panel button[data-action="download-artifact"]'),
      );
      observe({
        viewed: old,
        download: d.name,
        firstLine: d.body.split('\n')[0],
      });
      assert.equal(d.name, old + '.md', '画布选择v1，下载却返回最新v2');
    });
    await check('D04', '失败消息重发形成可继续的答复', 'dev', async () => {
      await page.evaluate(() => {
        const P = window.PFC;
        P.r().messages.push({
          id: 'CODEx_TEST_FAILED',
          turnId: 'CODEx_TEST_TURN',
          role: 'user',
          stage: 'dev',
          text: '合成失败请求',
          attachments: [],
          refs: [],
          status: 'failed',
          error: '合成断连',
        });
        P.save();
        P.render();
      });
      await act('resend-message').click();
      await page.clock.runFor(900);
      const m = (await snap()).s.reqs['R-1042'].messages;
      observe(
        m.map((x) => ({
          id: x.id,
          role: x.role,
          status: x.status,
          resent: x.resent,
        })),
      );
      assert.ok(
        m.some((x) => x.role === 'ai'),
        '重发只新增用户气泡，没有回合处理或答复',
      );
    });
    await check('D05', '刷新恢复未执行且未过期的对话建议', 'idea', async () => {
      await send('请整理文档');
      await page.clock.runFor(900);
      const selector = '.msg button[data-proposal]';
      assert.equal(await page.locator(selector).count(), 1);
      await page.reload();
      await page.locator(selector).click();
      observe({
        toast: await page.locator('#toast-root').innerText(),
        dialog: await page.locator('.guide-dialog').count(),
      });
      assert.equal(
        await page.locator('.guide-dialog').count(),
        1,
        '无版本变化，刷新后所有建议索引丢失',
      );
    });
    await check('W01', '工作区文件下载返回所选文件内容', 'dev', async () => {
      await page.clock.runFor(15600);
      const run = (await snap()).s.reqs['R-1042'].runs.at(-1);
      assert.ok(run.files.length);
      const file = run.files[0];
      await act('open-ws-file', `[data-file="${file.path}"]`).click();
      const d = await download(
        page.getByRole('button', { name: '下载文件内容', exact: true }),
      );
      observe({
        selected: file.path,
        download: d.name,
        body: d.body.slice(0, 130),
      });
      assert.equal(
        d.body,
        file.preview,
        '下载源码按钮实际下载整个开发交接Markdown',
      );
    });
    await check('W02', '历史作业搜索定位准确runId', 'dev', async () => {
      await page.evaluate(() => {
        const P = window.PFC,
          r = P.r();
        r.runs.push({
          ...P.clone(r.runs[0]),
          id: 'CODEx_TEST_SECOND_RUN',
          status: 'CANCELLED',
        });
        P.save();
        P.render();
      });
      await act('search').click();
      await page.locator('#global-query').fill('R-102');
      observe({
        resultHTML: await page.locator('#search-results').innerHTML(),
      });
      await page
        .locator('#search-results button')
        .filter({ hasText: 'R-102' })
        .click();
      observe({
        selectedRun: (await snap()).s.ui.runId,
        terminal: await page.locator('#panel-term .t-head').innerText(),
      });
      assert.equal((await snap()).s.ui.runId, 'R-102');
    });
    await check('G01', '多窗口冲突不能通过导航覆盖新数据', 'dev', async () => {
      const other = await context.newPage();
      other.setDefaultTimeout(2500);
      await clock(other);
      await other.goto(url + '#/home');
      await act('new-requirement', '', other).click();
      await fill('name', 'CODEx_TEST_OTHER_WINDOW', other);
      await fill('goal', '另一窗口已保存的需求', other);
      await fill('scope', '仅合成测试', other);
      await act('create-requirement', '', other).click();
      const created = await other.evaluate(() => window.PFC.s.ui.req);
      await page.waitForFunction(() => window.PFC.conflict === true);
      const before = await page.evaluate(
        (id) => !!JSON.parse(localStorage.getItem(window.PFC.KEY)).reqs[id],
        created,
      );
      assert.equal(before, true);
      await act('navigate', '[data-route="product"]').click();
      const after = await other.evaluate(
        (id) => !!JSON.parse(localStorage.getItem(window.PFC.KEY)).reqs[id],
        created,
      );
      observe({
        created,
        conflict: (await snap()).conflict,
        presentBefore: before,
        presentAfter: after,
      });
      assert.equal(
        after,
        true,
        '已提示冲突的旧窗口仍保存整份旧状态，删除另一窗口新需求',
      );
    });
    await check('G02', '只读成员拖入文件有受控拒绝', 'dev', async () => {
      await scenario('viewer');
      await page.evaluate(() => {
        const d = new DataTransfer();
        d.items.add(
          new File(['合成内容'], 'CODEx_TEST_READONLY.md', {
            type: 'text/markdown',
          }),
        );
        document.querySelector('.composer').dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: d,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.locator('#chat-input').focus();
      observe({ errors, queue: (await snap()).s.ui.pendingAttachments.length });
      assert.equal((await snap()).s.ui.pendingAttachments.length, 0);
      assert.equal(errors.length, 0, '只读拖拽抛出未捕获异常，未给受控反馈');
    });
    await check('G03', '需求范围重排保留身份且追踪不改变', 'req', async () => {
      const before = (await snap()).s.reqs['R-1042'];
      await act('space-tab', '[data-tab="trace"]').click();
      const oldRows = await page
        .locator('.data-table tbody tr')
        .allTextContents();
      await act('edit-scope').click();
      await fill(
        'units',
        before.units
          .slice()
          .reverse()
          .map((x) => x.name)
          .join('\n'),
      );
      await act('save-scope').click();
      const now = (await snap()).s.reqs['R-1042'];
      assert.equal(now.units[0].id, before.units[1].id);
      const rows = await page.locator('.data-table tbody tr').allTextContents();
      observe({ oldRows, rows });
      const beforeUnit2 = oldRows.find((x) => x.includes(before.units[1].id));
      const afterUnit2 = rows.find((x) => x.includes(before.units[1].id));
      assert.equal(
        /AC-02/.test(afterUnit2),
        /AC-02/.test(beforeUnit2),
        '仅重排Unit却改变其关联AC',
      );
    });
    await check('G04', '多材料影响逐项有明确处理对象', 'dev', async () => {
      for (const n of [1, 2]) {
        await act('add-material').click();
        await fill('name', 'CODEx_TEST_IMPACT_' + n);
        await fill('content', '合成材料' + n);
        await act('save-material').click();
      }
      assert.equal((await snap()).s.reqs['R-1042'].impactList.length, 2);
      await act('material-impact').click();
      const text = await page.locator('.guide-dialog').innerText();
      observe({ dialog: text });
      assert.match(
        text,
        /CODEx_TEST_IMPACT_1/,
        '已有队列，但批准弹窗不展示正在处理哪份材料',
      );
    });
    await check('G05', '测试批次失败详情可回看', 'dev', async () => {
      await page.evaluate(() => {
        const P = window.PFC,
          r = P.r();
        P.completeRun(r, r.runs[0]);
        P.confirmVersion(r, 'dev', P.latest(r, 'dev').id);
        P.advance(r);
        P.save();
        P.render();
      });
      await act('run-tests', '[data-fail="1"]').click();
      const first = (await snap()).s.reqs['R-1042'].testRuns.at(-1).id;
      await act('run-tests', ':not([data-fail])').click();
      observe({
        history: (await snap()).s.reqs['R-1042'].testRuns.map((x) => x.id),
        buttons: await page.locator('button').allTextContents(),
      });
      const btn = page.locator('button').filter({ hasText: first });
      assert.ok(await btn.count(), '测试历史需要可打开入口');
      await btn.click();
      assert.match(await page.locator('.guide-dialog').innerText(), /FAIL/);
    });
    await check('G06', '材料加入引用后刷新仍保留草稿', 'dev', async () => {
      await act('attach-menu').click();
      await act('attach-material-ref').click();
      await act('pick-ref').click();
      assert.equal((await snap()).s.ui.pendingRefs.length, 1);
      await page.reload();
      observe({ refs: (await snap()).s.ui.pendingRefs });
      assert.equal(
        (await snap()).s.ui.pendingRefs.length,
        1,
        '添加引用未保存，刷新丢失',
      );
    });
    await check('V01', '三档PC常规页面与输入区布局', 'dev', async () => {
      const readings = [];
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 960 });
        for (const route of ['home', 'work', 'product', 'delivery', 'gov']) {
          await page.goto(url + '#/' + route + '?req=R-1042&stage=dev');
          await page.locator('#app').waitFor();
          const info = await page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            header: document
              .querySelector('#global-header')
              .getBoundingClientRect().height,
            body: document.querySelector('#app').innerText.length,
          }));
          readings.push({ route, ...info });
          assert.ok(info.body > 40);
          assert.ok(info.scroll <= width);
          assert.equal(info.header, 52);
          await page.screenshot({
            path: join(evidence, `view-${route}-${width}.png`),
          });
        }
      }
      observe(readings);
    });
    await check('V02', '多附件时聊天输入和对话区仍可使用', 'dev', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      const files = Array.from({ length: 15 }, (_, i) => ({
        name: `CODEx_TEST_${i}_较长名称的需求附件与规则说明.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from('合成内容'),
      }));
      await act('attach-menu').click();
      const f = page.waitForEvent('filechooser');
      await act('attach-files').click();
      await (await f).setFiles(files);
      await page.locator('.guide-dialog').waitFor({ state: 'hidden' });
      const rects = await page.evaluate(() =>
        Object.fromEntries(
          ['.stream', '.composer', '#chat-input'].map((sel) => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return [sel, { top: r.top, bottom: r.bottom, height: r.height }];
          }),
        ),
      );
      observe(rects);
      assert.ok(
        rects['.stream'].height >= 150 && rects['#chat-input'].bottom <= 720,
        '多附件占满工作区并挤掉对话/输入',
      );
    });
    await check(
      'B01',
      '冲突后编辑输入不得覆盖另一窗口记录',
      'dev',
      async () => {
        const other = await context.newPage();
        other.setDefaultTimeout(2500);
        await clock(other);
        await other.goto(url + '#/home');
        await act('new-requirement', '', other).click();
        await fill('name', 'CODEx_TEST_CONFLICT_INPUT', other);
        await fill('goal', '冲突后草稿保留', other);
        await fill('scope', '合成范围', other);
        await act('create-requirement', '', other).click();
        const id = await other.evaluate(() => window.PFC.s.ui.req);
        await page.waitForFunction(() => window.PFC.conflict === true);
        await page.locator('#chat-input').fill('CODEx_TEST_LOCAL_DRAFT');
        const stored = await other.evaluate(() =>
          JSON.parse(localStorage.getItem(window.PFC.KEY)),
        );
        observe({
          created: id,
          conflict: (await snap()).conflict,
          survives: !!stored.reqs[id],
          draft: stored.ui.drafts['R-1042'],
        });
        assert.ok(
          stored.reqs[id],
          '导航已防冲突，但输入事件仍全量保存旧快照并丢失另一窗口需求',
        );
      },
    );
    await check('B02', '点击历史消息引用返回该消息来源', 'dev', async () => {
      await act('attach-menu').click();
      await act('attach-material-ref').click();
      await act('pick-ref').click();
      await send('CODEx_TEST_FIRST 引用材料');
      await page.clock.runFor(900);
      await act('attach-menu').click();
      await act('attach-artifact-ref').click();
      await act('pick-ref', '[data-stage="req"]').click();
      await send('CODEx_TEST_SECOND 引用产物');
      await page.clock.runFor(900);
      const chip = page.locator('.msg-refs .ref-chip').first();
      const label = await chip.innerText();
      await chip.click();
      const body = await page.locator('.guide-dialog').innerText();
      observe({ clicked: label, dialog: body });
      assert.match(
        body,
        /R-1042-M1/,
        '点击第一条材料引用却打开最后一条消息的产物引用',
      );
    });
    await check('B03', '下载全文包含截断之后的文本', 'dev', async () => {
      const body =
        'CODEx_TEST_LONG\n' + 'A'.repeat(59000) + '\nCODEx_TEST_END_MARKER';
      await upload('CODEx_TEST_LONG.txt', body, 'text/plain');
      await act('open-attachment').click();
      const d = await download(act('download-attachment-text'));
      observe({
        inputLength: body.length,
        downloadLength: d.body.length,
        name: d.name,
        hasEnd: d.body.includes('CODEx_TEST_END_MARKER'),
      });
      assert.ok(d.body === body, '下载全文仍返回已截断的50000字符');
    });
    await check('B04', '已发送附件也能下载正文', 'dev', async () => {
      await upload();
      await act('send').click();
      await act('open-attachment').click();
      const pending = page.waitForEvent('download', { timeout: 1500 });
      await act('download-attachment-text').click();
      const d = await pending.catch(() => null);
      observe({
        download: !!d,
        toast: await page.locator('#toast-root').innerText(),
      });
      assert.ok(d, '发送后附件从队列移除，下载未查消息附件而报告不存在');
    });
    await check(
      'B05',
      '冻结交付包不能混入批准后新增产物',
      'release',
      async () => {
        await page.evaluate(() => {
          const P = window.PFC,
            q = P.r();
          P.completeRun(q, q.runs[0]);
          q.stage = 'release';
          P.s.ui.stage = 'release';
          q.accept = {
            status: 'ACCEPTED',
            actor: 'CODEx_TEST_ACCEPTOR',
            note: '合成验收',
          };
          P.save();
          P.render();
        });
        await act('release-form').click();
        await fill('rollback', 'CODEx_TEST_ROLLBACK');
        await act('submit-release').click();
        await act('release-action', '[data-control="approve"]').click();
        const snapBefore = (await snap()).s.reqs['R-1042'].release.snapshot;
        assert.ok(snapBefore);
        await act('release-form').click();
        await act('submit-release').click();
        await act('view-stage', '[data-stage="req"]').click();
        await act('edit-artifact', '[data-stage="req"]').click();
        await fill('field0', 'CODEx_TEST_AFTER_APPROVAL');
        await act('save-artifact').click();
        await act('view-stage', '[data-stage="release"]').click();
        await act('release-snapshot').click();
        const d = await download(act('deliver-package'));
        observe({
          frozen: snapBefore.artifacts.req,
          current: (await snap()).s.reqs['R-1042'].artifacts.req.at(-1).id,
          containsNew: d.body.includes('CODEx_TEST_AFTER_APPROVAL'),
          labelsFrozen: d.body.includes('冻结快照'),
        });
        assert.ok(
          !d.body.includes('CODEx_TEST_AFTER_APPROVAL'),
          '按此快照生成交付包仍混入审批后的新版本正文',
        );
      },
    );
    await check(
      'B06',
      '引用后被排除的材料在发送时重新校验',
      'dev',
      async () => {
        await act('add-material').click();
        await fill('name', 'CODEx_TEST_REVOKED_SOURCE');
        await fill('content', '合成可撤销内容');
        await act('save-material').click();
        const material = (await snap()).s.reqs['R-1042'].materials.at(-1);
        await act('attach-menu').click();
        await act('attach-material-ref').click();
        await act('pick-ref', `[data-id="${material.id}"]`).click();
        await act('material-impact').click();
        await act('exclude-impact').click();
        await send('CODEx_TEST 使用当前引用');
        await page.clock.runFor(900);
        const q = (await snap()).s.reqs['R-1042'];
        const bad = q.messages
          .filter((x) => x.role === 'user')
          .at(-1)
          ?.refs?.some((x) => x.id === material.id);
        observe({
          material: q.materials.find((x) => x.id === material.id),
          badReferenceSent: !!bad,
          reply: q.messages.at(-1)?.text,
        });
        assert.ok(!bad, '排除材料后仍把旧草稿引用随消息送出');
      },
    );
    await check('B07', '旧版待发送附件和引用升级后仍可见', 'dev', async () => {
      await page.evaluate(() => {
        const P = window.PFC;
        P.s.ui.pending = {};
        P.s.ui.pendingAttachments = [
          {
            id: 'CODEx_TEST_LEGACY_ATT',
            name: 'CODEx_TEST_LEGACY.md',
            type: 'text',
            status: 'ready',
            content: '合成旧稿',
            size: '1 KB',
          },
        ];
        P.s.ui.pendingRefs = [
          {
            kind: 'material',
            id: 'R-1042-M1',
            version: 1,
            label: '原始想法 v1',
          },
        ];
        P.save();
      });
      await page.reload();
      const s = await snap();
      observe({
        currentAtts: s.s.ui.pendingAttachments,
        currentRefs: s.s.ui.pendingRefs,
      });
      assert.equal(
        s.s.ui.pendingAttachments.length,
        1,
        '旧全局队列没有迁移到新的按需求草稿，旧附件不可见',
      );
      assert.equal(s.s.ui.pendingRefs.length, 1);
    });
    await check(
      'B08',
      '多选文件读取中切换需求仍保持整批归属',
      'dev',
      async () => {
        await page.evaluate(() => {
          const original = File.prototype.text;
          File.prototype.text = function () {
            if (this.name === 'CODEx_TEST_BATCH_FIRST.md')
              return new Promise((resolve) => {
                window.releaseBatch = () => resolve('合成首个文件');
              });
            return original.call(this);
          };
        });
        await act('attach-menu').click();
        const chooser = page.waitForEvent('filechooser');
        await act('attach-files').click();
        await (
          await chooser
        ).setFiles([
          {
            name: 'CODEx_TEST_BATCH_FIRST.md',
            mimeType: 'text/markdown',
            buffer: Buffer.from('one'),
          },
          {
            name: 'CODEx_TEST_BATCH_SECOND.md',
            mimeType: 'text/markdown',
            buffer: Buffer.from('two'),
          },
        ]);
        await page.waitForFunction(() => !!window.releaseBatch);
        await act('close-modal').click();
        await pick('R-1031');
        await page.evaluate(() => window.releaseBatch());
        await page.waitForFunction(() =>
          Object.values(window.PFC.s.ui.pending).some((b) =>
            b.atts.some(
              (a) =>
                a.name === 'CODEx_TEST_BATCH_SECOND.md' && a.status === 'ready',
            ),
          ),
        );
        const bags = (await snap()).s.ui.pending;
        observe(bags);
        assert.ok(
          !bags['R-1031']?.atts.some(
            (a) => a.name === 'CODEx_TEST_BATCH_SECOND.md',
          ),
          '一批多选文件的第二个附件被后续需求接收',
        );
      },
    );
    await check('B09', '读取失败重试必须恢复实际正文', 'dev', async () => {
      await page.evaluate(async () => {
        const file = new File(
          ['合成恢复后的正文'],
          'CODEx_TEST_READ_RETRY.md',
          { type: 'text/markdown' },
        );
        let n = 0;
        file.text = () =>
          ++n === 1
            ? Promise.reject(new Error('CODEx_TEST_TEMP_READ_ERROR'))
            : Promise.resolve('合成恢复后的正文');
        window.retryReadFile = file;
        await window.PFC.enqueueFile(file);
      });
      await act('retry-pending').click();
      await page.clock.runFor(600);
      await page.waitForFunction(
        () => window.PFC.uiBag().atts[0].status !== 'parsing',
      );
      const a = (await snap()).s.ui.pendingAttachments[0];
      observe(a);
      assert.equal(
        a.content,
        '合成恢复后的正文',
        '重试只改ready，没有重读原件或恢复正文',
      );
    });
    await check(
      'B10',
      '新增观测保留多条历史与后续事项',
      'observe',
      async () => {
        await pick('R-1018');
        for (const n of [1, 2]) {
          await act('observe-form').click();
          await fill('metrics', 'CODEx_TEST_METRIC_' + n + ' 来源：合成');
          await fill('followups', 'CODEx_TEST_FOLLOWUP | 陈立 | 进行中');
          await act('save-observation').click();
          await page.clock.runFor(1000);
        }
        const o = (await snap()).s.reqs['R-1018'].observation;
        observe(o);
        assert.equal(o.entries.length, 2);
        assert.match(o.entries[0].metrics, /METRIC_1/);
        assert.equal(o.followups[0].status, '进行中');
        await page.reload();
        assert.equal(
          (await snap()).s.reqs['R-1018'].observation.entries.length,
          2,
        );
      },
    );
    await check('B11', '新增Unit负责人分配保存并回显', 'req', async () => {
      await act('space-tab', '[data-tab="trace"]').click();
      await act('unit-owner').click();
      await page.locator('[name="uo0"]').selectOption('体验成员');
      await page.locator('[name="us0"]').selectOption('进行中');
      await act('save-units').click();
      await page.reload();
      const unit = (await snap()).s.reqs['R-1042'].units[0];
      observe(unit);
      assert.equal(unit.owner, '体验成员');
      assert.equal(unit.status, '进行中');
      assert.match(
        await page.locator('.data-table tbody tr').first().innerText(),
        /体验成员/,
      );
    });

    await check(
      'C01',
      '部分采纳只修改勾选字段并持久化决定',
      'idea',
      async () => {
        await page.evaluate(() => {
          const P = window.PFC,
            v = P.latest(P.r(), 'idea');
          v.fields[0].value = 'CODEx_TEST_OLD 一';
          v.fields[1].value = 'CODEx_TEST_OLD 二';
          P.save();
          P.render();
        });
        await send('把CODEx_TEST_OLD改为CODEx_TEST_NEW');
        await page.clock.runFor(1600);
        await act('diff-full').click();
        await page.locator('[name="diff-field"]').nth(1).uncheck();
        await act('accept-selected-diff').click();
        await page.reload();
        const q = (await snap()).s.reqs['R-1042'],
          v = q.artifacts.idea.at(-1);
        assert.match(v.fields[0].value, /CODEx_TEST_NEW/);
        assert.match(v.fields[1].value, /CODEx_TEST_OLD/);
        assert.deepEqual(
          q.messages.find((m) => m.diff).diffDecisions.map((d) => d.accepted),
          [true, false],
        );
      },
    );
    await check(
      'C02',
      '显式编辑AC关联刷新后回显且按ID查询测试',
      'req',
      async () => {
        await act('space-tab', '[data-tab="trace"]').click();
        await act('trace-links').click();
        await page
          .locator('input[data-unit="R-1042-U01"][value="AC-01"]')
          .uncheck();
        await page
          .locator('input[data-unit="R-1042-U01"][value="AC-02"]')
          .check();
        await act('save-trace-links').click();
        await page.reload();
        const q = (await snap()).s.reqs['R-1042'];
        assert.deepEqual(q.units[0].acIds, ['AC-02']);
        assert.match(
          await page.locator('.data-table tbody tr').first().innerText(),
          /AC-02/,
        );
      },
    );
    await check(
      'C03',
      '中断读取后重新关联原件发送仍使用同一完整资产',
      'dev',
      async () => {
        await page.evaluate(() => {
          const f = new File(
            ['CODEx_TEST_RECOVER_BODY'],
            'CODEx_TEST_RECOVER.md',
            { type: 'text/markdown' },
          );
          f.text = () => new Promise(() => {});
          window.PFC.enqueueFile(f);
        });
        await page.reload();
        assert.equal((await snap()).s.ui.pendingAttachments[0].status, 'error');
        await act('open-attachment').click();
        const chooser = page.waitForEvent('filechooser');
        await act('replace-attachment').click();
        await (
          await chooser
        ).setFiles({
          name: 'CODEx_TEST_RECOVER.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('CODEx_TEST_RECOVER_BODY'),
        });
        await page.locator('.guide-dialog').waitFor({ state: 'hidden' });
        await act('send').click();
        await page
          .locator('.msg-atts button[data-action="open-attachment"]')
          .click();
        assert.match(
          await page.locator('.guide-dialog').innerText(),
          /CODEx_TEST_RECOVER_BODY/,
        );
        const file = await download(act('download-attachment-text'));
        assert.equal(file.body, 'CODEx_TEST_RECOVER_BODY');
      },
    );
    await check(
      'C04',
      '重试回合关系幂等及只读状态二次校验',
      'dev',
      async () => {
        await page.evaluate(() => {
          const P = window.PFC;
          P.r().messages.push({
            id: 'CODEx_TEST_RETRY',
            role: 'user',
            text: '合成重试',
            stage: 'dev',
            status: 'failed',
            attachments: [],
            refs: [],
          });
          P.save();
          P.render();
        });
        await act('resend-message').click();
        await page.clock.runFor(1200);
        let q = (await snap()).s.reqs['R-1042'];
        const user = q.messages.find(
            (m) => m.parentMessageId === 'CODEx_TEST_RETRY',
          ),
          reply = q.messages.find((m) => m.role === 'ai');
        assert.ok(user);
        assert.equal(reply.turnId, user.turnId);
        assert.equal(reply.replyTo, user.id);
        const count = q.messages.length;
        await act('resend-message').click();
        assert.equal((await snap()).s.reqs['R-1042'].messages.length, count);
        await scenario('viewer');
        await page.evaluate(() => {
          try {
            window.PFC.actions['reply-message']({ id: 'CODEx_TEST_RETRY' });
          } catch (e) {
            window.denied = e.message;
          }
        });
        assert.match(await page.evaluate(() => window.denied), /只读/);
        assert.equal((await snap()).s.ui.pending['R-1042'].reply, null);
      },
    );
    await check(
      'C05',
      '建议刷新后仍校验当前版本拒绝过期执行',
      'dev',
      async () => {
        await send('请查看开发代码范围');
        await page.clock.runFor(1600);
        await page.evaluate(() => {
          const P = window.PFC;
          P.newVersion(P.r(), 'dev', P.latest(P.r(), 'dev').fields);
          P.save();
        });
        await page.reload();
        await page.locator('[data-proposal]').click();
        assert.equal(await page.locator('.guide-dialog').count(), 0);
        assert.match(await page.locator('#toast-root').innerText(), /过期/);
      },
    );
    await check('C06', '批次容量边界不产生部分上传', 'dev', async () => {
      await page.evaluate(async () => {
        const P = window.PFC;
        try {
          await P.enqueueFiles(
            Array.from(
              { length: 21 },
              (_, n) => new File(['x'], 'CODEx_TEST_LIMIT_' + n + '.md'),
            ),
            P.r().id,
          );
        } catch (e) {
          window.limitError = e.message;
        }
      });
      assert.equal((await snap()).s.ui.pendingAttachments.length, 0);
      assert.match(await page.evaluate(() => window.limitError), /20/);
    });

    await check(
      'C07',
      '刷新中断答复后可从原消息重试新回合',
      'dev',
      async () => {
        await send('CODEx_TEST_INTERRUPT_REPLY');
        await page.reload();
        let q = (await snap()).s.reqs['R-1042'];
        assert.equal(q.messages.find((m) => m.role === 'ai').typing, false);
        assert.equal(
          q.messages.find((m) => m.role === 'user').status,
          'stopped',
        );
        await act('resend-message').click();
        await page.clock.runFor(1600);
        q = (await snap()).s.reqs['R-1042'];
        assert.equal(q.messages.filter((m) => m.role === 'ai').length, 2);
        assert.equal(q.messages.at(-1).typing, false);
      },
    );
    await check(
      'C08',
      '原件恢复拒绝同名同大小但内容不同的文件',
      'dev',
      async () => {
        await upload('CODEx_TEST_IDENTITY.md', 'CODEx_TEST_ORIGINAL');
        await page.reload();
        await act('open-attachment').click();
        const chooser = page.waitForEvent('filechooser');
        await act('replace-attachment').click();
        await (
          await chooser
        ).setFiles({
          name: 'CODEx_TEST_IDENTITY.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('CODEx_TEST_MODIFIED'),
        });
        await page.waitForFunction(() =>
          document
            .querySelector('#toast-root')
            .textContent.includes('内容与原件不同'),
        );
        const file = await download(act('download-attachment-text'));
        assert.equal(file.body, 'CODEx_TEST_ORIGINAL');
      },
    );
    await check(
      'C09',
      '冻结交付包在当前记录变化和刷新后逐字节一致',
      'release',
      async () => {
        await page.evaluate(() => {
          const P = window.PFC,
            q = P.makeRequirement(
              'CODEx_TEST_FROZEN',
              '合成冻结包',
              '合成目标',
              'release',
            );
          P.s.reqs[q.id] = q;
          P.go({ route: 'work', req: q.id, stage: 'release' });
          P.requestRelease(q, {
            scope: '合成范围',
            rollback: '合成回滚',
            hours: 24,
            target: '本地演示环境',
          });
          P.releaseAction(q, 'approve');
          P.save();
          P.actions['release-snapshot']({ id: q.release.id });
        });
        const first = await download(act('deliver-package'));
        await act('close-modal').click();
        await page.evaluate(() => {
          const P = window.PFC,
            q = P.r();
          P.latest(q, 'req').fields[0].value = 'CODEx_TEST_CHANGED';
          q.tests[0].actual = 'CODEx_TEST_CHANGED_TEST';
          q.accept.note = 'CODEx_TEST_CHANGED_ACCEPT';
          q.units.reverse();
          P.save();
        });
        await page.reload();
        await page.evaluate(() => {
          const P = window.PFC;
          P.actions['release-snapshot']({ id: P.r().release.id });
        });
        const second = await download(act('deliver-package'));
        assert.equal(second.body, first.body);
      },
    );

    await check(
      'C10',
      '不存在的差异消息禁止回退采纳另一条建议',
      'idea',
      async () => {
        await send('把30天改为45天');
        await page.clock.runFor(1600);
        const before = (await snap()).s.reqs['R-1042'].artifacts.idea.length;
        await page.evaluate(() => {
          try {
            window.PFC.actions['accept-diff']({ mid: 'CODEx_TEST_MISSING' });
          } catch (e) {
            window.diffError = e.message;
          }
        });
        assert.match(await page.evaluate(() => window.diffError), /没有待处理/);
        assert.equal(
          (await snap()).s.reqs['R-1042'].artifacts.idea.length,
          before,
        );
      },
    );
    await check(
      'C11',
      '新增作业使旧对话建议失效即使未显式选中作业',
      'dev',
      async () => {
        await send('请查看开发代码范围');
        await page.clock.runFor(1600);
        await page.evaluate(() => {
          const P = window.PFC,
            q = P.r();
          q.runs.push({ ...P.clone(q.runs.at(-1)), id: 'CODEx_TEST_NEW_RUN' });
          P.save();
          P.render();
        });
        await page.locator('[data-proposal]').click();
        assert.equal(await page.locator('.guide-dialog').count(), 0);
        assert.match(await page.locator('#toast-root').innerText(), /过期/);
      },
    );
  } finally {
    await browser.close();
    const report = {
      review: 'production-grade prototype audit',
      source: root,
      results,
      passed: results.filter((x) => x.status === 'PASS').length,
      failed: results.filter((x) => x.status === 'FAIL').length,
      evidence,
      environment:
        'Windows/project Node/isolated Edge/file-only/page HTTP(S) blocked',
      data: 'CODEx_TEST_PROD_REVIEW; synthetic fixtures; contexts closed; no external writes',
    };
    await writeFile(
      join(
        evidence,
        process.argv[2]
          ? 'audit-followup-' + process.argv[2].replaceAll(',', '-') + '.json'
          : 'audit-results.json',
      ),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        passed: report.passed,
        failed: report.failed,
        evidence,
      }),
    );
    process.exitCode = report.failed ? 1 : 0;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
