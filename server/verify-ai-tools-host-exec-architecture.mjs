import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  authorization,
  repoRoot,
  evidenceRoot,
  reportFor,
  scenario,
  saveReport,
  hash,
} from './test-data/ai-tools-host-exec-fixture.mjs';
const report = reportFor('host-architecture');
const pkg = authorization,
  amended = { files: [] };
await scenario(
  report,
  'Exact 31 source/test paths, seven documents and current evidence only',
  () => {
    const allowed = new Set([
      ...pkg.entries.map((e) => e.path),
      ...pkg.documents,
    ]);
    const options = { cwd: repoRoot, encoding: 'utf8', windowsHide: true };
    const changed = execFileSync(
      'git',
      ['-c', 'core.quotepath=false', 'diff', '--name-only', '77b2d94'],
      options,
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const added = execFileSync(
      'git',
      [
        '-c',
        'core.quotepath=false',
        'ls-files',
        '--others',
        '--exclude-standard',
      ],
      options,
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    for (const f of [...changed, ...added])
      assert.ok(
        allowed.has(f) || f.startsWith(authorization.evidenceRoot + '/'),
        f,
      );
    return { changed, added: added.length };
  },
);
await scenario(
  report,
  'Protected history, old model budgets, dependencies and SQL remain byte-identical',
  () => {
    const entries = JSON.parse(
      fs.readFileSync(path.join(evidenceRoot, 'protected-baseline.json')),
    );
    for (const e of entries)
      assert.equal(
        hash(fs.readFileSync(path.join(repoRoot, e.path))),
        e.sha256,
        e.path,
      );
    return { protected: entries.length };
  },
);
await scenario(
  report,
  'No unsandboxed command fallback or automatic setup is reachable',
  async () => {
    const { createRequire } = await import('node:module'),
      require = createRequire(import.meta.url);
    assert.equal(
      require('./src/agent/test-runner').commandCapability().supported,
      false,
    );
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/agent/test-runner.js'),
      'utf8',
    );
    assert.equal(
      /child_process|externalSandbox|dangerFullAccess|process\/spawn|thread\/shellCommand/.test(
        source,
      ),
      false,
    );
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
  return { files: 31 };
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
