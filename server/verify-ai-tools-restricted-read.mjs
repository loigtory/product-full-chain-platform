'use strict';
// 受限读模块单测（不耗真实模型调用）：apply/remove deny-read ACE 的
// 生命周期实测（icacls 复核）。机制层探针证据见 restricted-read-probe-20260914.json。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRestrictedRead,
  removeRestrictedRead,
  applyRestrictedReadAll,
  removeRestrictedReadAll,
  isWindows,
} from './src/agent/restricted-read.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: 'restricted-read module unit test: deny-read ACE apply/remove lifecycle (icacls verified, no model calls)',
  checks: [],
};

let root = null;
const check = (name, fn) => {
  try {
    fn();
    report.checks.push({ name, pass: true });
  } catch (e) {
    report.checks.push({ name, pass: false, error: String(e.message || e) });
    throw e;
  }
};

try {
  if (!isWindows()) {
    report.status = 'SKIPPED_NON_WINDOWS';
    report.checks.push({ name: 'platform', pass: true, note: 'restricted-read is Windows-only' });
  } else {
    root = mkdtempSync(path.join(tmpdir(), 'pfc-rr-'));
    const canaryDir = path.join(root, 'canary');
    const canaryFile = path.join(canaryDir, 'canary.txt');
    mkdirSync(canaryDir);
    writeFileSync(canaryFile, 'CODEx_TEST_OUTSIDE_CANARY', 'utf8');

    check('apply adds deny-read ACE', () => {
      const r = applyRestrictedRead(canaryDir);
      assert.equal(r.applied, true);
      const out = execFileSync('icacls', [canaryDir], { encoding: 'utf8', windowsHide: true });
      assert.match(out, /CodexSandboxUsers:\(OI\)\(CI\)\(DENY\)\(R\)/);
    });

    check('real user still reads canary (deny only sandbox group)', () => {
      assert.equal(readFileSync(canaryFile, 'utf8'), 'CODEx_TEST_OUTSIDE_CANARY');
    });

    check('remove clears deny-read ACE (idempotent)', () => {
      const r = removeRestrictedRead(canaryDir);
      assert.equal(r.removed, true);
      const out = execFileSync('icacls', [canaryDir], { encoding: 'utf8', windowsHide: true });
      assert.ok(!/CodexSandboxUsers:\(OI\)\(CI\)\(DENY\)\(R\)/.test(out));
      // 再次 remove 应幂等不抛错
      removeRestrictedRead(canaryDir);
    });

    check('applyAll rolls back on failure', () => {
      const d1 = path.join(root, 'rollback-ok');
      mkdirSync(d1);
      let threw = false;
      try {
        applyRestrictedReadAll([d1, path.join(root, 'does-not-exist')]);
      } catch (e) {
        threw = true;
        assert.match(String(e.message || e), /icacls|Command failed/);
      }
      assert.equal(threw, true, 'applyAll should throw on missing dir');
    });

    check('applyAll partial rollback leaves no ACE', () => {
      const out = execFileSync('icacls', [path.join(root, 'rollback-ok')], {
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.ok(!/CodexSandboxUsers:\(OI\)\(CI\)\(DENY\)\(R\)/.test(out));
    });

    check('removeAll idempotent on empty list', () => {
      const r = removeRestrictedReadAll([]);
      assert.deepEqual(r.removed, []);
    });

    report.status = 'PASS';
  }
} catch (e) {
  report.error = String(e.message || e);
  report.status = 'FAIL';
} finally {
  if (root) {
    try {
      removeRestrictedReadAll([path.join(root, 'canary'), path.join(root, 'rollback-ok')]);
    } catch (_) {
      /* ignore */
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const outPath = path.join(
  here,
  '..',
  'docs/quality-gate/reports/ai-tools-integration-20260914',
  `restricted-read-module-${Date.now()}.json`,
);
import { mkdirSync as mk, writeFileSync as wr } from 'node:fs';
mkdirSync(path.dirname(outPath), { recursive: true });
wr(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
assert.equal(report.status, 'PASS', 'restricted-read module test failed');
