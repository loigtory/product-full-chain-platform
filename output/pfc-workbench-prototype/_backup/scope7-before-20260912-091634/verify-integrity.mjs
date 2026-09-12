import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const results = [];
function factory() {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  const context = vm.createContext({
    window: { addEventListener() {} },
    localStorage: storage,
    Date,
  });
  for (const name of ['data.js', 'model.js'])
    vm.runInContext(
      readFileSync(join(root, 'original', name), 'utf8'),
      context,
      { filename: name },
    );
  const P = context.window.PFC;
  const q = P.makeRequirement(
    'CODEx_TEST_INTEGRITY',
    '合成发布需求',
    '合成范围',
    'release',
  );
  P.s.reqs = { [q.id]: q };
  P.s.ui.req = q.id;
  P.s.ui.stage = 'release';
  P.save();
  return { P, q, store, storage };
}
function test(name, fn) {
  fn();
  results.push({ name, status: 'PASS' });
}
function approved(P, q) {
  P.requestRelease(q, {
    target: '本地演示环境',
    scope: 'CODEx_TEST_合成范围',
    rollback: '恢复合成基线',
    hours: 24,
  });
  P.releaseAction(q, 'approve');
}

test('stale-write-without-storage-event-preserves-new-record-and-local-draft', () => {
  const { P, store } = factory();
  const other = JSON.parse(store.get(P.KEY));
  other.revision++;
  other.team.name = 'CODEx_TEST_OTHER_WINDOW';
  const raw = JSON.stringify(other);
  store.set(P.KEY, raw);
  P.s.ui.drafts[P.r().id] = 'CODEx_TEST_LOCAL_DRAFT';
  assert.equal(P.save(), false);
  assert.equal(store.get(P.KEY), raw);
  assert.equal(P.s.ui.drafts[P.r().id], 'CODEx_TEST_LOCAL_DRAFT');
  assert.throws(() => P.newVersion(P.r(), 'req', []), /另一窗口/);
});
test('quota-error-does-not-increment-revision-or-claim-save', () => {
  const { P, storage, store } = factory();
  const before = store.get(P.KEY),
    revision = P.s.revision;
  storage.setItem = () => {
    throw Error('CODEx_TEST_QUOTA');
  };
  assert.equal(P.save(), false);
  assert.equal(P.s.revision, revision);
  assert.equal(store.get(P.KEY), before);
  assert.equal(P.storageError, true);
});
for (const field of ['dev', 'test', 'accept', 'target']) {
  test(
    'approval-invalidates-on-' +
      field +
      '-change-without-upstream-version-change',
    () => {
      const { P, q } = factory();
      approved(P, q);
      const stamp = P.stamp(q);
      if (field === 'dev')
        P.latest(q, 'dev').fields[0].value = 'CODEx_TEST_NEW_CODE';
      if (field === 'test') q.tests[0].actual = 'CODEx_TEST_CHANGED_RESULT';
      if (field === 'accept') q.accept.note = 'CODEx_TEST_NEW_ACCEPTANCE';
      if (field === 'target') q.release.target = 'CODEx_TEST_CHANGED_TARGET';
      assert.equal(P.stamp(q), stamp);
      assert.throws(() => P.releaseAction(q, 'execute'), /审批失效/);
      assert.equal(q.release.status, 'APPROVED');
    },
  );
}
test('frozen-artifacts-tests-acceptance-and-relations-are-independent-copies', () => {
  const { P, q } = factory();
  approved(P, q);
  const before = JSON.stringify(q.release.snapshot.content);
  P.latest(q, 'req').fields[0].value = 'CODEx_TEST_CHANGED_TEXT';
  q.tests[0].actual = 'CODEx_TEST_CHANGED_TEST';
  q.accept.note = 'CODEx_TEST_CHANGED_ACCEPT';
  q.units[0].acIds = [];
  assert.equal(JSON.stringify(q.release.snapshot.content), before);
});
test('prototype-module-ownership-and-single-entry', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const app = readFileSync(join(root, 'original/app.js'), 'utf8');
  for (const module of ['attachments', 'conversation', 'downloads']) {
    assert.equal(html.split('original/' + module + '.js').length - 1, 1);
    new vm.Script(readFileSync(join(root, 'original', module + '.js'), 'utf8'));
  }
  assert.doesNotMatch(
    app,
    /A\.send\s*=|P\.enqueueFile\s*=|P\.downloadBlob\s*=/,
  );
  assert.doesNotMatch(html, /prototype-v3\.js/);
});
console.log(
  JSON.stringify({ status: 'PASS', checks: results.length, results }),
);
