import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url),
  read = (p) => readFileSync(resolve(p), 'utf8');
const results = [];
const check = (name, fn) => {
  fn();
  results.push({ name, status: 'PASS' });
};
check('routes and WebSocket never own domain store or SQL', () => {
  for (const file of [
    'server/src/ws.js',
    ...readdirSync('server/src/routes')
      .filter((f) => f.endsWith('.js'))
      .map((f) => 'server/src/routes/' + f),
  ]) {
    assert.doesNotMatch(
      read(file),
      /require\([^)]*domain\/store|\bS\.(?:reqs|runs|messages|notices|leases)|\b(?:INSERT INTO|UPDATE .* SET|DELETE FROM)\b/,
    );
  }
});
check(
  'service is a bounded mode facade and responsibilities have separate modules',
  () => {
    assert.ok(read('server/src/domain/service.js').split('\n').length < 100);
    for (const name of [
      'requirement',
      'material',
      'conversation',
      'execution',
      'notification',
    ])
      assert.match(read('server/src/domain/' + name + '-service.js'), /memory/);
    for (const name of [
      'questions',
      'materials',
      'messages',
      'runs',
      'run-output',
      'leases',
      'notices',
      'commands',
      'events',
    ])
      assert.ok(read('server/src/persistence/' + name + '.js').length > 100);
  },
);
check('PG has no automatic migration seed or snapshot persistence path', () => {
  assert.doesNotMatch(
    read('server/src/db.js'),
    /new Pool|CREATE TABLE|ensureSchema|m1-schema|INSERT INTO/,
  );
  assert.doesNotMatch(
    read('server/src/runtime.js'),
    /migrate\(|\.sql|CREATE TABLE|P\.s/,
  );
  assert.match(
    read('server/src/domain/store.js'),
    /isPg\(\)[\s\S]*DOMAIN_WRITE_REQUIRED/,
  );
  assert.doesNotMatch(
    read('server/sql/m2c/002-domain-workspace.sql'),
    /app_state|CREATE (?:DATABASE|ROLE|EXTENSION)/i,
  );
});
check('frontend domain mapping never fabricates requirement facts', () => {
  assert.doesNotMatch(
    read('output/pfc-workbench-prototype/original/domain-view.js'),
    /makeRequirement\(|factory\(/,
  );
  assert.match(
    read('output/pfc-workbench-prototype/original/api-client.js'),
    /health\.storage\s*===\s*'pg'/,
  );
  assert.match(
    read('output/pfc-workbench-prototype/original/model.js'),
    /domainView\.savePreferences/,
  );
});
check(
  'canonical migration identity and targets retain version 001 contract',
  () => {
    const { registry } = require('./src/persistence/migrations');
    const a = registry('001'),
      b = registry('002');
    assert.equal(a.length, 1);
    assert.equal(b.length, 2);
    assert.equal(a[0].checksum, b[0].checksum);
    assert.throws(() => registry('auto'));
    assert.throws(() =>
      require('./src/persistence/connection').validateTarget({
        schema: 'pfc',
        authorizedSchema: 'pfc',
      }),
    );
  },
);
check('approved frontend and server contract additions match', () => {
  const contract = require('./src/contract'),
    frontend = read('output/pfc-workbench-prototype/original/api-client.js');
  for (const [name, path] of [...contract.reqs, ...contract.runs]) {
    assert.ok(frontend.includes(name));
    assert.ok(frontend.includes(path));
  }
});
check('future workbench target is exact and performs no initialization', () => {
  const { validateTarget } = require('./src/persistence/connection');
  const input = {
    schema: 'pfc_workbench',
    authorizedSchema: 'pfc_workbench',
    connectionString:
      'postgres://pfc_app_local:synthetic@127.0.0.1:5432/pfc_local',
  };
  assert.equal(validateTarget(input).schema, 'pfc_workbench');
  assert.throws(() =>
    validateTarget({
      ...input,
      authorizedSchema: 'codex_test_m2c_20260912_domain',
    }),
  );
  assert.throws(() =>
    validateTarget({
      ...input,
      schema: 'pfc_workbench_other',
      authorizedSchema: 'pfc_workbench_other',
    }),
  );
  assert.doesNotMatch(
    read('server/src/runtime.js'),
    /CREATE SCHEMA|INSERT INTO/,
  );
});
console.log(JSON.stringify({ status: 'PASS', results }, null, 2));
