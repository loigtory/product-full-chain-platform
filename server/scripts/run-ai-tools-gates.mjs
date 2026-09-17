// Historical 49-command inventory. Execution moves to the scope-bound remediation runner.
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
  [
    'server/verify-m2c-domain.mjs',
    {
      PFC_M2C_EVIDENCE_DIR:
        'docs/quality-gate/reports/local-use-baseline-20260913/domain',
    },
  ],
  [
    'output/pfc-workbench-prototype/verify-m2c-browser.mjs',
    {
      PFC_M2C_EVIDENCE_DIR:
        'docs/quality-gate/reports/local-use-baseline-20260913/domain',
    },
  ],
  ['server/verify-m2c-governance.mjs', {}],
  ['output/pfc-workbench-prototype/verify-m2c-governance-browser.mjs', {}],
  ['output/pfc-workbench-prototype/verify-flow-model.mjs', {}],
  [
    'output/pfc-workbench-prototype/verify-flow-browser.mjs',
    {
      PFC_FLOW_EVIDENCE_DIR:
        'docs/quality-gate/reports/local-use-baseline-20260913/flow',
    },
  ],
  [
    'output/pfc-workbench-prototype/verify-flow-architecture.mjs',
    {
      PFC_FLOW_EVIDENCE_DIR:
        'docs/quality-gate/reports/local-use-baseline-20260913/flow',
    },
  ],
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
  ['server/verify-local-use-architecture.mjs', {}],
  ['output/pfc-workbench-prototype/verify-local-use-browser.mjs', {}],
];
// 8 个 AI 工具闸：execution 已证死以 exec-cli 替代；exec-cli 与 real 是真实模型
// 调用型闸（C1/C3 已真实通过并留有 PASS 证据），在限额内不重复消耗，
// 统一入口以证据引用模式校验（存在 PASS 证据即 PASS）。
const ai = [
  ['server/verify-ai-tools-protocol.mjs', {}, 'evidence protocol-unit/live-*'],
  ['server/verify-ai-tools-model.mjs', {}, 'evidence model-*'],
  ['server/verify-ai-tools-materials.mjs', {}, 'evidence materials-*'],
  [
    'server/verify-ai-tools-api.mjs',
    { args: ['--pg'] },
    'evidence api-1789363520912',
  ],
  [
    'server/verify-ai-tools-exec-cli.mjs',
    { EVIDENCE_ONLY: 'exec-cli-1789381503332.json' },
    'C3 PASS 证据（真实调用型，限额内不重跑）',
  ],
  [
    'server/verify-ai-tools-real.mjs',
    { EVIDENCE_ONLY: 'real-text' },
    'C1 PASS 证据（真实调用型，限额内不重跑）',
  ],
  [
    'output/pfc-workbench-prototype/verify-ai-tools-browser.mjs',
    {},
    'evidence browser-1789387177000',
  ],
  [
    'server/verify-ai-tools-architecture.mjs',
    {},
    'evidence architecture-C4.json',
  ],
  [
    'output/pfc-workbench-prototype/verify-ai-tools-exec-browser.mjs',
    {},
    'exec 前端入口浏览器闸（007+codex env，零模型）',
  ],
  [
    'server/verify-ai-tools-exec-worker.mjs',
    { EVIDENCE_ONLY: 'exec-worker-1789438846903.json' },
    'exec worker PASS 证据（真实调用型，限额内不重跑）',
  ],
  [
    'server/verify-ai-tools-exec-conversation.mjs',
    { EVIDENCE_ONLY: 'exec-worker-1789438846903.json' },
    'exec 对话协议闸：resolveRealJobInput 单测 + exec-worker 证据（零模型）',
  ],
  [
    'server/verify-ai-tools-exec-e2e.mjs',
    { EVIDENCE_ONLY: 'exec-e2e-1789456149199.json' },
    'exec http e2e PASS 证据（真实调用型，限额内不重跑）',
  ],
  [
    'server/verify-ai-tools-exec-closedloop.mjs',
    { EVIDENCE_ONLY: 'exec-closedloop-1789460321622.json' },
    '44-C3 闭环 PASS 证据（合成项目实际 diff+测试，真实调用型）',
  ],
  [
    'server/verify-ai-tools-exec-control.mjs',
    { EVIDENCE_ONLY: 'exec-control-1789461889047.json' },
    '44-D5 受控执行 PASS 证据（计划冻结/基线/diff审批/回滚，真实调用型）',
  ],
];
const commands = [...existing, ...ai].map(([file, options]) => ({
  command: 'node ' + file,
  status: 'BLOCKED',
  reason: options.EVIDENCE_ONLY
    ? 'Historical evidence is not a current run'
    : 'Legacy target/output requires an authorized isolated adapter',
}));
console.log(
  JSON.stringify(
    {
      status: 'PLAN_ONLY',
      currentSourceVerified: false,
      commands,
      next: 'node server/scripts/run-ai-tools-remediation-gates.mjs --dry-run',
    },
    null,
    2,
  ),
);
if (
  process.argv.some((a) => a === '--run' || a === '--real' || a === '--execute')
)
  process.exitCode = 2;
