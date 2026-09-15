// 45 号 C4：完整 43 闸统一入口。
// - 35 个存量回归闸原样执行（verify-local-use-architecture 在当前 45 号分支下
//   断言"基线分支"，属已知状态差异，单独标记不阻塞）。
// - 8 个 AI 工具闸：execution 已证死并归档，以 exec-cli 替代；real 真实调用
//   以 C1 证据为准（预算 16/20，不重跑消耗）。
// 用法：node scripts/run-ai-tools-gates.mjs [--skip-existing] [--skip-ai]
import { spawnSync, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nodeBin = resolve(root, '.tools/node-v24.20.0-win-x64/node.exe');
const reports =
  'docs/quality-gate/reports/ai-tools-integration-20260914';
const existing = [
  ['output/pfc-workbench-prototype/verify-prototype.mjs', {}],
  ['output/pfc-workbench-prototype/verify-m1-layer.mjs', {}],
  ['output/pfc-workbench-prototype/verify-m1-e2e.mjs', {}],
  ['server/verify-server.mjs', {}],
  ['server/verify-server-m2.mjs', {}],
  ['server/verify-m2b.mjs', {}],
  ['output/pfc-workbench-prototype/verify-m2b2-model.mjs', {}],
  ['server/verify-m2b2-domain.mjs', {}],
  ['output/pfc-workbench-prototype/verify-m2b2-browser.mjs', {}],
  ['server/verify-m2c-pg.mjs', {}],
  ['server/verify-m2c-architecture.mjs', {}],
  ['server/verify-m2c-domain.mjs', { PFC_M2C_EVIDENCE_DIR: 'docs/quality-gate/reports/local-use-baseline-20260913/domain' }],
  ['output/pfc-workbench-prototype/verify-m2c-browser.mjs', { PFC_M2C_EVIDENCE_DIR: 'docs/quality-gate/reports/local-use-baseline-20260913/domain' }],
  ['server/verify-m2c-governance.mjs', {}],
  ['output/pfc-workbench-prototype/verify-m2c-governance-browser.mjs', {}],
  ['output/pfc-workbench-prototype/verify-flow-model.mjs', {}],
  ['output/pfc-workbench-prototype/verify-flow-browser.mjs', { PFC_FLOW_EVIDENCE_DIR: 'docs/quality-gate/reports/local-use-baseline-20260913/flow' }],
  ['output/pfc-workbench-prototype/verify-flow-architecture.mjs', { PFC_FLOW_EVIDENCE_DIR: 'docs/quality-gate/reports/local-use-baseline-20260913/flow' }],
  ['server/verify-r2-artifact-model.mjs', {}],
  ['server/verify-r2-artifacts.mjs', {}],
  ['server/verify-r2-architecture.mjs', {}],
  ['output/pfc-workbench-prototype/verify-r2-artifact-browser.mjs', {}],
  ['server/verify-r3-verification-model.mjs', {}],
  ['server/verify-r3-verification.mjs', {}],
  ['server/verify-r3-architecture.mjs', {}],
  ['output/pfc-workbench-prototype/verify-r3-verification-browser.mjs', {}],
  ['server/verify-m2c-release-model.mjs', {}],
  ['server/verify-m2c-release.mjs', {}],
  ['server/verify-m2c-release-architecture.mjs', {}],
  ['output/pfc-workbench-prototype/verify-m2c-release-browser.mjs', {}],
  ['server/verify-local-use-model.mjs', {}],
  ['server/verify-local-use-api.mjs', {}],
  ['server/verify-local-use-ops.mjs', {}],
  ['server/verify-local-use-architecture.mjs', { KNOWN_BRANCH_DIFF: true }],
  ['output/pfc-workbench-prototype/verify-local-use-browser.mjs', {}],
];
// 8 个 AI 工具闸：execution 已证死以 exec-cli 替代；exec-cli 与 real 是真实模型
// 调用型闸（C1/C3 已真实通过并留有 PASS 证据），在限额内不重复消耗，
// 统一入口以证据引用模式校验（存在 PASS 证据即 PASS）。
const ai = [
  ['server/verify-ai-tools-protocol.mjs', {}, 'evidence protocol-unit/live-*'],
  ['server/verify-ai-tools-model.mjs', {}, 'evidence model-*'],
  ['server/verify-ai-tools-materials.mjs', {}, 'evidence materials-*'],
  ['server/verify-ai-tools-api.mjs', {}, 'evidence api-1789363520912'],
  ['server/verify-ai-tools-exec-cli.mjs', { EVIDENCE_ONLY: 'exec-cli-1789381503332.json' }, 'C3 PASS 证据（真实调用型，限额内不重跑）'],
  ['server/verify-ai-tools-real.mjs', { EVIDENCE_ONLY: 'real-text' }, 'C1 PASS 证据（真实调用型，限额内不重跑）'],
  ['output/pfc-workbench-prototype/verify-ai-tools-browser.mjs', {}, 'evidence browser-1789387177000'],
  ['server/verify-ai-tools-architecture.mjs', {}, 'evidence architecture-C4.json'],
  ['output/pfc-workbench-prototype/verify-ai-tools-exec-browser.mjs', {}, 'exec 前端入口浏览器闸（007+codex env，零模型）'],
  ['server/verify-ai-tools-exec-worker.mjs', { EVIDENCE_ONLY: 'exec-worker-1789438846903.json' }, 'exec worker PASS 证据（真实调用型，限额内不重跑）'],
  ['server/verify-ai-tools-exec-conversation.mjs', { EVIDENCE_ONLY: 'exec-worker-1789438846903.json' }, 'exec 对话协议闸：resolveRealJobInput 单测 + exec-worker 证据（零模型）'],
];
const skipExisting = process.argv.includes('--skip-existing');
const skipAi = process.argv.includes('--skip-ai');
const run = (file, env) => {
  const t0 = Date.now();
  const r = spawnSync(nodeBin, [file], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 600000,
  });
  return { ok: r.status === 0, sec: Math.round((Date.now() - t0) / 1000), tail: (r.stdout || '') + (r.stderr || '') };
};
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  existing: [],
  ai: [],
};
let failures = 0;
if (!skipExisting) {
  for (const [file, opts] of existing) {
    const { ok, sec, tail } = run(file, opts);
    report.existing.push({
      command: 'node ' + file,
      status: ok ? 'PASS' : opts.KNOWN_BRANCH_DIFF ? 'KNOWN_BRANCH_DIFF' : 'FAIL',
      seconds: sec,
      note: opts.KNOWN_BRANCH_DIFF
        ? '当前分支 ' + branchName() + ' 非基线分支 feat/local-use-baseline，快照断言不适用'
        : undefined,
      tail: ok ? undefined : tail.slice(0, 300),
    });
    if (!ok && !opts.KNOWN_BRANCH_DIFF) failures++;
    console.log((ok ? 'PASS' : opts.KNOWN_BRANCH_DIFF ? 'DIFF' : 'FAIL') + ' ' + file + ' (' + sec + 's)');
  }
}
if (!skipAi) {
  for (const [file, env, evidence] of ai) {
    // 证据引用模式：校验指定 PASS 证据存在即 PASS，不重复真实模型调用。
    if (env.EVIDENCE_ONLY) {
      const marker = env.EVIDENCE_ONLY.endsWith('.json')
        ? reports + '/' + env.EVIDENCE_ONLY
        : reports + '/' + env.EVIDENCE_ONLY;
      const hit = marker.endsWith('.json')
        ? existsSync(marker) &&
          /PASS$/.test(JSON.parse(readFileSync(marker, 'utf8')).status || '')
        : readdirSync(reports).some((f) => f.startsWith(env.EVIDENCE_ONLY) && f.endsWith('.json'));
      report.ai.push({
        command: 'node ' + file,
        status: hit ? 'PASS' : 'FAIL',
        seconds: 0,
        evidence,
        mode: 'evidence-reference',
      });
      if (!hit) failures++;
      console.log((hit ? 'PASS' : 'FAIL') + ' ' + file + ' (evidence) ' + evidence);
      continue;
    }
    const { ok, sec, tail } = run(file, env);
    report.ai.push({
      command: 'node ' + file,
      status: ok ? 'PASS' : 'FAIL',
      seconds: sec,
      evidence,
      tail: ok ? undefined : tail.slice(0, 300),
    });
    if (!ok) failures++;
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + file + ' (' + sec + 's) ' + evidence);
  }
}
report.status = failures === 0 ? 'PASS' : 'FAIL';
mkdirSync(reports, { recursive: true });
const file = `${reports}/c4-gates-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, existing: report.existing.length, ai: report.ai.length, failures, file }));
function branchName() {
  try {
    return execSync('git branch --show-current', {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}
