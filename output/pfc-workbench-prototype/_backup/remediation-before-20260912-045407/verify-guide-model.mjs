import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
function factory() {
  const store = new Map();
  const ctx = vm.createContext({
    window: { addEventListener() {} },
    localStorage: {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    Date,
  });
  for (const f of ['data.js', 'model.js'])
    vm.runInContext(readFileSync(join(root, 'original', f), 'utf8'), ctx, {
      filename: f,
    });
  const P = ctx.window.PFC;
  P.s.reqs = {};
  const r = P.makeRequirement(
    'CODEx_TEST_GUIDE',
    '测试提醒',
    '到期前按规则触达',
  );
  P.s.reqs[r.id] = r;
  P.s.ui.req = r.id;
  P.s.ui.stage = 'idea';
  return { P, r, store };
}
const results = [];
function test(name, fn) {
  fn();
  results.push(name);
}
function toDev(P, r) {
  r.questions.forEach((q) => (q.answer = '明确范围与异常处理'));
  for (const stage of ['idea', 'req', 'design']) {
    P.s.ui.stage = stage;
    P.confirmVersion(r, stage, P.latest(r, stage).id);
    P.advance(r);
  }
}
test('stage-gates-and-version-immutability', () => {
  const { P, r } = factory();
  assert.throws(() => P.advance(r), /确认|回答/);
  r.questions.forEach((q) => (q.answer = '合成回答'));
  const old = JSON.stringify(P.latest(r, 'idea').fields);
  P.newVersion(r, 'idea', [{ name: '目标', value: '新目标' }]);
  assert.equal(JSON.stringify(r.artifacts.idea[0].fields), old);
  P.confirmVersion(r, 'idea', P.latest(r, 'idea').id);
  P.advance(r);
  assert.equal(r.stage, 'req');
  P.s.ui.stage = 'observe';
  assert.throws(() => P.advance(r), /正在查看/);
});
test('cancel-verify-retry-terminal-integrity', () => {
  const { P, r } = factory();
  toDev(P, r);
  const run = P.startRun(r);
  P.tick();
  const pct = run.pct;
  P.runControl(r, 'cancel');
  assert.equal(run.status, 'CANCELLING');
  P.tick();
  assert.equal(run.status, 'CANCELLED');
  assert.equal(run.pct, pct);
  assert.throws(() => P.runControl(r, 'retry'), /核验/);
  P.runControl(r, 'verify');
  P.tick();
  const old = JSON.stringify(run);
  P.runControl(r, 'retry');
  assert.equal(JSON.stringify(run), old);
  assert.equal(r.runs.at(-1).parentId, run.id);
});
test('authorization-capability-snapshot-and-unknown', () => {
  const { P, r } = factory();
  toDev(P, r);
  P.s.role = 'viewer';
  assert.throws(() => P.startRun(r), /只读/);
  P.s.role = 'owner';
  P.s.bridges[0].status = 'OFFLINE';
  assert.throws(() => P.startRun(r), /离线/);
  P.s.bridges[0].status = 'ONLINE';
  const run = P.startRun(r),
    snapshot = JSON.stringify(run.snapshot);
  P.s.enabled = [];
  assert.equal(JSON.stringify(run.snapshot), snapshot);
  P.s.bridges[0].status = 'OFFLINE';
  P.tick();
  assert.equal(run.status, 'UNKNOWN');
  assert.throws(() => P.startRun(r), /离线|未结束/);
});
test('development-test-release-observation-chain', () => {
  const { P, r } = factory();
  toDev(P, r);
  P.startRun(r);
  for (let n = 0; n < 13; n++) P.tick();
  assert.equal(r.runs.at(-1).status, 'SUCCEEDED');
  P.confirmVersion(r, 'dev', P.latest(r, 'dev').id);
  P.advance(r);
  P.testRun(r, true);
  assert.throws(() => P.advance(r), /测试/);
  r.defects.forEach((d) => (d.status = 'RESOLVED'));
  P.testRun(r);
  assert.equal(r.defects[0].status, 'CLOSED');
  P.advance(r);
  r.accept = {
    status: 'ACCEPTED',
    actor: '合成负责人',
    note: '人工核对',
    stamp: P.stamp(r),
  };
  P.advance(r);
  P.requestRelease(r, {
    target: '本地演示环境',
    scope: '当前版本',
    rollback: '恢复原版本',
    hours: 1,
  });
  assert.throws(() => P.releaseAction(r, 'execute'), /批准/);
  P.releaseAction(r, 'approve');
  assert.equal(r.stage, 'release');
  P.releaseAction(r, 'execute');
  assert.equal(r.stage, 'observe');
  assert.ok(r.observation.startedAt);
});
test('expired-approval-and-baseline-invalidation', () => {
  const { P, r } = factory();
  toDev(P, r);
  r.stage = 'release';
  P.s.ui.stage = 'release';
  r.accept = { status: 'ACCEPTED' };
  P.requestRelease(r, {
    target: '本地',
    scope: '版本',
    rollback: '回退',
    hours: 1,
  });
  r.release.expiresAt = P.now() - 1;
  assert.throws(() => P.releaseAction(r, 'approve'), /过期/);
  P.newVersion(r, 'req', [{ name: '范围', value: '新范围' }]);
  assert.equal(r.stage, 'req');
  assert.equal(P.latest(r, 'design').stale, true);
  assert.equal(r.release.status, 'STALE');
  assert.equal(r.accept, null);
});
test('session-capability-overrides-do-not-change-team-policy', () => {
  const { P, r } = factory();
  r.stage = 'dev';
  const enabled = JSON.stringify(P.s.enabled);
  r.overrides.dev = { codex: false };
  assert.ok(!P.effective(r).some((c) => c.id === 'codex'));
  assert.equal(JSON.stringify(P.s.enabled), enabled);
  const other = P.makeRequirement(
    'CODEx_TEST_OTHER',
    '另一需求',
    '独立范围',
    'dev',
  );
  assert.ok(P.effective(other).some((c) => c.id === 'codex'));
});
test('concurrent-window-conflict-prevents-writes-and-ticks', () => {
  const { P, r, store } = factory();
  toDev(P, r);
  P.startRun(r);
  P.save();
  const old = store.get(P.KEY);
  P.conflict = true;
  assert.throws(() => P.newVersion(r, 'dev', []), /另一窗口/);
  P.tick();
  assert.equal(store.get(P.KEY), old);
});
test('verification-preserves-observed-result-and-evidence', () => {
  for (const observed of [
    'UNKNOWN',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ]) {
    const { P, r } = factory();
    toDev(P, r);
    const run = P.startRun(r);
    run.status = 'UNKNOWN';
    run.verificationResult = observed;
    P.runControl(r, 'verify');
    P.tick();
    assert.equal(run.status, observed);
    assert.equal(run.verified, observed !== 'UNKNOWN');
    if (observed === 'SUCCEEDED') {
      assert.equal(run.exitCode, 0);
      assert.match(P.latest(r, 'dev').fields[0].value, new RegExp(run.id));
    }
  }
});
test('acceptance-rejection-requires-new-successful-run', () => {
  const { P, r } = factory();
  toDev(P, r);
  const old = P.startRun(r);
  for (let n = 0; n < 13; n++) P.tick();
  r.rejectedRunIds = r.runs.map((x) => x.id);
  P.confirmVersion(r, 'dev', P.latest(r, 'dev').id);
  assert.ok(P.blockers(r).some((x) => x.includes('开发作业')));
  const next = P.startRun(r);
  for (let n = 0; n < 13; n++) P.tick();
  assert.notEqual(old.id, next.id);
  P.confirmVersion(r, 'dev', P.latest(r, 'dev').id);
  assert.equal(P.blockers(r).length, 0);
});
test('invalid-storage-shape-is-rejected', () => {
  const { P } = factory();
  const sample = P.factory();
  assert.ok(P.valid(sample));
  delete sample.ui.drafts;
  assert.ok(!P.valid(sample));
});
test('late-old-baseline-result-does-not-overwrite-current-handoff', () => {
  const { P, r } = factory();
  toDev(P, r);
  const run = P.startRun(r);
  P.newVersion(r, 'req', [{ name: '范围', value: '已经调整的当前范围' }]);
  const current = JSON.stringify(r.artifacts.dev);
  for (let n = 0; n < 13; n++) P.tick();
  assert.equal(run.status, 'SUCCEEDED');
  assert.equal(JSON.stringify(r.artifacts.dev), current);
  assert.equal(P.hasCurrentSuccess(r), false);
});
console.log(
  JSON.stringify({ status: 'PASS', checks: results.length, results }),
);
