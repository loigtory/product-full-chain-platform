import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { gate } from './test-data/local-use-fixture.mjs';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import * as prettier from 'prettier';
const require = createRequire(import.meta.url),
  root = 'docs/quality-gate/reports/local-use-baseline-20260913';
const json = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const hash = (path) =>
  createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const git = (...args) =>
  execFileSync('git', ['-c', 'core.safecrlf=false', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1048576,
  });
const a = json(root + '/authorization-20260913.json');
await gate('architecture', async (report, test) => {
  const extraPath = root + '/static-gate-supplement-authorization.json';
  const extra = fs.existsSync(extraPath) ? json(extraPath) : null;
  const scope = [...a.scope];
  if (extra) {
    assert.equal(extra.status, 'CONFIRMED');
    assert.deepEqual(extra.scope, [
      'output/pfc-workbench-prototype/verify-static.mjs',
    ]);
    const source = fs
      .readFileSync(extra.scope[0], 'utf8')
      .replace(/\r\n/g, '\n');
    assert.equal(
      source,
      git('show', a.baseline + ':' + extra.scope[0])
        .replace(/\r\n/g, '\n')
        .replace(
          'assert.equal(scripts.length, 42);',
          'assert.equal(scripts.length, 43);',
        ),
    );
    scope.push(...extra.scope);
  }
  await test('confirmed scope, approved design, feature branch and current diff', () => {
    assert.equal(a.status, 'CONFIRMED');
    assert.equal(a.scope.length, 67);
    assert.equal(a.documents.length, 7);
    assert.equal(a.gateCommands.length, 35);
    assert.equal(git('branch', '--show-current').trim(), a.branch);
    const design = git('show', a.designCommit + ':' + a.design).replace(
      /\r\n/g,
      '\n',
    );
    assert.equal(
      createHash('sha256').update(design).digest('hex'),
      a.designSha256,
    );
    const allowed = new Set([...scope, ...a.documents, root + '.md']);
    const changed = [
      ...git('diff', '--name-only', '-z', a.baseline).split('\0'),
      ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
    ].filter(Boolean);
    assert.deepEqual(
      changed.filter(
        (p) =>
          !allowed.has(p) &&
          !/^docs\/quality-gate\/reports\/local-use-baseline-20260913\/(?:(?:legacy|domain|governance|flow|artifacts|testing|release|local-use)\/)?[^/]+\.(json|png|md)$/.test(
            p,
          ),
      ),
      [],
    );
    report.sourceHashes = Object.fromEntries(scope.map((p) => [p, hash(p)]));
  });
  await test('original protected files, migrations, formal delivery ledger and historical evidence', () => {
    const baseline = json(root + '/protected-baseline.json');
    assert.equal(baseline.baseline, a.baseline);
    assert.equal(Object.keys(baseline.hashes).length, 3010);
    for (const [p, h] of Object.entries(baseline.hashes))
      if (!extra?.scope.includes(p)) assert.equal(hash(p), h, p);
    const migrations = require('./src/persistence/migrations').registry('006');
    assert.equal(migrations.length, 6);
    report.protectedCount =
      Object.keys(baseline.hashes).length - (extra ? 1 : 0);
  });
  await test('same-origin ordered static assets and local-only tool ownership', () => {
    const html = fs.readFileSync(
      'output/pfc-workbench-prototype/index.html',
      'utf8',
    );
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.equal(scripts.length, 43);
    assert.equal(new Set(scripts).size, 43);
    assert.ok(
      scripts.indexOf('original/local-session.js') <
        scripts.indexOf('original/app.js'),
    );
    for (const [, p] of html.matchAll(/(?:src|href)="(original\/[^"]+)"/g))
      assert.ok(fs.existsSync(resolve('output/pfc-workbench-prototype', p)));
    for (const p of scope.filter((p) => p.includes('/original/')))
      assert.doesNotMatch(
        fs.readFileSync(p, 'utf8'),
        /child_process|\brequire\(|\beval\(|new Function/,
      );
    const runtime = fs.readFileSync('server/src/runtime.js', 'utf8'),
      index = fs.readFileSync('server/src/index.js', 'utf8');
    assert.match(runtime, /LOCAL_PROFILE_REQUIRED/);
    assert.match(runtime, /workspace-lock/);
    assert.ok(
      index.indexOf('await db.connect()') <
        index.indexOf("execution-service').recover"),
    );
    for (const p of [
      'server/src/local/preflight.js',
      'server/src/local/lifecycle.js',
    ])
      assert.doesNotMatch(
        fs.readFileSync(p, 'utf8'),
        /CREATE SCHEMA|DROP SCHEMA|\.migrate\(/,
      );
    assert.doesNotMatch(
      fs.readFileSync('server/src/local/restore-check.js', 'utf8'),
      /trust\b|ALTER ROLE|--clean|--create/,
    );
  });
  await test('changed JS syntax/lint and owned Node/new UI formatting', async () => {
    const changed = new Set([
      ...git('diff', '--name-only', '-z', a.baseline).split('\0'),
      ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
    ]);
    const globals = Object.fromEntries(
      [
        'require',
        'module',
        'exports',
        '__dirname',
        '__filename',
        'process',
        'Buffer',
        'console',
        'fetch',
        'URL',
        'URLSearchParams',
        'AbortSignal',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'queueMicrotask',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'history',
        'location',
        'File',
        'Blob',
        'FileReader',
        'FormData',
        'Image',
        'WebSocket',
        'TextEncoder',
        'Event',
        'structuredClone',
        'requestAnimationFrame',
        'getComputedStyle',
        'performance',
        'innerWidth',
        'btoa',
        'atob',
      ].map((k) => [k, 'readonly']),
    );
    const errors = [];
    for (const p of scope.filter(
      (p) => changed.has(p) && /\.(?:js|mjs)$/.test(p),
    )) {
      execFileSync(process.execPath, ['--check', resolve(p)], {
        windowsHide: true,
        stdio: 'pipe',
      });
      const text = fs.readFileSync(p, 'utf8');
      const lint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [
          js.configs.recommended,
          {
            languageOptions: {
              globals,
              sourceType: p.startsWith('server/src/') ? 'commonjs' : 'module',
            },
            rules: {
              'no-empty': ['error', { allowEmptyCatch: true }],
              'no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
              ],
            },
          },
        ],
      });
      const [result] = await lint.lintText(text, { filePath: p });
      for (const m of result.messages.filter((m) => m.severity === 2))
        errors.push({
          file: p,
          line: m.line,
          rule: m.ruleId,
          message: m.message,
        });
      if (
        p.startsWith('server/') ||
        p.includes('local-session') ||
        p.includes('verify-local-use-browser')
      ) {
        const options = await prettier.resolveConfig(p);
        if (!(await prettier.check(text, { ...options, filepath: p })))
          errors.push({ file: p, rule: 'prettier' });
      }
    }
    report.lintErrors = errors;
    assert.deepEqual(errors, []);
  });
  report.cleanup = 'READ_ONLY';
});
