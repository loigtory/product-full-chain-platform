'use strict';
// 44 号 C3 真实闭环闸（真实模型 1 次）：
// 指定合成项目（独立目录，不写本平台仓库）发生实际 diff —— 初始测试失败 →
// runExecJob（codex 修复代码并跑测试）→ 测试通过 + 文件被实际修改 + 平台仓库无新追踪改动。
// 覆盖 44 号 C3 的“指定合成项目发生实际 diff，受控测试进程有可信结果”。
// 拒绝/撤权/越界不执行依赖 D5 审批流（8.11 F，未落地），本闸标注该边界。
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { aiDatabaseFixture } from './test-data/ai-tools-fixture.mjs';
import { withTransaction } from './src/persistence/transaction.js';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    '44-C3 closed-loop: synthetic project actual diff → test fail → codex fix + test → test pass; platform repo untouched',
  modelTurns: 1,
  checks: [],
};
const check = (name, fn) => {
  try {
    fn();
    report.checks.push({ name, pass: true });
  } catch (e) {
    report.checks.push({ name, pass: false, error: String(e.message || e) });
    throw e;
  }
};
// EVIDENCE_ONLY：引用已入库 PASS 证据，不跑模型。
if (process.env.EVIDENCE_ONLY) {
  const evReport = {
    at: new Date().toISOString(),
    status: 'FAIL',
    scope: '44-C3 closed-loop EVIDENCE_ONLY（引用已入库 PASS 证据）',
    modelTurns: 0,
    checks: [],
    evidenceOnly: process.env.EVIDENCE_ONLY,
  };
  try {
    const ev = JSON.parse(
      readFileSync(
        path.join(root, 'docs/quality-gate/reports/ai-tools-integration-20260914', process.env.EVIDENCE_ONLY),
        'utf8',
      ),
    );
    const echeck = (name, fn) => {
      try { fn(); evReport.checks.push({ name, pass: true }); }
      catch (e) { evReport.checks.push({ name, pass: false, error: String(e.message || e) }); throw e; }
    };
    echeck('evidence status PASS', () => assert.equal(ev.status, 'PASS'));
    echeck('evidence job SUCCEEDED', () => assert.equal(ev.job?.state, 'SUCCEEDED'));
    echeck('evidence test fail→pass', () => assert.equal(ev.testBefore?.passed, false) && assert.equal(ev.testAfter?.passed, true));
    echeck('evidence actual diff', () => assert.equal(ev.diffHappened, true));
    echeck('evidence platform repo clean', () => assert.equal(ev.repoClean, true));
    evReport.status = 'PASS';
  } catch (e) { evReport.error = String(e.message || e); }
  console.log(JSON.stringify(evReport, null, 2));
  process.exit(evReport.status === 'PASS' ? 0 : 1);
}

const nodeBin = path.join(root, '.tools/node-v24.20.0-win-x64/node.exe');
// codex CLI 连接参数（与 exec-worker 闸同款；未配置时 worker 明确 FAILED，不回退模拟）
process.env.PFC_CODEX_BINARY =
  process.env.PFC_CODEX_BINARY ||
  'C:/Users/hz19114673/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js';
process.env.PFC_CODEX_BINARY_SHA256 = process.env.PFC_CODEX_BINARY_SHA256 || '';
const runNodeTest = (cwd) => {
  try {
    const out = execFileSync(nodeBin, ['--test'], { cwd, encoding: 'utf8', timeout: 60000, stdio: ['ignore','pipe','pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
};

let fixture;
try {
  fixture = await aiDatabaseFixture('closedloop');
  const { migrate, assertReady } = require('./src/persistence/migrations');
  await migrate(fixture.db);
  await assertReady(fixture.db);
  const { ctx, req } = await fixture.seed();
  const db = fixture.db;
  const { runExecJob } = await import('./src/agent/worker.js');

  // 合成项目（独立目录，不写平台仓库）：sum.js 故意含 bug（乘代替加），测试初始失败
  mkdirSync(path.resolve('.local/ai-tools-closedloop-20260915'), { recursive: true });
  const base = mkdtempSync(path.join(path.resolve('.local/ai-tools-closedloop-20260915'), 'proj_'));
  const workspace = path.join(base, 'workspace');
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'synthetic', type: 'module', private: true }, null, 2), 'utf8');
  writeFileSync(
    path.join(workspace, 'sum.js'),
    'export function sum(a, b) {\n  return a * b; // BUG: should be a + b\n}\n',
    'utf8',
  );
  writeFileSync(
    path.join(workspace, 'sum.test.js'),
    "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { sum } from './sum.js';\n\ntest('sum(2,3) === 5', () => {\n  assert.equal(sum(2, 3), 5);\n});\n",
    'utf8',
  );
  const before = readFileSync(path.join(workspace, 'sum.js'), 'utf8');

  // 初始测试必须失败（C3：测试失败 → 修复 → 通过）
  const t0 = runNodeTest(workspace);
  report.testBefore = { code: t0.code, passed: t0.code !== 0, out: t0.out.slice(0, 200) };
  check('initial test fails', () => assert.equal(t0.code !== 0, true));

  // 平台仓库改动基线（排除 .local 与闸证据目录）
  const gitStatusBefore = execSync('git status --short', { cwd: root, encoding: 'utf8' });
  report.gitBefore = gitStatusBefore.slice(0, 300);

  // enqueue EXECUTE 作业（workspace = 合成项目）
  const prompt =
    'CODEx_TEST_AI_TOOLS_20260914_CLOSEDLOOP。项目在 ' +
    workspace +
    '。运行 node --test 会发现 sum.js 的 bug（sum(2,3) 应为 5）。只修改 sum.js 使测试通过，不要修改 sum.test.js，不要修改 package.json。修复后运行 node --test 并报告测试结果。';
  const enqueued = await withTransaction(fixture.db, async (client) => {
    const messages = require('./src/persistence/messages');
    const jobs = require('./src/persistence/agent-jobs');
    const ai = await messages.create(client, fixture.db, ctx, req, {
      turnId: randomUUID(), role: 'ai', stage: 'idea', content: '', status: 'generating',
      metadata: { real: true },
    });
    const job = await jobs.enqueue(client, fixture.db, ctx, req, {
      commandId: 'EXEC-' + ai.id,
      kind: 'EXECUTE',
      inputHash: createHash('sha256').update(JSON.stringify({ content: prompt, workspace })).digest('hex'),
      input: { userMessageId: 'MSG-' + randomUUID(), aiMessageId: ai.id, content: prompt, workspace, restrictedReadDirs: [] },
    });
    return { ai, job };
  });

  const result = await runExecJob({ db: fixture.db, ctx, reqPublicId: req.public_id, jobId: enqueued.job.id });
  report.runResult = { status: result.status, code: result.code || null };
  check('runExecJob SUCCEEDED', () => assert.equal(result.status, 'SUCCEEDED'));

  // 修复后测试必须通过
  const t1 = runNodeTest(workspace);
  report.testAfter = { code: t1.code, passed: t1.code === 0, out: t1.out.slice(0, 200) };
  check('test passes after fix', () => assert.equal(t1.code === 0, true));

  // 实际 diff：sum.js 被修改且不再是 bug 版本
  const after = readFileSync(path.join(workspace, 'sum.js'), 'utf8');
  report.diffHappened = before !== after && after.includes('a + b');
  check('actual diff on synthetic project', () => assert.equal(report.diffHappened, true));

  // 平台仓库无新追踪改动（排除闸证据目录；比较跑闸前后差集——A–D 已修改未提交的文件属闸前基线，不计入）
  const gitStatusAfter = execSync('git status --short', { cwd: root, encoding: 'utf8' });
  const norm = (s) =>
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.includes('docs/quality-gate/reports/ai-tools-integration-20260914/'))
      .sort();
  const beforeLines = new Set(norm(gitStatusBefore));
  const newTracked = norm(gitStatusAfter).filter((l) => !beforeLines.has(l));
  report.repoClean = newTracked.length === 0;
  report.newTracked = newTracked;
  report.gitAfter = gitStatusAfter.slice(0, 300);
  check('platform repo has no new tracked changes', () => assert.equal(report.repoClean, true));

  // 作业终态
  const jobRow = (await db.pool.query(`SELECT state FROM "${db.schema}".agent_jobs WHERE id=$1`, [enqueued.job.id])).rows[0];
  check('agent_jobs SUCCEEDED', () => assert.equal(jobRow.state, 'SUCCEEDED'));
  report.job = { state: jobRow.state, kind: 'EXECUTE' };

  report.status = 'PASS';
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: e.message };
  process.exitCode = 1;
} finally {
  if (fixture) await fixture.cleanup();
  const outDir = path.join(root, 'docs/quality-gate/reports/ai-tools-integration-20260914');
  const file = path.join(outDir, `exec-closedloop-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    status: report.status, checks: report.checks.length, file,
    testBefore: report.testBefore?.passed, testAfter: report.testAfter?.passed,
    diffHappened: report.diffHappened, repoClean: report.repoClean,
    error: report.error,
  }));
  try { rmSync(path.resolve('.local/ai-tools-closedloop-20260915'), { recursive: true, force: true }); } catch {}
}
