'use strict';
// 常驻验收服务（5188）浏览器端到端真实执行（消耗 1 次模型预算）：
// 面板（真实浏览器渲染）→ dev 阶段 exec-bar 填真实项目路径 → composer 发送（execWs 非空自动
// mode:'real' + tool:'exec'）→ 服务端 EXECUTE → codex 真实修复 sum.js → 对话流回写面板 → 断言
// 面板可见 codex 输出 + 合成项目修复 + node --test 通过 + 平台仓库零污染 + 截图留证。
// 这是 44 号"前端→服务端→真实工具执行→结果回写→产品负责人验收"愿景的最后一块浏览器级验证。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '浏览器端到端真实执行：面板输入路径→发送→codex 真实修码→对话流回写→测试通过→平台零污染（1 次模型）',
  tests: [],
  errors: [],
  external: [],
};
const outputDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(outputDir, '..', '..');
const base = 'http://127.0.0.1:5188';
const evidenceDir = resolve(projectRoot, '.local/ai-tools-live-browser-20260915');
const workspace = resolve(projectRoot, '.local/ai-tools-live-smoke-20260915/proj');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 自愈：确保合成项目处于 bug 态（sum.js=乘法 + git commit），幂等，不依赖前序状态
(function ensureBugState() {
  // 先丢弃工作树未提交改动（合成项目可丢弃；codex 上次执行可能留未提交修复/package.json）
  execSync('git checkout -- . && git clean -fd', { cwd: workspace, stdio: 'pipe' });
  const sumFile = resolve(workspace, 'sum.js');
  const cur = readFileSync(sumFile, 'utf8');
  if (!cur.includes('*')) {
    writeFileSync(sumFile, 'module.exports = (a, b) => a * b;\n', 'utf8');
    execSync('git add -A && git -c user.name=owner -c user.email=owner@local commit -q -m "reintroduce bug"', {
      cwd: workspace,
      stdio: 'pipe',
    });
  }
  try {
    execSync('node --test', { cwd: workspace, stdio: 'pipe' });
    throw new Error('合成项目预测试应失败（bug 态未建立）');
  } catch (e) {
    if (String(e.message).includes('预测试应失败')) throw e; // 测试通过了 → bug 态未建立
    // 否则 node --test 非零退出 → 符合预期，静默继续
  }
})();
try {
  mkdirSync(evidenceDir, { recursive: true });
  // 1. dev-login + agent status
  const login = await fetch(base + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  assert.equal(login.status, 200, 'dev-login 200');
  const { token, user } = await login.json();
  report.tests.push({ name: 'dev-login(owner) 200', status: 'PASS' });
  const auth = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const st = await (await fetch(base + '/api/agent/status', { headers: auth })).json();
  assert.equal(st.execCapable, true, 'execCapable');
  report.tests.push({ name: 'agent/status: execCapable=true, budget=' + JSON.stringify(st.budget), status: 'PASS' });

  // 2. 创建真实 req
  const created = await fetch(base + '/api/reqs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      name: '浏览器端到端真实执行（I 阶段）',
      goal: '面板输入路径→发送→codex 真实修码→对话流回写→验收',
      scope: '浏览器真实操作 + 1 次模型',
    }),
  });
  assert.equal(created.status, 201, 'req created');
  const req = (await created.json()).req;
  const reqId = req.public_id || req.id;
  report.tests.push({ name: 'req 创建 ' + reqId, status: 'PASS' });

  // 3. 打开面板 → dev 阶段
  const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 30000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      report.external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(
    ({ base, name }) => {
      window.PFC_DATA_MODE = 'api';
      window.PFC_API_BASE = base;
      window.PFC_USER_NAME = name;
    },
    { base, name: user.name },
  );
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(pathToFileURL(resolve(outputDir, 'index.html')).href);
  await page.waitForFunction(() => window.PFCAPI?.api.ready || window.PFC?.remoteError);
  assert.equal(await page.evaluate(() => window.PFC.remoteError), null);
  report.tests.push({ name: '面板加载无 remoteError', status: 'PASS' });

  await page.evaluate(({ id }) => window.PFC.go({ route: 'work', req: id, stage: 'dev' }), { id: reqId });
  await page.waitForFunction(() => window.PFC?.s?.env?.execCapable === true, null, { timeout: 15000 });
  const wsInput = page.locator('#exec-workspace');
  await wsInput.waitFor({ state: 'visible', timeout: 15000 });
  report.tests.push({ name: 'dev 阶段 exec-bar 渲染', status: 'PASS' });

  // 4. 填真实路径 + prompt → 点发送
  await wsInput.fill(workspace);
  await page.waitForFunction((w) => window.PFC?.s?.ui?.execWorkspace === w, workspace, { timeout: 5000 });
  await page.locator('#chat-input').fill(
    'CODEx_TEST_LIVE_BROWSER_20260915。工作区 sum.js 的 add 逻辑有 bug（乘法代替了加法）。请修复 sum.js 使 `node --test` 全部通过。完成后用一行说明修改内容。',
  );
  report.tests.push({ name: '填写项目路径 + 提示词', status: 'PASS' });
  // stage 对齐：面板 UI 切 dev 仅为渲染 exec-bar；新 req 服务端阶段为 idea（阶段门禁阻止
  // 直达 dev），发送若带 stage:'dev' 会 INVALID_STAGE 400。exec 触发由 tool:'exec' 决定，
  // 不依赖 stage——发送前将 UI stage 对齐 req 当前阶段，模拟"真实用户逐阶段推进后发送"。
  await page.evaluate(({ s }) => { window.PFC.s.ui.stage = s; }, { s: req.stage || 'idea' });
  await page.locator('.send-btn').click();
  report.tests.push({ name: '点击发送（execWs 非空 → mode:real + tool:exec）', status: 'PASS' });

  // 5. 等待 ai 消息终态（轮询 API，最多 480s——codex 冷启动+worker 排队可能超 240s）
  let ai = null;
  const deadline = Date.now() + 480000;
  while (Date.now() < deadline) {
    const list = await (await fetch(base + '/api/reqs/' + reqId + '/messages?limit=20', { headers: auth })).json();
    const items = list.items || list.messages || [];
    const cand = items.find((m) => m.role === 'ai' && m.status && m.status !== 'generating');
    if (cand) {
      ai = cand;
      break;
    }
    await sleep(5000);
  }
  assert.ok(ai, 'ai 消息 240s 内终态');
  assert.equal(ai.status, 'ok', 'ai 消息 status ok，实际 ' + ai.status);
  report.tests.push({ name: 'ai 消息终态 ok（codex 真实回写）', status: 'PASS' });
  report.ai = { id: ai.id, status: ai.status, content: (ai.content || '').slice(0, 300) };

  // 6. 面板消息区渲染 codex 输出（等待 WS 回写渲染到 DOM）
  await page.waitForFunction(
    (kw) => (document.querySelector('#stream')?.innerText || '').includes(kw),
    'sum.js',
    { timeout: 30000 },
  );
  const streamText = await page.locator('#stream').innerText();
  const rendered = streamText.includes('sum.js') && (streamText.includes('node --test') || streamText.includes('通过'));
  assert.equal(rendered, true, '面板对话流可见 codex 输出');
  report.tests.push({ name: '面板 #stream 渲染 codex 输出（sum.js/测试通过）', status: 'PASS' });

  // 7. 合成项目修复验证
  const sumSrc = readFileSync(resolve(workspace, 'sum.js'), 'utf8');
  assert.equal(sumSrc.includes('+'), true, 'sum.js 已修复');
  report.tests.push({ name: 'sum.js 已修复（加法）', status: 'PASS' });
  try {
    execSync('node --test', { cwd: workspace, stdio: 'pipe' });
    report.tests.push({ name: 'node --test 通过', status: 'PASS' });
  } catch {
    report.tests.push({ name: 'node --test 通过', status: 'FAIL' });
    throw new Error('测试未通过');
  }

  // 8. 平台仓库零污染：codex 不得改动受管核心目录（server/apps/packages），
  // 验收自身产生的未提交文件（本闸 + 证据 JSON）属预期，不算污染。
  const dirty = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' }).toString();
  const polluted = dirty
    .split(/\r?\n/)
    .filter(Boolean)
    .some((l) => /^\s*[MADRCU?]{1,2}\s+(server|apps|packages)\//.test(l));
  report.tests.push({ name: '平台仓库零污染（server/apps/packages 无改动）', status: polluted ? 'FAIL' : 'PASS' });

  // 9. 截图（执行后面板）
  const shot = resolve(evidenceDir, 'panel-live-exec-browser-1440.png');
  await page.screenshot({ path: shot });
  report.tests.push({ name: '截图 panel-live-exec-browser-1440.png', status: 'PASS' });

  await browser.close();
  report.status = report.tests.some((t) => t.status === 'FAIL') ? 'FAIL' : 'PASS';
} catch (e) {
  report.errors.push(e.message);
  report.status = 'FAIL';
}
const file = resolve(projectRoot, 'docs/quality-gate/reports/ai-tools-integration-20260914/live-exec-browser-' + Date.now() + '.json');
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, tests: report.tests.length, file, errors: report.errors, external: report.external.length }));
