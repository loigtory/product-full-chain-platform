import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const results = [];
async function check(name, work) {
  try {
    await work();
    results.push({ name, status: 'PASS' });
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message });
  }
}
await check(
  'A11 prototype schema rejects executable/unknown properties and invalid targets',
  () => {
    const spec = require('./src/domain/prototype-spec');
    const good = spec.template('form-table', { title: 'CODEx_TEST_表单' });
    assert.deepEqual(spec.validate(good), good);
    for (const bad of [
      { ...good, script: 'alert(1)' },
      { ...good, pages: [] },
      {
        ...good,
        pages: [{ ...good.pages[0], url: 'https://invalid.example' }],
      },
    ])
      assert.throws(
        () => spec.validate(bad),
        (e) => e.code === 'UNSUPPORTED_PROTOTYPE_SPEC',
      );
    const bad = structuredClone(good);
    bad.pages[0].nodes.push({
      id: 'evil',
      type: 'button',
      text: 'CODEx_TEST_',
      action: { type: 'page', target: 'missing' },
    });
    assert.throws(() => spec.validate(bad));
  },
);
await check(
  'A14 bounded prototype permits data text without executing it',
  () => {
    const spec = require('./src/domain/prototype-spec');
    const good = spec.template('approval-dialog', {
      title: 'CODEx_TEST_<script>alert(1)</script>',
    });
    assert.equal(spec.validate(good).title, good.title);
    assert.throws(() =>
      spec.validate({ ...good, pages: Array(11).fill(good.pages[0]) }),
    );
  },
);
await check(
  'A01/A02 candidate completeness, rule references and independent content comparison',
  () => {
    const policy = require('./src/domain/artifact-policy');
    const spec = require('./src/domain/prototype-spec');
    const proto = {
      representation: 'spec',
      spec: spec.template('form-table', { title: 'CODEx_TEST_' }),
    };
    assert.ok(
      policy.validateBundle({ prototype: proto }).missing.includes('prd'),
    );
    const content = {
      prototype: proto,
      prd: {
        title: 'CODEx_TEST_PRD',
        fields: [{ name: '规则', value: '必填' }],
      },
      acceptance: {
        items: [
          {
            acId: 'AC1',
            ruleId: 'RULE1',
            scenario: '填写',
            precondition: '页面可用',
            steps: ['输入'],
            expected: '保存',
          },
        ],
      },
      rules: [{ ruleId: 'RULE1', fieldIndex: 0 }],
    };
    assert.deepEqual(policy.validateBundle(content).missing, []);
    const bad = structuredClone(content);
    bad.acceptance.items[0].ruleId = 'absent';
    assert.throws(() => policy.validateBundle(bad));
    assert.equal(policy.same(content.prd, structuredClone(content.prd)), true);
  },
);
await check(
  'A12 superseded independent read preserves command receipt and draft',
  async () => {
    const storage = new Map();
    let finishRead;
    const api = {
      user: { id: 'CODEx_TEST_owner' },
      base: () => 'http://127.0.0.1',
      req: () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    };
    const P = {
      write() {},
      assert(ok, msg) {
        assert.ok(ok, msg);
      },
      domainActions: { command: async () => ({}) },
      domainView: { map() {} },
      save() {},
      render() {},
    };
    vm.runInNewContext(
      readFileSync(
        'output/pfc-workbench-prototype/original/artifact-client.js',
        'utf8',
      ),
      {
        window: { PFC: P, PFCAPI: { api } },
        crypto: { randomUUID: () => 'CODEx_TEST_receipt' },
        localStorage: {
          getItem: (k) => storage.get(k),
          setItem: (k, v) => storage.set(k, v),
        },
      },
    );
    const A = P.artifactClient,
      id = 'CODEx_TEST_req';
    A.save(id, {
      editor: { baseGroupId: 'CODEx_TEST_group' },
      forms: { editor: { prd: 'CODEx_TEST_draft' } },
    });
    A.activeForm = { reqId: id, key: 'editor' };
    const write = A.write(id, '/artifact-proposals', { changes: {} });
    await new Promise(setImmediate);
    const oldRead = finishRead,
      newRead = A.load(id, true);
    oldRead({ currentGroup: { id: 'CODEx_TEST_old' } });
    await assert.rejects(write, /读回.*更新|核验/);
    assert.equal(A.draft(id).pending.commandId, 'CODEx_TEST_receipt');
    assert.equal(A.draft(id).forms.editor.prd, 'CODEx_TEST_draft');
    finishRead({ currentGroup: { id: 'CODEx_TEST_current' } });
    await newRead;
    const retry = A.retry(id);
    await new Promise(setImmediate);
    const pendingRead = finishRead,
      backgroundRead = A.load(id);
    assert.equal(
      finishRead,
      pendingRead,
      'Background refresh must share the post-write readback',
    );
    finishRead({ currentGroup: { id: 'CODEx_TEST_current' } });
    await backgroundRead;
    await retry;
    assert.equal(A.draft(id).pending, undefined);
    assert.equal(A.draft(id).forms.editor, undefined);
  },
);
await check(
  'A14 page, node, table row and payload boundaries fail without truncation',
  () => {
    const spec = require('./src/domain/prototype-spec'),
      policy = require('./src/domain/artifact-policy');
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      id: 'n' + i,
      type: 'text',
      text: 'CODEx_TEST_' + i,
    }));
    const good = {
      schemaVersion: 1,
      title: 'CODEx_TEST_limits',
      pages: [{ id: 'main', title: 'CODEx_TEST_main', nodes }],
    };
    assert.equal(spec.validate(good).pages[0].nodes.length, 100);
    assert.throws(() =>
      spec.validate({
        ...good,
        pages: [
          {
            ...good.pages[0],
            nodes: [
              ...nodes,
              { id: 'extra', type: 'text', text: 'CODEx_TEST_' },
            ],
          },
        ],
      }),
    );
    const pages = {
      ...good,
      pages: Array.from({ length: 10 }, (_, i) => ({
        id: 'p' + i,
        title: 'CODEx_TEST_' + i,
        nodes: [{ id: 'text' + i, type: 'text', text: 'CODEx_TEST_' }],
      })),
    };
    assert.equal(spec.validate(pages).pages.length, 10);
    const rows = {
      ...good,
      pages: [
        {
          ...good.pages[0],
          nodes: [
            {
              id: 'table',
              type: 'table',
              columns: ['CODEx_TEST_'],
              rows: Array.from({ length: 500 }, () => ['CODEx_TEST_']),
            },
          ],
        },
      ],
    };
    assert.equal(spec.validate(rows).pages[0].nodes[0].rows.length, 500);
    rows.pages[0].nodes[0].rows.push(['CODEx_TEST_']);
    assert.throws(() => spec.validate(rows));
    assert.throws(
      () => policy.bounded({ value: 'CODEx_TEST_' + 'x'.repeat(524288) }),
      (e) => e.code === 'ARTIFACT_LIMIT_EXCEEDED',
    );
  },
);
await check(
  'A13 schema004 rechecks current membership before command receipt replay',
  async () => {
    const source = readFileSync(
      new URL('./src/persistence/commands.js', import.meta.url),
      'utf8',
    );
    const module = { exports: {} };
    let checked = false,
      worked = false;
    const client = { query: async () => ({ rows: [] }) };
    vm.runInNewContext(source, {
      module,
      require: (id) => {
        if (id === 'node:crypto') return require(id);
        if (id === './transaction')
          return { withTransaction: async (_db, fn) => fn(client) };
        if (id === '../access')
          return {
            fail: (code) => {
              throw Object.assign(new Error(code), { code });
            },
          };
        if (id === '../domain/membership-policy')
          return {
            authorizeCommand: async () => {
              checked = true;
              throw Object.assign(new Error('MEMBER_INACTIVE'), {
                code: 'MEMBER_INACTIVE',
              });
            },
          };
        if (id === '../domain/events') return { kick() {} };
        throw Error(id);
      },
    });
    await assert.rejects(
      module.exports.command(
        { targetVersion: '004' },
        { tenantId: 'CODEx_TEST_', actor: 'CODEx_TEST_' },
        'artifact.adopt',
        { commandId: 'CODEx_TEST_' },
        async () => {
          worked = true;
          return {};
        },
      ),
      (e) => e.code === 'MEMBER_INACTIVE',
    );
    assert.equal(checked, true);
    assert.equal(worked, false);
  },
);
const report = {
  at: new Date().toISOString(),
  status: results.every((x) => x.status === 'PASS') ? 'PASS' : 'FAIL',
  results,
};
const out = 'docs/quality-gate/reports/r2-artifacts-20260913/artifacts';
mkdirSync(out, { recursive: true });
writeFileSync(
  out + '/model-' + Date.now() + '.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
