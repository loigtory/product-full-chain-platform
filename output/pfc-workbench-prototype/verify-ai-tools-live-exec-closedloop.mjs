import { summarize } from '../../server/test-support/gate-result.mjs';
('use strict');
// 常驻验收服务（5188）真实执行闭环（消耗 1 次模型预算）：
// HTTP 消息接口 → EXECUTE 作业 → worker.runExecJob（codex 真实执行）→ 流式回写 ai 消息。
// 合成项目（独立目录，git 仓库）：sum.js 故意 bug → codex 修复 → node --test 通过 → 平台仓库零污染。
import { writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
{
  console.log(
    JSON.stringify({
      status: 'BLOCKED',
      code: 'LEGACY_TEST_TARGET_NOT_AUTHORIZED',
      next: 'verify-ai-tools-remediation-*',
    }),
  );
  process.exit(2);
}
const root = 'D:/项目管理/product-full-chain-platform';
const base = 'http://127.0.0.1:5188';
const workspace = resolve(root, '.local/ai-tools-live-smoke-20260915/proj');
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    '常驻服务真实执行闭环：5188 HTTP 消息→EXECUTE→codex 修复 sum.js→测试通过→平台仓库零污染（1 次模型）',
  tests: [],
  errors: [],
  platformRepoCleanAfter: null,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  // 登录
  const login = await fetch(base + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  const { token } = await login.json();
  const auth = {
    Authorization: 'Bearer ' + token,
    'content-type': 'application/json',
  };

  // 建真实需求
  const created = await fetch(base + '/api/reqs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      name: '常驻服务真实执行闭环',
      goal: '验证 5188 常驻服务上消息→EXECUTE→codex 真实修码→回写全链',
      scope: 'HTTP 全链，1 次模型预算',
    }),
  });
  const req = (await created.json()).req;
  report.reqId = req.id;
  report.tests.push({ name: 'req 创建 ' + req.id, status: 'PASS' });
  const expectedRevision = req.revision;

  // 发送 exec 消息（tool:exec + workspace + control）
  const prompt =
    'CODEx_TEST_LIVE_20260915。工作区 sum.js 的 add 逻辑有 bug（乘法代替了加法）。请修复 sum.js 使 `node --test` 全部通过。完成后用一行说明修改内容。';
  const sent = await fetch(base + '/api/reqs/' + req.id + '/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      content: prompt,
      mode: 'real',
      tool: 'exec',
      workspace,
      restrictedReadDirs: [],
      expectedRevision,
      control: {
        mode: 'strict',
        allowedFiles: ['workspace/**'],
        allowedCommands: [],
        maxFiles: 50,
        maxBytes: 2097152,
        approvedBy: 'owner',
      },
    }),
  });
  const sentBody = await sent.json();
  if (sent.status !== 201)
    throw new Error(
      '发送消息 ' + sent.status + ': ' + JSON.stringify(sentBody).slice(0, 300),
    );
  report.tests.push({
    name: 'exec 消息发送 201（EXECUTE 作业入队）',
    status: 'PASS',
  });

  // 轮询 ai 消息状态（最多 240s）
  let ai = null;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const list = await (
      await fetch(base + '/api/reqs/' + req.id + '/messages?limit=20', {
        headers: auth,
      })
    ).json();
    const items = list.items || list.messages || [];
    const cand = items.find(
      (m) => m.role === 'ai' && m.status && m.status !== 'generating',
    );
    if (cand && cand.status && cand.status !== 'generating') {
      ai = cand;
      break;
    }
    await sleep(5000);
  }
  if (!ai) throw new Error('240s 内 ai 消息未终态');
  report.aiMessage = { id: ai.id, status: ai.status };
  report.tests.push({ name: 'ai 消息终态: ' + ai.status, status: 'PASS' });
  if (ai.status !== 'ok' && ai.status !== 'SUCCEEDED')
    throw new Error('作业未成功: ' + ai.status);

  // 验证合成项目修复
  const sumSrc = readFileSync(resolve(workspace, 'sum.js'), 'utf8');
  const fixed = sumSrc.includes('+');
  report.tests.push({
    name: 'sum.js 已修复（加法）',
    status: fixed ? 'PASS' : 'FAIL',
  });
  try {
    execSync('node --test', { cwd: workspace, stdio: 'pipe' });
    report.tests.push({ name: 'node --test 通过', status: 'PASS' });
  } catch {
    report.tests.push({ name: 'node --test 通过', status: 'FAIL' });
    throw new Error('测试仍未通过');
  }

  // 平台仓库零污染
  const dirty = execSync('git status --porcelain', { cwd: root, stdio: 'pipe' })
    .toString()
    .trim();
  report.platformRepoCleanAfter =
    dirty.split(/\r?\n/).filter(Boolean).length === 0;
  report.tests.push({
    name: '平台仓库零污染（git status 干净）',
    status: report.platformRepoCleanAfter ? 'PASS' : 'FAIL',
  });

  report.status = summarize(report);
} catch (e) {
  report.errors.push(e.message);
  report.status = 'FAIL';
}
const file = resolve(
  root,
  'docs/quality-gate/reports/ai-tools-integration-20260914/live-exec-closedloop-' +
    Date.now() +
    '.json',
);
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    status: report.status,
    tests: report.tests.length,
    file,
    errors: report.errors,
  }),
);
