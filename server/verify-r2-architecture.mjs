import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  base = '04fd81a28e16abe2d92ff87799a78750fbd497b4';
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  results: [],
  fingerprints: {},
};
const check = (name, fn) => {
  fn();
  report.results.push({ name, status: 'PASS' });
};
try {
  check(
    'Accepted R2 exact whitelist; current R3 scope checked by verify-r3-architecture',
    () => {
      const design = read(
        'docs/planning/prototype-v3/33-R2关联产物与阶段承接方案及范围确认-20260913.md',
      );
      const section = design.slice(
        design.indexOf('## 五、'),
        design.indexOf('## 六、'),
      );
      const files = [...section.matchAll(/^(?:server|output)\/[^\s`]+$/gm)].map(
        (x) => x[0],
      );
      assert.equal(files.length, 52);
      const allowed = new Set([
        ...files,
        'AGENTS.md',
        'output/pfc-workbench-prototype/README.md',
        ...[
          '19-开发路线图-20260912.md',
          '20-Codex交接提示词-20260912.md',
          '33-R2关联产物与阶段承接方案及范围确认-20260913.md',
          '34-R2关联产物实施与验收-20260913.md',
          'README.md',
        ].map((x) => 'docs/planning/prototype-v3/' + x),
        'docs/quality-gate/reports/r2-artifacts-20260913.md',
      ]);
      const changed = [
        ...git(
          'diff',
          '--name-only',
          '-z',
          base,
          '2afce7a683c08cf6c318f8668581539be5aa09ea',
        ).split('\0'),
      ].filter(Boolean);
      assert.deepEqual(
        changed.filter(
          (p) =>
            !allowed.has(p) &&
            !/^docs\/quality-gate\/reports\/r2-artifacts-20260913\/(?:(?:artifacts|domain|governance|flow|legacy)\/)?[^/]+\.(json|png|md)$/.test(
              p,
            ),
        ),
        [],
      );
      for (const p of git('ls-tree', '-r', '--name-only', base)
        .split('\n')
        .filter((p) =>
          /^(archive\/|output\/(playwright\/|pfc-workbench-prototype\/_backup\/))|server\/sql\/m2c\/00[123]|original\/(flow-(demo-data|model|view|actions)\.js|flow\.css|base\.css|guide\.css|workbench-shell\.js|model\.js|data-layer\.js)$/.test(
            p,
          ),
        )) {
        const old = execFileSync('git', ['show', base + ':' + p], {
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });
        const now = readFileSync(p);
        const canonical = (b) =>
          /\.(js|mjs|cjs|css|html|md|json|sql)$/.test(p)
            ? Buffer.from(b.toString().replace(/\r\n/g, '\n'))
            : b;
        assert.deepEqual(canonical(now), canonical(old), p);
        report.fingerprints[p] = createHash('sha256')
          .update(canonical(now))
          .digest('hex');
      }
    },
  );
  check('source responsibilities and preview execution boundary', () => {
    assert.doesNotMatch(
      read('server/src/routes/artifacts.js'),
      /INSERT INTO|UPDATE .+ SET|DELETE FROM/,
    );
    for (const file of [
      'artifact-client',
      'artifact-view',
      'artifact-actions',
      'prototype-preview',
    ])
      assert.doesNotMatch(
        read('output/pfc-workbench-prototype/original/' + file + '.js'),
        /\brequire\(|child_process|\beval\(|new Function|allow-same-origin|allow-popups/,
      );
    const preview = read(
      'output/pfc-workbench-prototype/original/prototype-preview.js',
    );
    assert.match(preview, /default-src 'none'/);
    assert.match(preview, /connect-src 'none'/);
    assert.match(preview, /textContent/);
    assert.match(preview, /clearTimeout/);
    assert.match(preview, /event.source\s*!==\s*frame.contentWindow/);
    assert.match(preview, /event.origin\s*!==\s*'null'/);
    assert.match(preview, /event.data\?\.channel\s*!==\s*channel/);
    assert.doesNotMatch(preview, /artifact-proposals|\.command\(|\.write\(/);
    assert.match(
      read('server/src/domain/execution-plan-policy.js'),
      /snapshotVersion:\s*2/,
    );
    assert.match(
      read('server/src/domain/execution-plan-policy.js'),
      /requireReady/,
    );
  });
  check(
    '004 extends canonical migrations; contract and all script entries agree',
    () => {
      const migration = require('./src/persistence/migrations'),
        r = migration.registry('004');
      assert.equal(r.length, 4);
      for (const v of ['001', '002', '003']) {
        const old = migration.registry(v);
        assert.deepEqual(old, r.slice(0, Number(v)));
      }
      const front = read(
        'output/pfc-workbench-prototype/original/api-client.js',
      );
      for (const [name, path] of require('./src/contract').reqs) {
        assert.ok(front.includes(name));
        assert.ok(front.includes(path));
      }
      const html = read('output/pfc-workbench-prototype/index.html');
      for (const file of [
        'artifact-client',
        'artifact-view',
        'artifact-actions',
        'prototype-preview',
      ])
        assert.ok(html.includes('original/' + file + '.js'));
    },
  );
  report.status = 'PASS';
} catch (e) {
  report.error = e.message;
  console.error(e.stack);
}
const out = 'docs/quality-gate/reports/r3-test-acceptance-20260913/artifacts';
mkdirSync(out, { recursive: true });
writeFileSync(
  out + '/architecture-' + Date.now() + '.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    status: report.status,
    results: report.results,
    protected: Object.keys(report.fingerprints).length,
    error: report.error,
  }),
);
if (report.status !== 'PASS') process.exitCode = 1;
