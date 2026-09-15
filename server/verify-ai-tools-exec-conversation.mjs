'use strict';
// exec 对话接入协议级验证（零模型消耗）：
// 1. resolveRealJobInput 单测——sendMessage 的 exec 判定/校验/作业输入构造
//    （tool:'exec' → EXECUTE、workspace 存在性校验、restrictedReadDirs 透传、
//     TEXT 回退、不存在/非目录 400）。
// 2. EVIDENCE_ONLY——引用 verify-ai-tools-exec-worker 已入库 PASS 证据，
//    证明同一 jobInput 形态经 runExecJob 的真实执行链（CLI host + 受限读 hook
//    + 流式写回）端到端通过。
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'exec conversation protocol: resolveRealJobInput (tool:exec → EXECUTE + workspace validation) + EVIDENCE_ONLY of exec-worker runExecJob chain',
  modelTurns: 0,
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

// EVIDENCE_ONLY 证据模式（统一入口引用已入库 PASS 证据）
if (process.env.EVIDENCE_ONLY) {
  try {
    const evPath = path.join(
      here,
      '..',
      'docs/quality-gate/reports/ai-tools-integration-20260914',
      process.env.EVIDENCE_ONLY,
    );
    const ev = JSON.parse(readFileSync(evPath, 'utf8'));
    const echeck = (name, fn) => {
      try {
        fn();
        report.checks.push({ name, pass: true });
      } catch (e) {
        report.checks.push({ name, pass: false, error: String(e.message || e) });
        throw e;
      }
    };
    echeck('evidence status PASS', () => assert.equal(ev.status, 'PASS'));
    echeck('evidence runResult SUCCEEDED', () =>
      assert.equal(ev.runResult && ev.runResult.status, 'SUCCEEDED'),
    );
    echeck('evidence probe outsideReadDenied=true', () =>
      assert.equal(ev.probe && ev.probe.outsideReadDenied, true),
    );
    report.status = 'PASS';
    report.evidenceOnly = process.env.EVIDENCE_ONLY;
  } catch (e) {
    report.error = String(e.message || e);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === 'PASS' ? 0 : 1);
}

try {
  const { resolveRealJobInput } = require('./src/domain/conversation-service');
  const { fail } = require('./src/access');
  const base = {
    userMessageId: 'U-1',
    aiMessageId: 'A-1',
    content: '修复登录页按钮',
    refs: [],
    stage: 'dev',
  };

  // 1) exec 形态 → EXECUTE + workspace/restrictedReadDirs 透传
  const wd = path.resolve('.local/ai-tools-integration-20260914/preflight');
  mkdirSync(wd, { recursive: true });
  const r1 = resolveRealJobInput(
    { tool: 'exec', workspace: wd, restrictedReadDirs: ['D:/other'], control: { mode: 'strict', allowedFiles: ['workspace/**'], allowedCommands: ['node --test'] } },
    base,
  );
  check('tool:exec → kind EXECUTE', () => assert.equal(r1.kind, 'EXECUTE'));
  check('commandId EXEC- prefix', () => assert.equal(r1.commandId, 'EXEC-U-1'));
  check('workspace passed through', () => assert.equal(r1.input.workspace, wd));
  check('restrictedReadDirs passed through', () =>
    assert.deepEqual(r1.input.restrictedReadDirs, ['D:/other']),
  );
  check('D5 control plan passed through', () =>
    assert.deepEqual(r1.input.control, { mode: 'strict', allowedFiles: ['workspace/**'], allowedCommands: ['node --test'] }),
  );
  check('exec prompt content retained', () =>
    assert.equal(r1.input.content, '修复登录页按钮'),
  );
  check('exec inputHash deterministic', () =>
    assert.equal(
      r1.inputHash,
      require('node:crypto')
        .createHash('sha256')
        .update(JSON.stringify({ content: '修复登录页按钮', workspace: wd, restrictedReadDirs: ['D:/other'], control: { mode: 'strict', allowedFiles: ['workspace/**'], allowedCommands: ['node --test'] } }))
        .digest('hex'),
    ),
  );

  // 2) 普通形态 → TEXT 回退（原有行为不变）
  const r2 = resolveRealJobInput({ mode: 'real' }, base);
  check('no tool → kind TEXT', () => assert.equal(r2.kind, 'TEXT'));
  check('commandId MSG- prefix', () => assert.equal(r2.commandId, 'MSG-U-1'));
  check('TEXT job has no workspace field', () =>
    assert.equal(r2.input.workspace, undefined),
  );

  // 3) exec 但 workspace 不存在 → 400 WORKSPACE_NOT_FOUND
  try {
    resolveRealJobInput(
      { tool: 'exec', workspace: 'Z:/definitely/not/exist/20260915' },
      base,
    );
    check('workspace missing → WORKSPACE_NOT_FOUND', () =>
      assert.fail('should have thrown'),
    );
  } catch (e) {
    check('workspace missing → WORKSPACE_NOT_FOUND', () =>
      assert.equal(e.code, 'WORKSPACE_NOT_FOUND'),
    );
  }

  // 4) exec 但 workspace 是文件 → 400 WORKSPACE_NOT_DIRECTORY
  const filePath = path.join(wd, 'not-a-dir.tmp');
  writeFileSync(filePath, 'x', 'utf8');
  try {
    resolveRealJobInput({ tool: 'exec', workspace: filePath }, base);
    check('workspace file → WORKSPACE_NOT_DIRECTORY', () =>
      assert.fail('should have thrown'),
    );
  } catch (e) {
    check('workspace file → WORKSPACE_NOT_DIRECTORY', () =>
      assert.equal(e.code, 'WORKSPACE_NOT_DIRECTORY'),
    );
  }

  // 5) exec 不传 workspace → 允许（runExecJob 回退默认 cwd）
  const r5 = resolveRealJobInput({ tool: 'exec' }, base);
  check('exec without workspace allowed', () =>
    assert.equal(r5.input.workspace, undefined),
  );

  report.status = 'PASS';
} catch (e) {
  report.error = String(e.message || e);
}

const outPath = path.join(
  here,
  '..',
  'docs/quality-gate/reports/ai-tools-integration-20260914',
  `exec-conversation-protocol-${Date.now()}.json`,
);
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
assert.equal(report.status, 'PASS', 'exec conversation protocol failed');
