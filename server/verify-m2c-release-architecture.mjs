import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  root = 'docs/quality-gate/reports/m2c-4-release-observation-20260913';
const read = (p) => readFileSync(p, 'utf8'),
  json = (p) => JSON.parse(read(p));
const a = json(root + '/authorization-20260913.json'),
  baseline = json(root + '/protected-baseline.json'),
  report = {
    at: new Date().toISOString(),
    status: 'FAIL',
    checks: [],
    sourceHashes: {},
    protectedCount: 0,
  };
const check = (name, fn) => {
  fn();
  report.checks.push({ name, status: 'PASS' });
};
try {
  check(
    'accepted63 source / seven documents / 30 gates / historical diff; current scope in local-use architecture',
    () => {
      assert.equal(a.scope.length, 63);
      assert.equal(new Set(a.scope).size, 63);
      assert.equal(a.documents.length, 7);
      assert.equal(a.gateCommands.length, 30);
      const git = (...args) =>
        execFileSync('git', args, {
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });
      const accepted = '2642524';
      const changed = [
          ...git('diff', '--name-only', '-z', a.baseline, accepted).split('\0'),
        ].filter(Boolean),
        allowed = new Set([...a.scope, ...a.documents, root + '.md']);
      assert.deepEqual(
        changed.filter(
          (p) =>
            !allowed.has(p) &&
            !/^docs\/quality-gate\/reports\/m2c-4-release-observation-20260913\/(?:(?:release|testing|artifacts|domain|governance|flow|legacy)\/)?[^/]+\.(json|png|md)$/.test(
              p,
            ),
        ),
        [],
      );
      for (const p of a.scope)
        report.sourceHashes[p] = createHash('sha256')
          .update(git('show', accepted + ':' + p))
          .digest('hex');
    },
  );
  check(
    'accepted release protected Git blobs preserved; current raw hashes in local-use architecture',
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
      const acceptedTree = tree('2642524'),
        baselineTree = tree(a.baseline);
      for (const p of Object.keys(baseline.hashes)) {
        assert.ok(baselineTree.has(p), p);
        assert.equal(acceptedTree.get(p), baselineTree.get(p), p);
        report.protectedCount++;
      }
      assert.equal(report.protectedCount, 2806);
    },
  );
  check(
    'explicit006 extends five immutable migration prefixes / all release tables and guards',
    () => {
      const m = require('./src/persistence/migrations'),
        r = m.registry('006');
      assert.equal(r.length, 6);
      for (const v of ['001', '002', '003', '004', '005'])
        assert.deepEqual(m.registry(v), r.slice(0, Number(v)));
      const sql = read('server/sql/m2c/006-release-observation.sql');
      for (const t of require('./src/persistence/release-readiness').tables)
        assert.ok(sql.includes('CREATE TABLE ' + t));
      for (const t of require('./src/persistence/release-readiness').triggers)
        assert.ok(sql.includes('CREATE TRIGGER ' + t));
      assert.match(sql, /FOREIGN KEY\(tenant_id,req_id,plan_id,review_id\)/);
      assert.match(sql, /FOREIGN KEY\(tenant_id,req_id,attempt_id,result_id\)/);
      assert.match(
    read('server/src/runtime.js'),
    /PFC_DB_TARGET_VERSION \|\| '006'|targetVersion: '006'/,
  );
    },
  );
  check(
    'three business mutation boundaries and membership before cached receipts',
    () => {
      for (const file of [
        'requirement-service',
        'artifact-service',
        'verification-read-service',
      ])
        assert.match(
          read('server/src/domain/' + file + '.js'),
          /require\('\.\/release-guard'\)\.guard/,
        );
      const commands = read('server/src/persistence/commands.js');
      assert.ok(
        commands.indexOf('authorizeCommand') <
          commands.indexOf('const previous'),
      );
      assert.match(commands, /'006'/);
      assert.match(
        read('server/src/domain/membership-policy.js'),
        /releaseReview/,
      );
    },
  );
  check(
    'routes delegate; pure policy; 42 ordered scripts and no direct browser tool execution',
    () => {
      for (const file of ['releases', 'observations'])
        assert.doesNotMatch(
          read('server/src/routes/' + file + '.js'),
          /SELECT |INSERT INTO|UPDATE .+ SET|DELETE FROM/,
        );
      assert.doesNotMatch(
        read('server/src/domain/release-policy.js'),
        /\.query\(|fetch\(|persistence/,
      );
      const html = read('output/pfc-workbench-prototype/index.html');
      assert.equal([...html.matchAll(/<script src=/g)].length, 43);
      for (const file of [
        'release-client',
        'release-view',
        'release-actions',
        'observation-view',
        'observation-actions',
      ]) {
        assert.ok(html.includes('original/' + file + '.js'));
        assert.doesNotMatch(
          read('output/pfc-workbench-prototype/original/' + file + '.js'),
          /\brequire\(|child_process|\beval\(|new Function|<iframe/,
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
  console.error(e.message);
  process.exitCode = 1;
}
const outputRoot = 'docs/quality-gate/reports/local-use-baseline-20260913';
mkdirSync(outputRoot + '/release', { recursive: true });
writeFileSync(
  outputRoot + '/release/architecture.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, sourceHashes: undefined }));
