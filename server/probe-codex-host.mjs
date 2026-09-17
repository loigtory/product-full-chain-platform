// 最小诊断：验证 codex host 会话（spawn→initialize→skills/list→thread/start）能否成功
// 硬超时 120s，避免永久挂起
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const workRoot = path.join(repoRoot, '.local/ai-tools-host-exec-20260917/probe-' + Date.now());
fs.mkdirSync(workRoot, { recursive: true });
fs.writeFileSync(path.join(workRoot, 'example.txt'), 'probe\n');

const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json'), 'utf8')).source;
const options = {
  binary: path.join(process.env.APPDATA, 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
  expectedSha256: 'be96b992178b1e467c225800da0d65f2c86d5eba1ef0b14632f65db381cbdfde',
  expectedConnectionFingerprint: 'b585d723d61d18a815b77a2d81627cd71038d1f8cf7f4446f56e48eba4937292',
  mode: 'host',
  approvedInstructionSources: [source],
  enabledSkills: [],
  cwd: workRoot,
};

const hardTimer = setTimeout(() => {
  console.error('PROBE_HARD_TIMEOUT_120s');
  process.exit(3);
}, 120000);

try {
  console.error('STEP1: openProtocol...');
  const { openProtocol } = await import('./src/agent/protocol.mjs');
  const conn = await openProtocol(options);
  console.error('STEP1 OK: instanceIsolation=' + conn.summary.instanceIsolation + ' model=' + conn.summary.model);
  console.error('STEP2: skills/list...');
  const inventory = await conn.rpc.request('skills/list', { cwds: [conn.cwd], forceReload: true });
  console.error('STEP2 OK: skills=' + JSON.stringify(inventory).length + ' bytes');
  console.error('STEP3: thread/start...');
  const { hostThreadParams } = require('./src/agent/config');
  const params = hostThreadParams(conn.summary, conn.cwd, inventory);
  const thread = await conn.rpc.request('thread/start', params);
  console.error('STEP3 OK: thread=' + thread.thread?.id + ' model=' + thread.model + ' sandbox=' + thread.sandbox?.type);
  console.error('STEP4: close...');
  const exit = await conn.close();
  console.error('STEP4 OK: childExited=' + exit.childExited);
  console.error('PROBE_PASS');
  process.exit(0);
} catch (e) {
  console.error('PROBE_FAIL: ' + (e.code || e.message));
  console.error(String(e.stack || e).slice(0, 2000));
  process.exit(1);
} finally {
  clearTimeout(hardTimer);
  try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch {}
}
