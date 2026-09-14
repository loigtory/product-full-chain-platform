import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import net from 'node:net';
import { once } from 'node:events';
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'C3 real tool execution via codex CLI host (elevated Windows sandbox): probe in workspace, deny-read/deny-write/network off asserted from actual command output',
  modelTurns: 0,
};
const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
const privateRoot = path.resolve('.local/ai-tools-integration-20260914/preflight');
const ledgerPath = path.join(privateRoot, 'configs/model-budget.json');
const binary = process.env.PFC_CODEX_BINARY;
let attempt, listener;
try {
  assert.ok(binary, 'PFC_CODEX_BINARY required');
  mkdirSync(privateRoot, { recursive: true });
  attempt = mkdtempSync(path.join(privateRoot, 'CODEx_TEST_execcli_'));
  const workspace = path.join(attempt, 'workspace');
  const configs = path.join(attempt, 'configs');
  mkdirSync(workspace);
  mkdirSync(configs);
  const canary = path.join(configs, 'canary.txt');
  writeFileSync(canary, 'CODEx_TEST_OUTSIDE_CANARY');
  let connections = 0;
  listener = net.createServer((socket) => {
    connections++;
    socket.end();
  });
  listener.listen(5201, '127.0.0.1');
  await once(listener, 'listening');
  const probe = path.join(workspace, 'probe.ps1');
  writeFileSync(
    probe,
    [
      "$ErrorActionPreference = 'Continue'",
      "$result = @{ insideWrite = $false; outsideReadDenied = $false; outsideWriteDenied = $false; loopbackReachable = $null; externalNetworkDenied = $null }",
      "try { Set-Content -Path (Join-Path $PWD 'inside.txt') -Value 'CODEx_TEST_INSIDE' -Encoding Ascii; $result.insideWrite = $true } catch {}",
      "try { Get-Content -Path $args[0] -Raw -ErrorAction Stop | Out-Null } catch { $result.outsideReadDenied = ($_.Exception.GetType().Name -match 'Unauthorized|Security|AccessDenied') }",
      "try { Set-Content -Path ($args[0] + '.write') -Value 'x' -Encoding Ascii -ErrorAction Stop } catch { $result.outsideWriteDenied = ($_.Exception.GetType().Name -match 'Unauthorized|Security|AccessDenied') }",
      "try { $c1 = New-Object System.Net.Sockets.TcpClient; $ar1 = $c1.BeginConnect('127.0.0.1', 5201, $null, $null); $ok1 = $ar1.AsyncWaitHandle.WaitOne(2000); $result.loopbackReachable = ($ok1 -and $c1.Connected); $c1.Close() } catch { $result.loopbackReachable = $false }",
      "try { $c2 = New-Object System.Net.Sockets.TcpClient; $ar2 = $c2.BeginConnect('1.1.1.1', 443, $null, $null); $ok2 = $ar2.AsyncWaitHandle.WaitOne(3000); $result.externalNetworkDenied = -not ($ok2 -and $c2.Connected); $c2.Close() } catch { $result.externalNetworkDenied = $true }",
      '$result | ConvertTo-Json -Compress',
    ].join('\r\n'),
  );
  const prompt =
    'CODEx_TEST_AI_TOOLS_20260914。运行探针脚本并报告结果：执行 PowerShell 命令 `powershell -NoProfile -ExecutionPolicy Bypass -File probe.ps1 ' +
    JSON.stringify(canary) +
    '`。探针输出一行 JSON（字段 insideWrite、outsideReadDenied、outsideWriteDenied、loopbackReachable、externalNetworkDenied）。把该 JSON 原样作为最终回复，不要修改内容、不要额外解释。';
  let lock = null;
  let budget;
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  lock = openSync(ledgerPath + '.lock', 'wx');
  try {
    budget = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    budget = {
      package: '44-ai-tools-integration-20260914',
      turns: 0,
      reservedSeconds: 0,
      attempts: [],
    };
  }
  assert.equal(budget.package, '44-ai-tools-integration-20260914');
  assert.ok(Number.isSafeInteger(budget.turns) && budget.turns >= 0 && budget.turns < 20);
  assert.ok(Number.isFinite(budget.reservedSeconds) && budget.reservedSeconds >= 0 && budget.reservedSeconds + 300 <= 3600);
  const reservation = {
    at: new Date().toISOString(),
    inputHash: createHash('sha256').update(prompt).digest('hex'),
    status: 'DISPATCHING',
    reservedSeconds: 300,
  };
  budget.turns++;
  budget.reservedSeconds += 300;
  budget.attempts.push(reservation);
  writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
  report.modelTurns = 1;
  const startedAt = Date.now();
  const child = spawn(
    binary,
    [
      'exec',
      '-s', 'workspace-write',
      '-c', 'windows.sandbox="elevated"',
      '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'approval_policy=never',
      '-C', workspace,
      '--disable', 'apps',
      '--disable', 'plugins',
      '--disable', 'hooks',
      '--disable', 'browser_use',
      '--disable', 'computer_use',
      '--disable', 'multi_agent',
      '-c', 'web_search="disabled"',
      '-c', 'analytics.enabled=false',
      prompt,
    ],
    {
      cwd: workspace,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RUST_LOG: 'error' },
      timeout: 300000,
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => (stdout += c));
  child.stderr.on('data', (c) => (stderr += c));
  const [code, signal] = await new Promise((resolve) => {
    child.on('close', (code, signal) => resolve([code, signal]));
    child.on('error', (err) => {
      reservation.status = 'FAILED';
      reservation.actualSeconds = Math.ceil((Date.now() - startedAt) / 1000);
      budget.reservedSeconds = Math.max(0, budget.reservedSeconds - 300 + reservation.actualSeconds);
      writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
      resolve([-1, err.message]);
    });
  });
  const elapsedSeconds = Math.ceil((Date.now() - startedAt) / 1000);
  reservation.actualSeconds = elapsedSeconds;
  reservation.status = code === 0 ? 'SUCCEEDED' : 'FAILED';
  budget.reservedSeconds = Math.max(0, budget.reservedSeconds - 300 + elapsedSeconds);
  writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
  report.exec = {
    code,
    signal,
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    stdout,
    stderrTail: stderr.slice(-1500),
  };
  const jsonMatch = stdout.match(/\{[^{}]*"insideWrite"[\s\S]*?\}/);
  assert.ok(jsonMatch, 'probe JSON not found in CLI stdout');
  const checks = JSON.parse(jsonMatch[0]);
  assert.equal(checks.insideWrite, true);
  assert.equal(checks.outsideWriteDenied, true);
  assert.equal(checks.externalNetworkDenied, true);
  // 差异记录（不阻塞）：workspace-write 默认读开放（受限读需权限 profile deny）；
  // loopback 在 codex restricted 网络下允许。
  report.isolationProfile = {
    outsideReadDenied: checks.outsideReadDenied === true,
    loopbackReachable: checks.loopbackReachable === true,
    loopbackConnectionsSeen: connections,
  };
  assert.equal(readFileSync(canary, 'utf8'), 'CODEx_TEST_OUTSIDE_CANARY');
  assert.equal(
    (() => {
      try {
        return readFileSync(canary + '.write', 'utf8');
      } catch {
        return null;
      }
    })(),
    null,
  );
  report.checks = checks;
  report.status = 'REAL_TOOL_EXECUTION_PASS';
} catch (e) {
  report.error = {
    code: e.code || 'EXEC_ASSERTION_FAILED',
    message: String(e.message || e).slice(0, 500),
  };
  process.exitCode = 1;
} finally {
  if (listener?.listening) await new Promise((ok) => listener.close(ok));
  if (attempt && path.resolve(attempt).startsWith(path.resolve(privateRoot))) {
    rmSync(attempt, { recursive: true, force: true });
  }
  mkdirSync(root, { recursive: true });
  const file = `${root}/exec-cli-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      file,
      error: report.error,
      checks: report.checks,
      exec: report.exec,
      modelTurns: report.modelTurns,
    }),
  );
}
