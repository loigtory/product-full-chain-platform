/* scope7 断言：多 CAP 编排 / 合成解析范围引用 / 跨阶段会话 / 控制租约 / 容量预算 / 角色撤销。
 * 入口 index.html（file://），浏览器隔离，无外网调用。
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url)),
  url = pathToFileURL(join(root, 'index.html')).href;
const evidence = await mkdtemp(join(tmpdir(), 'pfc-scope7-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const results = [],
  errors = [];
let failed = false;
await context.route(/^https?:/, (route) => route.abort());
const page = await context.newPage();
page.setDefaultTimeout(5000);
page.setDefaultNavigationTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.clock.install({ time: new Date('2026-09-10T23:59:00Z') });
await page.clock.pauseAt(new Date('2026-09-11T00:00:00Z'));
const act = (name, extra = '') =>
  page.locator(`button[data-action="${name}"]${extra}`).first();
const fill = (name, value) => page.locator(`[name="${name}"]`).fill(value);
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem(window.PFC.KEY)));
async function fresh(route = 'work') {
  try {
    await page.goto(url + '#/' + route, { timeout: 20000 });
  } catch {
    /* 首用例冷启动偶发超时：重试一次 */
    await page.goto(url + '#/' + route, { timeout: 20000 });
  }
  await page.evaluate(() => localStorage.removeItem(window.PFC.KEY));
  await page.reload();
  await page.locator('#global-header .brand').waitFor();
}
async function scenario(name) {
  await act('scenarios').click();
  await act('scenario', `[data-scenario="${name}"]`).click();
}
async function shot(name) {
  await page.screenshot({ path: join(evidence, name + '.png') });
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
    console.log(JSON.stringify({ case: name, status: 'FAIL', error: error.message }));
    results.push({ name, status: 'FAIL', error: error.stack?.slice(0, 1700) || error.message });
    await shot('failure-' + name).catch(() => {});
  }
}
try {
  await check('01-multi-cap-orchestration', async () => {
    await fresh();
    const q = (await state()).reqs['R-1042'];
    assert.equal(q.caps.length, 2, 'R-1042 应拆两个 CAP');
    assert.deepEqual(q.caps[0].unitIds, ['R-1042-U01']);
    assert.deepEqual(q.caps[1].unitIds, ['R-1042-U02']);
    /* 初始 units 为待开始 → 聚合 0/2 */
    const s = await page.evaluate(() => window.PFC.capStatus(window.PFC.s.reqs['R-1042']));
    assert.equal(s.total, 2);
    assert.equal(s.done, 0, '待开始不应计入完成');
    assert.equal(s.blocked.length, 2);
    /* 全部已实现 → 聚合 2/2；单个回退 → 1/2 */
    const s2 = await page.evaluate(() => {
      const q2 = window.PFC.s.reqs['R-1042'];
      q2.units.forEach((u) => (u.status = '已实现'));
      window.PFC.save();
      const r1 = window.PFC.capStatus(q2);
      q2.units[0].status = '待开始';
      window.PFC.save();
      const r2 = window.PFC.capStatus(q2);
      return { r1, r2 };
    });
    assert.equal(s2.r1.done, 2);
    assert.deepEqual(s2.r1.blocked, []);
    assert.equal(s2.r2.done, 1);
    assert.deepEqual(s2.r2.blocked, ['规则与数据处理']);
    /* 阶段卡渲染 CAP 分组与聚合条 */
    await act('view-stage', '[data-stage="req"]').click();
    assert.equal(await page.locator('.cap-block').count(), 2);
    assert.ok((await page.locator('#stream').innerText()).includes('聚合 · 1/2 CAP 完成'));
    await shot('cap-orchestration');
  });
  await check('02-binary-structure-and-scope-reference', async () => {
    await fresh();
    const syn = await page.evaluate(() => ({
      pdf: window.PFC.syntheticStructure('pdf', 100),
      word: window.PFC.syntheticStructure('word', 42),
      sheet: window.PFC.syntheticStructure('sheet', 7),
    }));
    assert.ok(syn.pdf.pages.length >= 4 && syn.pdf.pages.length <= 10);
    assert.ok(syn.word.paragraphs.length >= 6 && syn.word.paragraphs.length <= 16);
    assert.ok(syn.sheet.sheets.length >= 2 && syn.sheet.sheets.length <= 5);
    /* 确定性：同 seed 同结构 */
    const syn2 = await page.evaluate(() => window.PFC.syntheticStructure('pdf', 100));
    assert.equal(JSON.stringify(syn.pdf), JSON.stringify(syn2));
    /* 上传二进制附件 → 预览出结构化列表 → 按范围加入引用 */
    await page.evaluate(async () => {
      const q = window.PFC.s.reqs['R-1042'];
      const f = new File([new Uint8Array(2048)], '规则说明.pdf', {
        type: 'application/pdf',
      });
      await window.PFC.enqueueFiles([f], q.id);
    });
    await act('open-attachment').click();
    assert.match(await page.locator('.guide-dialog').innerText(), /合成样例/);
    const rowN = await page.locator('.syn-row').count();
    assert.ok(rowN >= 4, 'PDF 结构行应 ≥ 4');
    await act('ref-scope').click();
    /* ref-scope 执行后自行关闭弹窗 */
    await page.locator('.guide-dialog').waitFor({ state: 'hidden' });
    const bagRefs = await page.evaluate(() => window.PFC.uiBag().refs);
    assert.equal(bagRefs.at(-1).kind, 'attachment');
    assert.match(bagRefs.at(-1).scope, /第1页/);
    await shot('binary-scope-ref');
  });
  await check('03-cross-stage-session-and-long-collapse', async () => {
    await fresh();
    /* 构造多阶段消息：5 阶段 × 10 条 */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      q.messages = [];
      let n = 0;
      for (const st of ['idea', 'req', 'design', 'dev', 'test'])
        for (let i = 0; i < 10; i++)
          q.messages.push({
            id: 'S7-' + st + '-' + i,
            role: 'ai',
            stage: st,
            text: '消息 ' + (++n) + ' · ' + st,
            status: 'ok',
            at: Date.now() + n,
          });
      window.PFC.save();
    });
    /* 默认仅当前阶段 */
    assert.equal(await page.locator('.msg-filter').count(), 1);
    await act('toggle-stage-all', '[data-all="1"]').click();
    assert.equal((await state()).ui.stageAll, true);
    const groups = await page.locator('.stage-group').count();
    assert.ok(groups >= 2, '全部阶段应出现多阶段分组');
    await shot('stage-all-view');
    /* 折叠：50 条 > 40 → 展开按钮；点击后全量展示 */
    const hasExpand = await act('expand-early-msgs').count();
    assert.equal(hasExpand, 1, '超 40 条应有展开按钮');
    await act('expand-early-msgs').click();
    assert.equal((await state()).ui.expandAll, true);
    assert.equal(await act('expand-early-msgs').count(), 0);
  });
  await check('04-control-lease-and-bridge-revoke', async () => {
    await fresh();
    /* 工厂 run 置已完成态以出现「发起新作业」，新建作业才产生租约绑定 */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      const run = q.runs.at(-1);
      run.status = 'SUCCEEDED';
      run.step = 6;
      run.pct = 100;
      window.PFC.save();
      window.PFC.render();
    });
    await act('plan-run').click();
    await act('start-run').click();
    const run = (await state()).reqs['R-1042'].runs.at(-1);
    assert.equal(run.lease.deviceId, 'BR-01');
    assert.equal(run.lease.state, 'active');
    assert.ok((await page.locator('#stream').innerText()).includes('本地开发电脑'));
    /* 断连 → UNKNOWN + 租约失效（同一会话内切路由，不清存储） */
    await act('navigate', '[data-route="gov"]').click();
    await act('gov-tab', '[data-tab="workspace"]').click();
    await act('bridge-toggle', '[data-id="BR-01"]').click();
    await page.clock.runFor(1500);
    const q = (await state()).reqs['R-1042'];
    assert.equal(q.runs.at(-1).status, 'UNKNOWN');
    assert.equal(q.runs.at(-1).lease.state, 'lost');
    await shot('lease-lost');
  });
  await check('05-capacity-and-budget', async () => {
    await fresh();
    /* 附件容量条文案 */
    await page.evaluate(async () => {
      const q = window.PFC.s.reqs['R-1042'];
      const f = new File([new Uint8Array(2 * 1024 * 1024)], '样例.txt', {
        type: 'text/plain',
      });
      await window.PFC.enqueueFiles([f], q.id);
    });
    assert.match(await page.locator('.att-cap').innerText(), /1\/20 件/);
    /* 预算：工厂 RUNNING run 置低预算 → 两步内耗尽 FAILED */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      const run = q.runs.at(-1);
      run.status = 'RUNNING';
      run.pct = 0;
      run.budget = 800;
      run.spent = 0;
      window.PFC.save();
    });
    for (let i = 0; i < 3; i++) await page.clock.runFor(1800);
    const run = (await state()).reqs['R-1042'].runs.at(-1);
    assert.equal(run.status, 'FAILED');
    assert.ok(run.spent >= 800);
    assert.ok((await page.locator('#stream').innerText()).includes('预算'), '预算耗尽提示应出现');
    await shot('budget-exhausted');
  });
  await check('06-role-revocation-reassign-hint', async () => {
    await fresh('gov');
    /* 先在当前会话内把 R-1042 U01 派给新成员（不切路由，避免清存储） */
    await page.evaluate(() => {
      window.PFC.s.reqs['R-1042'].units[0].owner = 'CODEx_SCOPE7 执行员';
      window.PFC.save();
    });
    await act('gov-tab', '[data-tab="team"]').click();
    await act('add-member').click();
    await fill('name', 'CODEx_SCOPE7 执行员');
    await page.locator('[name="role"]').selectOption('执行者');
    await act('save-member').click();
    await act('edit-member', '[data-name="CODEx_SCOPE7 执行员"]').click();
    await page.locator('[name="role"]').selectOption('只读');
    await act('save-member-role').click();
    assert.equal(
      (await state()).reqs['R-1042'].units[0].ownerNote,
      '负责人已撤销，待改派',
    );
    await shot('role-revoked');
  });
  await check('07-project-loading', async () => {
    await fresh('product'); // 创建需求入口在产品空间
    /* 工厂项目库 3 条；R-1042 关联 PRJ-01（pfc-notify，兼容段补齐） */
    const st0 = await state();
    assert.equal(st0.projects.length, 3);
    assert.equal(st0.reqs['R-1042'].projectId, 'PRJ-01');
    /* 创建需求表单：项目来源 + 加载按钮 */
    await act('new-requirement').click();
    assert.equal(await page.locator('[name="project-source"]').count(), 1);
    assert.equal(await act('load-project').count(), 1);
    /* 现有系统迭代 → 关联 PRJ-02 */
    await fill('name', '理赔进度查询优化');
    await fill('goal', '用户频繁来电询问理赔进度，希望自助查询');
    await fill('scope', '进度查询页 + 状态推送');
    await fill('owner', '陈立');
    await page.locator('[name="project-source"]').selectOption('existing');
    await page.locator('[name="project-id"]').selectOption('PRJ-02');
    await act('create-requirement').click();
    const created = await page.evaluate(() =>
      Object.values(window.PFC.s.reqs).find((r) => r.name === '理赔进度查询优化'),
    );
    assert.equal(created.projectId, 'PRJ-02');
    assert.equal(created.workspace, 'pfc-claim');
    assert.match(created.materials[0].content, /现有系统迭代/);
    /* rail 项目卡：现有系统迭代徽标 + 切换/加载入口 */
    assert.equal(await act('attach-project').count(), 1);
    assert.ok(
      (await page.locator('.rail-section').nth(1).innerText()).includes(
        '现有系统迭代',
      ),
    );
    /* 加载本地项目：登记入项目库并预选 */
    await act('attach-project').click();
    await act('load-project').click();
    await fill('p-name', 'my-app');
    await fill('p-path', 'D:\\Code\\my-app');
    await fill('p-branch', 'dev');
    await fill('p-tech', 'Go,React');
    await act('save-project').click();
    const st1 = await state();
    assert.equal(st1.projects.length, 4);
    assert.equal(st1.projects.at(-1).name, 'my-app');
    assert.equal(st1.ui.lastProject, 'PRJ-04');
    /* 治理中心工作区 tab：本地项目库表 */
    await act('navigate', '[data-route="gov"]').click();
    await act('gov-tab', '[data-tab="workspace"]').click();
    assert.ok((await page.locator('.guide-page').innerText()).includes('本地项目库'));
    await shot('project-loading');
  });
  await check('08-absorb-plan-gates-replay', async () => {
    await fresh();
    /* 工厂 run 已带计划批准与默认质量门 */
    const st0 = await state();
    const run0 = st0.reqs['R-1042'].runs.at(-1);
    assert.equal(run0.qualityGates.length, 5);
    assert.ok(run0.planApproved?.by, '工厂 run 应有计划批准记录');
    /* 置为已完成态以出现「发起新作业」入口（同 04 用例模式） */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      const run = q.runs.at(-1);
      run.status = 'SUCCEEDED';
      run.step = 6;
      run.pct = 100;
      window.PFC.save();
      window.PFC.render();
    });
    /* 计划审批硬门：弹窗含执行计划 + 拒绝按钮 */
    await act('plan-run').click();
    assert.ok((await page.locator('.guide-dialog').innerText()).includes('计划审批（硬门）'));
    assert.ok((await page.locator('.guide-dialog').innerText()).includes('执行计划'));
    assert.equal(await act('reject-plan').count(), 1);
    /* 拒绝计划：记录原因且不产生新作业 */
    await fill('reject-reason', '范围未包含数据回传，需重新规划');
    await act('reject-plan').click();
    const st1 = await state();
    assert.ok(
      st1.audit.some((a) => a.action.includes('作业计划被拒绝')),
      '拒绝应进审计',
    );
    assert.equal(st1.reqs['R-1042'].runs.length, 1, '拒绝不应产生新作业');
    /* 质量门：执行后全绿（工厂 run id 的 seed 确定性通过） */
    await act('run-quality-gates').click();
    const gates = (await state()).reqs['R-1042'].runs.at(-1).qualityGates;
    assert.equal(gates.length, 5);
    assert.ok(gates.every((g) => g.status === '通过'), '质量门应全绿');
    assert.ok(
      (await page.locator('#toast-root').innerText()).includes('质量门全部通过'),
    );
    /* 验收阻断：质量门失败 → 验收卡提示未全绿 */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      q.runs.at(-1).qualityGates[2].status = '失败';
      window.PFC.save();
      window.PFC.render();
    });
    await act('view-stage', '[data-stage="accept"]').click();
    assert.ok((await page.locator('#stream').innerText()).includes('质量门未全绿'));
    await shot('absorb-gates');
    /* 回放：弹窗含逐行回放与快照 */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      q.runs.at(-1).qualityGates[2].status = '通过';
      window.PFC.save();
      window.PFC.render();
    });
    await act('view-stage', '[data-stage="dev"]').click();
    await act('replay-run').click();
    assert.ok((await page.locator('.guide-dialog').innerText()).includes('执行回放'));
    assert.ok((await page.locator('.replay-line').count()) >= 3);
    await shot('absorb-replay');
  });
  await check('09-absorb-knowledge-protocol', async () => {
    await fresh('product');
    /* 知识库预置 4 条（含 Playbook）；创建"理赔"需求自动检索引用 */
    assert.equal((await state()).knowledge.length, 4);
    await act('new-requirement').click();
    await fill('name', '理赔进度查询优化');
    await fill('goal', '用户频繁来电询问理赔进度，希望自助查询');
    await fill('scope', '进度查询页 + 状态推送');
    await fill('owner', '陈立');
    await act('create-requirement').click();
    const created = await page.evaluate(() =>
      Object.values(window.PFC.s.reqs).find((r) => r.name === '理赔进度查询优化'),
    );
    assert.ok(created.knowledgeRefs?.length >= 1, '应自动检索到知识库条目');
    assert.ok(
      created.materials.some((m) => m.name.includes('知识库引用')),
      '材料应含知识库引用条目',
    );
    assert.ok(
      (await page.locator('.rail-section').nth(1).innerText()).includes('知识库引用'),
    );
    /* 治理中心：知识库 tab + 手动登记 + IAM 卡 + 能力目录协议徽标 */
    await act('navigate', '[data-route="gov"]').click();
    await act('gov-tab', '[data-tab="knowledge"]').click();
    assert.ok((await page.locator('.guide-page').innerText()).includes('组织知识库'));
    await act('add-knowledge').click();
    await fill('k-title', '回滚按钮交互规范');
    await fill('k-content', '发布回滚需二次确认并展示影响范围');
    await page.locator('[name="k-type"]').selectOption('组件规范');
    await act('save-knowledge').click();
    assert.equal((await state()).knowledge.length, 5);
    /* IAM 卡 */
    await act('gov-tab', '[data-tab="team"]').click();
    assert.ok((await page.locator('.guide-page').innerText()).includes('身份与访问'));
    assert.ok((await page.locator('.guide-page').innerText()).includes('企业 SSO'));
    /* 能力目录：协议徽标 + ACP 登记 */
    await act('gov-tab', '[data-tab="catalog"]').click();
    assert.ok((await page.locator('.guide-page').innerText()).includes('开放协议'));
    await act('register-cap').click();
    await fill('name', '内部搜索 Agent');
    await page.locator('[name="type"]').selectOption('ACP');
    await fill('endpoint', 'ws://localhost:4100');
    await fill('src', '内部 / agent 服务');
    await fill('ver', '1.0.0');
    await fill('desc', '内部知识检索 agent（ACP 协议）');
    await act('save-cap').click();
    const st = await state();
    assert.equal(st.caps.at(-1).protocol, 'ACP');
    assert.equal(st.caps.at(-1).endpoint, 'ws://localhost:4100');
    await act('gov-tab', '[data-tab="knowledge"]').click();
    await shot('absorb-knowledge');
  });
  await check('10-absorb-cicd-audit-export', async () => {
    await fresh();
    /* 构造已批准的发布状态，验证 CI/CD 流水线 */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      q.stage = 'release';
      q.release = {
        id: 'REL-9',
        target: '演示环境',
        scope: '提醒规则与结果展示',
        stamp: window.PFC.stamp(q),
        rollback: '关闭功能入口并恢复上个已验证版本',
        hours: 24,
        expiresAt: window.PFC.now() + 86400000,
        status: 'APPROVED',
        snapshot: {
          stamp: window.PFC.stamp(q),
          artifacts: { web: 'notify-web@1.2.0' },
          runId: q.runs.at(-1).id,
          testRunId: 'TR-1',
          acceptId: 'ACCEPT-1',
          target: '演示环境',
        },
      };
      window.PFC.save();
      window.PFC.render();
    });
    await act('view-stage', '[data-stage="release"]').click();
    assert.equal(await act('run-cicd').count(), 1);
    await act('run-cicd').click();
    const rel = (await state()).reqs['R-1042'].release;
    assert.equal(rel.cicd.status, '通过');
    assert.equal(rel.cicd.steps.length, 4);
    assert.ok(rel.cicd.steps.every((s) => s.status === '通过'));
    assert.ok(
      (await page.locator('#stream').innerText()).includes('CI/CD 流水线'),
    );
    await shot('absorb-cicd');
    /* 审计导出：CSV 下载演示 + 审计留痕 */
    await act('navigate', '[data-route="gov"]').click();
    await act('gov-tab', '[data-tab="audit"]').click();
    assert.equal(await act('export-audit').count(), 1);
    await act('export-audit').click();
    assert.ok(
      (await page.locator('#toast-root').innerText()).includes('审计记录已导出'),
    );
    assert.ok(
      (await state()).audit.some((a) => a.action.includes('审计导出')),
      '导出应进审计',
    );
    await shot('absorb-audit-export');
  });
  await check('11-absorb-taskpool-metrics-playbook', async () => {
    await fresh();
    /* 任务池：R-1042 dev run 运行中 → 全局队列快照 */
    assert.ok((await page.locator('#stream').innerText()).includes('并行任务池'));
    assert.ok((await page.locator('#stream').innerText()).includes('运行 1'));
    /* 指标看板：置观察阶段 + 发布成功 */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      q.stage = 'observe';
      q.release = {
        id: 'REL-9',
        target: '演示环境',
        scope: '提醒规则与结果展示',
        stamp: window.PFC.stamp(q),
        rollback: '关闭功能入口',
        hours: 24,
        expiresAt: window.PFC.now() + 86400000,
        status: 'SUCCEEDED',
        snapshot: { stamp: window.PFC.stamp(q), target: '演示环境' },
      };
      q.observation = {
        startedAt: window.PFC.now() - 12 * 3600000,
        hours: 24,
        releaseSnapshot: { stamp: window.PFC.stamp(q) },
        anomaly: null,
        conclusion: '观察正常，指标符合预期',
      };
      window.PFC.save();
      window.PFC.render();
    });
    await act('view-stage', '[data-stage="observe"]').click();
    assert.ok((await page.locator('#stream').innerText()).includes('指标看板'));
    assert.equal(await page.locator('.metric-cell').count(), 4);
    await shot('absorb-metrics');
    /* Playbook：知识库预置 KN-04 + 登记选项含 Playbook */
    assert.ok(
      (await state()).knowledge.some((k) => k.type === 'Playbook'),
      '应预置 Playbook 条目',
    );
    await act('navigate', '[data-route="gov"]').click();
    await act('gov-tab', '[data-tab="knowledge"]').click();
    assert.ok((await page.locator('.guide-page').innerText()).includes('上线检查清单'));
    await act('add-knowledge').click();
    assert.ok(
      (await page.locator('[name="k-type"] option').allTextContents()).includes(
        'Playbook（可复用执行清单）',
      ),
    );
    await shot('absorb-playbook');
  });
  await check('12-absorb-notices-plugins', async () => {
    await fresh();
    /* 通知流：预置 2 条未读 → 铃铛徽标 2 */
    assert.equal((await state()).notices.length, 2);
    assert.equal(await page.locator('.bell-dot').innerText(), '2');
    /* 计划被拒绝 → 自动入通知 */
    await page.evaluate(() => {
      const q = window.PFC.s.reqs['R-1042'];
      const run = q.runs.at(-1);
      run.status = 'SUCCEEDED';
      run.step = 6;
      run.pct = 100;
      window.PFC.save();
      window.PFC.render();
    });
    await act('plan-run').click();
    await fill('reject-reason', '缺少数据回传，需重新规划');
    await act('reject-plan').click();
    const st1 = await state();
    assert.ok(
      st1.notices.some((n) => n.title.includes('作业计划被拒绝')),
      '拒绝计划应入通知流',
    );
    assert.equal(await page.locator('.bell-dot').innerText(), '3');
    /* 通知中心：列表 + 全部标记已读 */
    await act('notifications').click();
    assert.ok((await page.locator('.guide-dialog').innerText()).includes('通知中心'));
    assert.equal(await page.locator('.notice-item').count(), 3);
    assert.equal(await act('mark-all-notices').count(), 1);
    await act('mark-all-notices').click();
    assert.ok((await state()).notices.every((n) => n.read));
    await act('close-modal').click();
    assert.equal(await page.locator('.bell-dot').count(), 0);
    await shot('absorb-notices');
    /* 生态插件：插件市场 4 项 + 安装即登记待复核 + 通知 */
    await act('navigate', '[data-route="gov"]').click();
    await act('gov-tab', '[data-tab="plugins"]').click();
    assert.ok((await page.locator('.guide-page').innerText()).includes('生态插件市场'));
    assert.equal(await page.locator('[data-action="install-plugin"]').count(), 4);
    await act('install-plugin', '[data-id="PLG-01"]').click();
    const st2 = await state();
    const cap = st2.caps.at(-1);
    assert.equal(cap.name, 'GitHub Actions 集成');
    assert.equal(cap.protocol, 'MCP');
    assert.equal(cap.pending, true);
    assert.ok(
      st2.notices.some((n) => n.title.includes('插件已安装待复核')),
      '插件安装应入通知流',
    );
    assert.ok((await page.locator('.guide-page').innerText()).includes('待复核'));
    await shot('absorb-plugins');
  });
} finally {
  await browser.close();
  const report = {
    status: failed || errors.length ? 'FAIL' : 'PASS',
    results,
    errors,
    evidence,
    environment: 'Windows / project Node / isolated Edge / blocked page HTTP(S)',
    data: 'deterministic local prototype factory; isolated context destroyed',
  };
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
process.exitCode = failed || errors.length ? 1 : 0;
