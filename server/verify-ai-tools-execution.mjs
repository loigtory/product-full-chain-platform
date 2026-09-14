import assert from 'node:assert/strict';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'Actual Windows file/network sandbox precheck; model tools and complete executor pending',
  modelTurns: 0,
};
const root = resolve('.local/ai-tools-integration-20260914');
let attempt, child, listener;
try {
  const binary = process.env.PFC_CODEX_BINARY;
  assert.equal(
    createHash('sha256').update(readFileSync(binary)).digest('hex'),
    process.env.PFC_CODEX_BINARY_SHA256,
  );
  mkdirSync(root, { recursive: true });
  attempt = mkdtempSync(join(root, 'CODEx_TEST_sandbox_'));
  const workspace = join(attempt, 'workspace'),
    configs = join(attempt, 'configs');
  mkdirSync(workspace);
  mkdirSync(configs);
  const canary = join(configs, 'canary.txt');
  writeFileSync(canary, 'CODEx_TEST_OUTSIDE_CANARY');
  let connections = 0;
  listener = net.createServer((socket) => {
    connections++;
    socket.end();
  });
  listener.listen(5201, '127.0.0.1');
  await once(listener, 'listening');
  const script = join(workspace, 'sandbox-probe.cjs');
  writeFileSync(
    script,
    `const fs=require('node:fs'); const net=require('node:net'); const p=require('node:path');
const result={insideWrite:false,outsideReadDenied:false,outsideWriteDenied:false,networkDenied:false};
try{fs.writeFileSync(p.join(__dirname,'inside.txt'),'CODEx_TEST_INSIDE');result.insideWrite=true;}catch{}
try{fs.readFileSync(process.argv[2]);}catch(e){result.outsideReadDenied=['EACCES','EPERM'].includes(e.code);}
try{fs.writeFileSync(process.argv[2]+'.write','CODEx_TEST_OUTSIDE');}catch(e){result.outsideWriteDenied=['EACCES','EPERM'].includes(e.code);}
let done=false; const s=net.connect({host:'127.0.0.1',port:5201});
const finish=(denied)=>{if(done)return;done=true;clearTimeout(timer);result.networkDenied=denied;s.destroy();console.log(JSON.stringify(result));};
const timer=setTimeout(()=>finish(true),2500);s.once('connect',()=>finish(false));s.once('error',e=>finish(['EACCES','EPERM'].includes(e.code)));
`,
  );
  const tomlPath = JSON.stringify(
    dirname(process.execPath).replaceAll('\\', '/'),
  );
  const args = [
    'sandbox',
    '-P',
    'pfc_ai_probe',
    '-c',
    `permissions.pfc_ai_probe.filesystem={":minimal"="read",":workspace_roots"="write",${tomlPath}="read"}`,
    '-c',
    'permissions.pfc_ai_probe.network.enabled=false',
    '-c',
    'windows.sandbox="unelevated"',
    '-C',
    workspace,
    '--',
    process.execPath,
    script,
    canary,
  ];
  report.command =
    'pinned codex sandbox -P pfc_ai_probe [instance-only minimal read/workspace write/network=false] -- pinned node synthetic probe';
  child = spawn(binary, args, {
    cwd: workspace,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  report.pid = child.pid;
  let stdout = '',
    stderr = '';
  const timer = setTimeout(() => child.kill(), 15000);
  child.stdout.on('data', (b) => {
    stdout += b.toString();
    if (stdout.length > 16384) child.kill();
  });
  child.stderr.on('data', (b) => {
    stderr += b.toString();
    if (stderr.length > 16384) child.kill();
  });
  let exit;
  try {
    exit = await once(child, 'exit');
  } finally {
    clearTimeout(timer);
  }
  report.process = { closed: true, exitCode: exit[0], signal: exit[1] };
  report.connections = connections;
  report.stderr = stderr
    .replaceAll(attempt, '<synthetic-root>')
    .replaceAll(process.env.USERPROFILE || 'C:/unused', '<user>')
    .slice(0, 2000);
  if (exit[0] !== 0)
    throw Object.assign(Error('SANDBOX_START_FAILED'), {
      code: 'SANDBOX_START_FAILED',
    });
  report.checks = JSON.parse(stdout.trim());
  assert.equal(report.checks.insideWrite, true);
  assert.equal(existsSync(canary + '.write'), false);
  assert.equal(readFileSync(canary, 'utf8'), 'CODEx_TEST_OUTSIDE_CANARY');
  assert.equal(connections, 0);
  assert.deepEqual(Object.values(report.checks), [true, true, true, true]);
  report.status = 'SANDBOX_PRECHECK_PASS';
} catch (e) {
  report.error = { code: e.code || 'SANDBOX_ASSERTION_FAILED' };
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null)
    child.kill();
  if (listener?.listening) await new Promise((ok) => listener.close(ok));
  if (attempt) {
    const rel = relative(root, attempt);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      report.status = 'FAIL';
      report.error = { code: 'CLEANUP_SCOPE_INVALID' };
      report.cleanup = { ownedRootRemoved: false };
      process.exitCode = 1;
    } else {
      rmSync(attempt, { recursive: true });
      report.cleanup = { ownedRootRemoved: !existsSync(attempt) };
    }
  }
  const evidence = 'docs/quality-gate/reports/ai-tools-integration-20260914';
  mkdirSync(evidence, { recursive: true });
  const file = evidence + '/execution-' + Date.now() + '.json';
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      file,
      error: report.error,
      checks: report.checks,
    }),
  );
}
