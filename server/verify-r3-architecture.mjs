import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  root = 'docs/quality-gate/reports/r3-test-acceptance-20260913';
const read = (p) => readFileSync(p, 'utf8'),
  json = (p) => JSON.parse(read(p));
const a = json(root + '/authorization-20260913.json'),
  baseline = json(root + '/protected-baseline.json');
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  checks: [],
  sourceHashes: {},
  protectedCount: 0,
};
const check = (name, work) => {
  work();
  report.checks.push({ name, status: 'PASS' });
};
try {
  check(
    'accepted R3 scope at b07dadf; current diff enforced by release architecture',
    () => {
      assert.equal(a.scope.length, 59);
      assert.equal(new Set(a.scope).size, 59);
      assert.equal(a.documents.length, 7);
      const design = read(
        'docs/planning/prototype-v3/35-R3测试验收与发布承接方案及范围确认-20260913.md',
      );
      const section = design.slice(
        design.indexOf('### 5.1'),
        design.indexOf('### 5.3'),
      );
      assert.deepEqual(
        [...section.matchAll(/^(?:server|output)\/[^\s`]+$/gm)].map(
          (m) => m[0],
        ),
        a.scope,
      );
      const git = (...args) =>
        execFileSync('git', args, {
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });

      const changed = [
        ...git(
          'diff',
          '--name-only',
          '-z',
          a.baseline,
          'b07dadf0b8482149119e2b16a37cb4c46b9134ec',
        ).split('\0'),
      ].filter(Boolean);
      const allowed = new Set([...a.scope, ...a.documents, root + '.md']);
      assert.deepEqual(
        changed.filter(
          (p) =>
            !allowed.has(p) &&
            !/^docs\/quality-gate\/reports\/r3-test-acceptance-20260913\/(?:(?:testing|artifacts|domain|governance|flow|legacy)\/)?[^/]+\.(json|png|md)$/.test(
              p,
            ),
        ),
        [],
      );
      for (const p of a.scope)
        report.sourceHashes[p] = createHash('sha256')
          .update(
            execFileSync(
              'git',
              ['show', 'b07dadf0b8482149119e2b16a37cb4c46b9134ec:' + p],
              { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
            ),
          )
          .digest('hex');
    },
  );
  check(
    'accepted R3 protected Git blobs preserved; current raw hashes covered by M2c-4',
    () => {
      assert.equal(baseline.baseline, a.baseline);
      const tree = (revision) =>
        new Map(
          execFileSync(
            'git',
            ['ls-tree', '-r', '-z', '--full-tree', revision],
            {
              encoding: 'utf8',
              windowsHide: true,
              maxBuffer: 16 * 1024 * 1024,
            },
          )
            .split('\0')
            .filter(Boolean)
            .map((line) => {
              const tab = line.indexOf('\t');
              return [line.slice(tab + 1), line.slice(0, tab).split(' ')[2]];
            }),
        );
      const acceptedTree = tree('b07dadf0b8482149119e2b16a37cb4c46b9134ec'),
        baselineTree = tree(a.baseline);
      for (const p of Object.keys(baseline.hashes)) {
        assert.ok(baselineTree.has(p), p);
        assert.equal(acceptedTree.get(p), baselineTree.get(p), p);
        report.protectedCount++;
      }
    },
  );
  check(
    '005 extends all four immutable migration prefixes and protects ownership',
    () => {
      const m = require('./src/persistence/migrations'),
        r = m.registry('005');
      assert.equal(r.length, 5);
      for (const version of ['001', '002', '003', '004'])
        assert.deepEqual(m.registry(version), r.slice(0, Number(version)));
      const sql = read('server/sql/m2c/005-testing-acceptance.sql');
      for (const table of require('./src/persistence/verification-readiness')
        .tables)
        assert.ok(sql.includes('CREATE TABLE ' + table));
      for (const trigger of require('./src/persistence/verification-readiness')
        .triggers)
        assert.ok(sql.includes('CREATE TRIGGER ' + trigger));
      assert.match(sql, /FOREIGN KEY\(tenant_id,req_id,batch_id,suite_id\)/);
      assert.match(sql, /FOREIGN KEY\(tenant_id,req_id,suite_id,case_id\)/);
    },
  );
  check(
    'transport delegates, pure policy and browser execution boundaries',
    () => {
      for (const file of ['testing', 'product-acceptance'])
        assert.doesNotMatch(
          read('server/src/routes/' + file + '.js'),
          /SELECT |INSERT INTO|UPDATE .+ SET|DELETE FROM/,
        );
      assert.doesNotMatch(
        read('server/src/domain/verification-policy.js'),
        /\.query\(|fetch\(|persistence/,
      );
      for (const name of [
        'verification-read',
        'delivery-baseline',
        'test-suite',
        'test-execution',
        'defect',
        'product-acceptance',
      ])
        assert.doesNotMatch(
          read('server/src/domain/' + name + '-service.js'),
          /\.query\(/,
        );
      const html = read('output/pfc-workbench-prototype/index.html');
      assert.equal([...html.matchAll(/<script src=/g)].length, 43);
      for (const file of [
        'verification-client',
        'testing-view',
        'testing-actions',
        'acceptance-view',
        'acceptance-actions',
      ]) {
        assert.ok(html.includes('original/' + file + '.js'));
        assert.doesNotMatch(
          read('output/pfc-workbench-prototype/original/' + file + '.js'),
          /\brequire\(|child_process|\beval\(|new Function|<iframe|allow-same-origin/,
        );
      }
      const front = read(
        'output/pfc-workbench-prototype/original/api-client.js',
      );
      for (const [name, path] of require('./src/contract').reqs) {
        assert.ok(front.includes(name), name);
        assert.ok(front.includes(path), path);
      }
    },
  );
  report.status = 'PASS';
} catch (e) {
  report.error = e.message;
  process.exitCode = 1;
  console.error(e.message);
}
mkdirSync('docs/quality-gate/reports/local-use-baseline-20260913/testing', {
  recursive: true,
});
writeFileSync(
  'docs/quality-gate/reports/local-use-baseline-20260913/testing/architecture.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    status: report.status,
    checks: report.checks,
    protectedCount: report.protectedCount,
    error: report.error,
  }),
);
