import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  repoRoot,
  evidenceRoot,
  reportFor,
  scenario,
  saveReport,
  hash,
} from './test-data/ai-tools-remediation-fixture.mjs';
const report = reportFor(
  '46 exact scope/protected history/current source review',
);
const pkg = JSON.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      'docs/quality-gate/reports/ai-tools-remediation-plan-20260916/implementation-package.json',
    ),
  ),
);
const amended = JSON.parse(
  fs.readFileSync(
    path.join(
      evidenceRoot,
      'scope-amendment-connection-preflight-confirmed.json',
    ),
  ),
);
const paths = new Set([
  ...pkg.entries.map((x) => x.path),
  ...amended.files.map((x) => x.path),
  ...pkg.documents,
]);
await scenario(
  report,
  'Changed paths stay inside 40 source/test files, seven documents, and named new evidence',
  async () => {
    const changes = execFileSync(
      'git',
      ['-c', 'core.quotepath=false', 'diff', '--name-only', 'c1d22ac'],
      { cwd: repoRoot, encoding: 'utf8', windowsHide: true },
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const additions = execFileSync(
      'git',
      [
        '-c',
        'core.quotepath=false',
        'ls-files',
        '--others',
        '--exclude-standard',
      ],
      { cwd: repoRoot, encoding: 'utf8', windowsHide: true },
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    for (const file of [...changes, ...additions])
      assert.ok(
        paths.has(file) ||
          file.startsWith(
            'docs/quality-gate/reports/ai-tools-remediation-20260916/',
          ),
        file,
      );
    return { changed: changes.length, untracked: additions.length };
  },
);
await scenario(
  report,
  'Protected source, SQL, dependencies and historical evidence match opening hashes',
  async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(evidenceRoot, 'protected-baseline.json')),
    );
    const entries = data.files || data.entries || data.protected;
    assert.ok(Array.isArray(entries));
    for (const file of entries) {
      if (amended.files.some((x) => x.path === file.path)) continue;
      assert.equal(
        hash(fs.readFileSync(path.join(repoRoot, file.path))),
        file.sha256,
        file.path,
      );
    }
    return {
      protected: entries.length,
      explicitAmendments: amended.files.length,
    };
  },
);
await scenario(
  report,
  'Real execution fails closed and legacy runners cannot clear history or bless failures',
  async () => {
    const worker = fs.readFileSync(
      path.join(repoRoot, 'server/src/agent/worker.js'),
      'utf8',
    );
    assert.ok(worker.includes('requireCapability'));
    assert.ok(!worker.includes('approval_policy=never'));
    assert.ok(!worker.includes('execFileSync'));
    const runner = fs.readFileSync(
      path.join(repoRoot, 'server/scripts/run-ai-tools-gates.mjs'),
      'utf8',
    );
    assert.ok(!/git[^\n]*(?:checkout|clean)/.test(runner));
    assert.ok(runner.includes('BLOCKED'));
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    assert.throws(
      () => require('./src/agent/execution-policy').requireCapability(),
      { code: 'EXEC_APPROVAL_COVERAGE_UNVERIFIED' },
    );
  },
);
await scenario(
  report,
  'Scoped JavaScript syntax and ESLint recommended checks',
  async () => {
    const { ESLint } = await import('eslint');
    const recommended = (await import('@eslint/js')).default.configs
      .recommended;
    const globals = Object.fromEntries(
      'process Buffer console setTimeout clearTimeout setInterval clearInterval setImmediate clearImmediate URL URLSearchParams fetch AbortController AbortSignal TextDecoder TextEncoder structuredClone performance queueMicrotask atob btoa window document navigator localStorage sessionStorage location history crypto WebSocket File FileReader Blob FormData Event CustomEvent HTMLElement HTMLInputElement MutationObserver ResizeObserver requestAnimationFrame cancelAnimationFrame confirm alert prompt innerWidth innerHeight'
        .split(' ')
        .map((k) => [k, 'readonly']),
    );
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: true,
      overrideConfig: [
        recommended,
        {
          files: ['**/*.js', '**/*.mjs'],
          languageOptions: { ecmaVersion: 'latest', globals },
          rules: {
            'no-unused-vars': [
              'error',
              { argsIgnorePattern: '^_', ignoreRestSiblings: true },
            ],
          },
        },
        {
          files: ['server/src/**/*.js'],
          languageOptions: {
            sourceType: 'commonjs',
            globals: { __dirname: 'readonly', __filename: 'readonly' },
          },
        },
      ],
    });
    const files = [...pkg.entries, ...amended.files].map((x) => x.path);
    for (const file of files)
      execFileSync(process.execPath, ['--check', path.join(repoRoot, file)], {
        cwd: repoRoot,
        stdio: 'pipe',
        windowsHide: true,
      });
    const results = await eslint.lintFiles(files);
    const failures = results
      .filter((r) => r.errorCount || r.warningCount)
      .map((r) => ({
        file: path.relative(repoRoot, r.filePath),
        messages: r.messages,
      }));
    report.lintFailures = failures;
    assert.deepEqual(failures, []);
    return {
      files: files.length,
      configuration:
        'Scoped recommended + explicit Node/browser globals; root legacy TS configuration is not claimed as run',
    };
  },
);
await scenario(report, 'Scoped Prettier format check', async () => {
  const prettier = await import('prettier'),
    bad = [];
  for (const item of [...pkg.entries, ...amended.files]) {
    const file = path.join(repoRoot, item.path);
    if (
      !(await prettier.check(fs.readFileSync(file, 'utf8'), {
        ...(await prettier.resolveConfig(file)),
        filepath: file,
      }))
    )
      bad.push(item.path);
  }
  assert.deepEqual(bad, []);
  return { files: 40 };
});
for (const [name, args] of [
  ['config', ['scripts/check-config.mjs']],
  ['delivery', ['--import', 'tsx', 'scripts/check-delivery-governance.ts']],
])
  await scenario(report, 'Native ' + name + ' governance', async () => ({
    command: [process.execPath, ...args],
    output: execFileSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
    }),
  }));
saveReport(report, 'architecture');
