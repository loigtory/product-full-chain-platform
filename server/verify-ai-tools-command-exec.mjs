import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// 审批流命令执行器单元验证（不依赖模型/数据库）：
// 1) allowlist 精确匹配（node --test 通过/失败、git status）
// 2) deny 优先（git 变更、删除、网络外发、任意执行器、绝对路径、敏感路径、npm 联网）
// 3) 超时进程树终止（taskkill /T /F）
// 4) 输出限量与审计
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const nodeBin = path.join(root, '.tools/node-v24.20.0-win-x64/node.exe');

const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '49-approval-flow command-runner unit gates',
  modelTurns: 0,
  checks: [],
};
const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, pass: true });
  } catch (e) {
    checks.push({ name, pass: false, error: String(e.message || e) });
    throw e;
  }
};

const { runCommand, assertCommandAllowed, denyMatch } = require('./src/agent/command-runner.js');

// 授权工作区：checkedWorkspace 仅接受规范目录
const hostRoot = path.join(root, '.local/ai-tools-host-exec-20260917');
const caseRoot = path.join(
  hostRoot,
  'CODEx_TEST_AI_HOST_20260917_' + randomUUID(),
  'workspace',
);
mkdirSync(caseRoot, { recursive: true });
writeFileSync(
  path.join(caseRoot, 'package.json'),
  JSON.stringify({ name: 'synthetic', type: 'module', private: true }, null, 2),
  'utf8',
);
writeFileSync(
  path.join(caseRoot, 'sum.js'),
  'export function sum(a, b) {\n  return a * b; // BUG: should be a + b\n}\n',
  'utf8',
);
writeFileSync(
  path.join(caseRoot, 'sum.test.js'),
  "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { sum } from './sum.js';\n\ntest('sum(2,3) === 5', () => {\n  assert.equal(sum(2, 3), 5);\n});\n",
  'utf8',
);
// 合成项目须为独立 git 仓库，避免 git status 冒泡到平台仓库
const { execFileSync } = await import('node:child_process');
execFileSync('git', ['init'], { cwd: caseRoot, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'pfc-test@local'], { cwd: caseRoot, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'pfc-test'], { cwd: caseRoot, stdio: 'ignore' });

// 冻结计划：三条命令（node --test / git status / 长跑探针）
const nodeTest = [nodeBin, '--test', '--test-reporter=tap'];
const gitStatus = ['git', 'status', '--porcelain=v1'];
const longRunning = [nodeBin, '-e', 'setTimeout(()=>{}, 600000)'];
const plan = {
  mode: 'strict',
  allowedFiles: ['**'],
  allowedCommands: [nodeTest, gitStatus, longRunning],
  maxFiles: 10,
  maxBytes: 1048576,
  approvedBy: 'owner',
};

try {
  // ---- 1) allowlist 精确匹配与执行 ----
  await check('allowlist: node --test 放行且退出码 1（未修复 bug）', async () => {
    const r = await runCommand({ command: nodeTest, cwd: caseRoot, plan });
    assert.equal(r.exitCode, 1);
    assert.equal(r.timedOut, false);
    assert.match(r.stdout, /not ok/);
  });

  await check('allowlist: git status 放行且输出 porcelain', async () => {
    const r = await runCommand({ command: gitStatus, cwd: caseRoot, plan });
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^\?\? (package\.json|sum\.js|sum\.test\.js)/m);
  });

  await check('allowlist: 修复后 node --test 退出码 0', async () => {
    writeFileSync(
      path.join(caseRoot, 'sum.js'),
      'export function sum(a, b) {\n  return a + b;\n}\n',
      'utf8',
    );
    const r = await runCommand({ command: nodeTest, cwd: caseRoot, plan });
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^ok \d+ - /m);
  });

  // ---- 2) deny 优先（即使在计划内也拒绝）----
  const denyCases = [
    { name: 'git push', cmd: ['git', 'push', 'origin', 'main'], code: 'COMMAND_GIT_MUTATING_FORBIDDEN' },
    { name: 'git commit', cmd: ['git', 'commit', '-m', 'x'], code: 'COMMAND_GIT_MUTATING_FORBIDDEN' },
    { name: 'git checkout', cmd: ['git', 'checkout', 'dev'], code: 'COMMAND_GIT_MUTATING_FORBIDDEN' },
    { name: 'rm -rf', cmd: ['rm', '-rf', 'node_modules'], code: 'COMMAND_DESTRUCTIVE_FORBIDDEN' },
    { name: 'del /f', cmd: ['del', '/f', 'sum.js'], code: 'COMMAND_DESTRUCTIVE_FORBIDDEN' },
    { name: 'curl 外发', cmd: ['curl', 'https://example.com'], code: 'COMMAND_GENERAL_EXEC_FORBIDDEN' },
    { name: 'powershell', cmd: ['powershell', '-c', 'Get-Process'], code: 'COMMAND_GENERAL_EXEC_FORBIDDEN' },
    { name: 'cmd', cmd: ['cmd', '/c', 'dir'], code: 'COMMAND_GENERAL_EXEC_FORBIDDEN' },
    { name: 'python', cmd: ['python', 'x.py'], code: 'COMMAND_GENERAL_EXEC_FORBIDDEN' },
    { name: 'npm install', cmd: ['npm', 'install', 'lodash'], code: 'COMMAND_NPM_NETWORK_FORBIDDEN' },
    { name: 'npm publish', cmd: ['npm', 'publish'], code: 'COMMAND_NPM_NETWORK_FORBIDDEN' },
    { name: '绝对路径参数', cmd: ['git', 'status', 'C:\\Users\\x'], code: 'COMMAND_ABSOLUTE_PATH_FORBIDDEN' },
    { name: '敏感路径 .ssh', cmd: ['git', 'log', '--format=%H', '--', '.ssh'], code: 'COMMAND_SENSITIVE_PATH_FORBIDDEN' },
    { name: '敏感路径 .env', cmd: ['git', 'diff', '.env'], code: 'COMMAND_SENSITIVE_PATH_FORBIDDEN' },
  ];
  for (const c of denyCases) {
    await check('deny: ' + c.name + ' → ' + c.code, () => {
      assert.throws(() => assertCommandAllowed(c.cmd, plan), (e) => e.code === c.code);
      const m = denyMatch(c.cmd);
      assert.ok(m && m.code === c.code);
    });
  }

  // ---- 3) 计划外命令拒绝 ----
  await check('allowlist: 计划外命令 COMMAND_NOT_IN_PLAN', () => {
    assert.throws(
      () => assertCommandAllowed(['git', 'log', '--oneline'], plan),
      (e) => e.code === 'COMMAND_NOT_IN_PLAN',
    );
  });

  // ---- 4) 超时进程树终止 ----
  await check('timeout: 长命令被终止且 timedOut=true', async () => {
    const r = await runCommand({
      command: longRunning,
      cwd: caseRoot,
      plan,
      timeoutMs: 3000,
    });
    assert.equal(r.timedOut, true);
    assert.notEqual(r.exitCode, 0);
  });

  await check('timeout: 进程树确已清理（无残留 node -e 长跑进程）', async () => {
    await new Promise((res) => setTimeout(res, 1500));
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object -ExpandProperty CommandLine",
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 },
    );
    const leaked = out
      .split(/\r?\n/)
      .some((l) => l.includes('setTimeout(()=>{}, 600000)'));
    assert.equal(leaked, false);
  });

  // ---- 5) 输出限量与审计 ----
  await check('audit: 输出超限时截断标记', async () => {
    const noisy = [nodeBin, '-e', 'console.log("x".repeat(3000000))'];
    const r = await runCommand({
      command: noisy,
      cwd: caseRoot,
      plan: { ...plan, allowedCommands: [nodeTest, gitStatus, longRunning, noisy] },
      timeoutMs: 15000,
    });
    assert.equal(r.stdoutTruncated, true);
    assert.ok(Buffer.byteLength(r.stdout) <= 1048576 + 100);
  });

  await check('warnings: 输出出现允许清单外命令痕迹时记录', async () => {
    const cmd = [nodeBin, '-e', 'console.log("> git push origin main")'];
    const r = await runCommand({
      command: cmd,
      cwd: caseRoot,
      plan: { ...plan, allowedCommands: [nodeTest, gitStatus, longRunning, cmd] },
      timeoutMs: 15000,
    });
    assert.ok(
      r.warnings.some((w) => w.includes('git push')),
      'warnings=' + JSON.stringify(r.warnings),
    );
  });

  report.status = checks.every((c) => c.pass) ? 'PASS' : 'FAIL';
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: e.message };
  process.exitCode = 1;
} finally {
  // 子进程句柄可能延迟释放：重试删除，失败不覆盖真实结论
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(path.dirname(caseRoot), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      break;
    } catch {
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  report.checks = checks;
  console.log(JSON.stringify(report, null, 2));
}
