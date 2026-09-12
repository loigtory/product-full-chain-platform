import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const required = ['flow-demo-data.js', 'flow-model.js'];
assert.ok(
  required.every((f) => existsSync(join(root, 'original', f))),
  'R1 model and deterministic factory are not implemented',
);
const ctx = vm.createContext({
  window: {},
  structuredClone,
  AbortSignal,
  setTimeout,
  clearTimeout,
});
for (const f of required)
  vm.runInContext(readFileSync(join(root, 'original', f), 'utf8'), ctx);
const D = ctx.window.PFCFlowData,
  M = ctx.window.PFCFlow;
const results = [];
let serial = 0;
function session() {
  return D.create('CODEx_TEST_FLOW_20260912_model' + ++serial, '#/home');
}
function cmd(s, type, payload = {}, id = 'cmd-' + ++serial) {
  return { id, type, reqId: s.selected, expectedRevision: s.revision, payload };
}
function act(s, type, payload = {}) {
  return M.reduce(s, cmd(s, type, payload));
}
const req = (s) => s.reqs.find((r) => r.id === s.selected);
const baseline = (s) => req(s).versions.at(-1);
async function check(name, fn) {
  await fn();
  results.push({ name, status: 'PASS' });
}
await check('candidate-before-prd-confirmation-and-complete-chain', () => {
  let s = session();
  assert.equal(req(s).stage, 'idea');
  s = act(s, 'generate');
  assert.equal(req(s).stage, 'req');
  assert.equal(baseline(s).prototype.days, 7);
  assert.equal(baseline(s).businessConfirmed, false);
  s = act(s, 'confirm-business');
  s = act(s, 'confirm-design');
  assert.equal(req(s).stage, 'dev');
  assert.ok(baseline(s).designApproved);
  s = act(s, 'start-run');
  s = act(s, 'step-run');
  s = act(s, 'step-run');
  assert.equal(req(s).stage, 'test');
  assert.equal(req(s).run.status, 'SUCCEEDED');
  s = act(s, 'run-tests');
  assert.equal(req(s).stage, 'accept');
  assert.equal(req(s).acceptance, null);
  s = act(s, 'accept');
  assert.equal(req(s).stage, 'release');
  assert.throws(() => act(s, 'execute-release'), /批准/);
  s = act(s, 'approve-release');
  s = act(s, 'execute-release');
  assert.equal(req(s).stage, 'observe');
  assert.throws(() => act(s, 'finish'), /观察/);
  s = act(s, 'collect-observation');
  s = act(s, 'finish');
  assert.ok(req(s).closed);
  assert.equal(s.reqs.length, 2);
  s = act(s, 'create-followup');
  assert.equal(s.reqs.length, 3);
  assert.ok(req(s).events.every((e) => e.source === 'simulation'));
});
await check('atomic-related-versions-history-and-reject', () => {
  let s = act(session(), 'generate');
  s = act(s, 'propose', { days: 3 });
  const v1 = JSON.stringify(baseline(s));
  s = act(s, 'reject');
  assert.equal(JSON.stringify(baseline(s)), v1);
  s = act(s, 'propose', { days: 3 });
  s = act(s, 'apply-proposal');
  assert.equal(baseline(s).prototype.days, 3);
  assert.equal(baseline(s).prd.days, 3);
  assert.equal(baseline(s).ac.days, 3);
  assert.equal(req(s).versions.length, 2);
  assert.equal(JSON.stringify(req(s).versions[0]), v1);
  assert.equal(req(s).versions[0].design.version, baseline(s).design.version);
});
await check('stale-command-and-stale-suggestion', () => {
  let s = act(session(), 'generate');
  const old = cmd(s, 'confirm-business');
  s = act(s, 'propose', { days: 3 });
  assert.throws(() => M.reduce(s, old), /版本/);
  const broken = structuredClone(s);
  req(broken).proposal.baselineId = 'old';
  assert.throws(() => act(broken, 'apply-proposal'), /基线/);
});
await check('permissions-before-replay-and-idempotency', () => {
  let s = session();
  const c = cmd(s, 'generate');
  s = M.reduce(s, c);
  assert.equal(M.reduce(s, c).revision, s.revision);
  assert.throws(
    () => M.reduce(s, { ...c, payload: { extra: true } }),
    /重复命令/,
  );
  s = act(s, 'scenario', { kind: 'viewer' });
  assert.throws(() => M.reduce(s, c), /只读/);
});
await check('partial-generation-and-independent-preparation', () => {
  let s = act(session(), 'scenario', { kind: 'partial' });
  s = act(s, 'generate');
  assert.equal(baseline(s).complete, false);
  assert.throws(() => act(s, 'confirm-business'), /补齐/);
  s = act(s, 'complete-generation');
  s = act(s, 'scenario', { kind: 'input' });
  assert.throws(() => act(s, 'confirm-business'), /决定/);
  s = act(s, 'prepare');
  assert.ok(req(s).prepared);
  assert.equal(req(s).question.answer, '');
  s = act(s, 'answer', { answer: 'inbox' });
  s = act(s, 'confirm-business');
  assert.equal(req(s).stage, 'design');
});
await check(
  'unknown-is-verified-before-resume-and-changes-block-active-run',
  () => {
    let s = act(
      act(act(session(), 'generate'), 'confirm-business'),
      'confirm-design',
    );
    s = act(s, 'start-run');
    s = act(s, 'scenario', { kind: 'unknown' });
    assert.throws(() => act(s, 'start-run'), /核验|运行/);
    assert.throws(() => act(s, 'step-run'), /核验|运行/);
    s = act(s, 'propose', { days: 3 });
    assert.throws(() => act(s, 'apply-proposal'), /运行/);
    s = act(s, 'verify-run');
    assert.equal(req(s).run.status, 'PAUSED');
    s = act(s, 'resume');
    s = act(s, 'step-run');
    s = act(s, 'step-run');
    s = act(s, 'apply-proposal');
    assert.equal(req(s).stage, 'req');
    assert.equal(req(s).run, null);
    assert.ok(req(s).history.some((x) => x.run?.status === 'SUCCEEDED'));
  },
);
await check('failed-tests-and-release-recovery-preserve-evidence', () => {
  let s = act(
    act(act(session(), 'generate'), 'confirm-business'),
    'confirm-design',
  );
  s = act(act(act(s, 'start-run'), 'step-run'), 'step-run');
  s = act(s, 'scenario', { kind: 'test-failure' });
  s = act(s, 'run-tests');
  assert.equal(req(s).tests.status, 'FAIL');
  assert.throws(() => act(s, 'accept'), /测试|阶段/);
  s = act(s, 'fix-tests');
  s = act(s, 'run-tests');
  s = act(s, 'accept');
  s = act(s, 'approve-release');
  s = act(s, 'scenario', { kind: 'release-failure' });
  s = act(s, 'execute-release');
  assert.equal(req(s).release.status, 'FAILED');
  assert.equal(req(s).stage, 'release');
  s = act(s, 'retry-release');
  assert.equal(req(s).stage, 'observe');
  assert.ok(req(s).events.some((x) => x.action === '模拟发布失败'));
});
await check('acceptance-return-identifies-failed-item', () => {
  let s = act(
    act(act(session(), 'generate'), 'confirm-business'),
    'confirm-design',
  );
  s = act(act(act(s, 'start-run'), 'step-run'), 'step-run');
  s = act(act(s, 'run-tests'), 'return-acceptance');
  assert.equal(req(s).tests.items[2].result, 'FAIL');
  assert.equal(req(s).history.at(-1).tests.items[2].result, 'PASS');
});
await check('invalid-stored-content-fails-before-render', () => {
  const broken = act(session(), 'generate');
  delete baseline(broken).prototype;
  assert.throws(() => M.validate(broken), /产物/);
});
await check('request-isolation-and-limits', () => {
  let s = session();
  const other = JSON.stringify(s.reqs[1]);
  s = act(s, 'generate');
  assert.equal(JSON.stringify(s.reqs[1]), other);
  assert.throws(() => act(s, 'propose', { days: 0 }), /1.*30/);
  assert.throws(
    () => M.reduce(s, { ...cmd(s, 'generate'), reqId: 'unknown' }),
    /需求/,
  );
  assert.throws(() => D.create('real_user_data'), /合成/);
});
await check(
  'store-lock-concurrent-write-no-lock-quota-and-cleanup',
  async () => {
    const map = new Map([['ordinary', 'unchanged']]);
    let tail = Promise.resolve(),
      locked = 0,
      failWrite = false;
    const storage = {
      getItem: (k) => map.get(k) ?? null,
      setItem(k, v) {
        if (failWrite) throw Error('quota');
        map.set(k, v);
      },
      removeItem: (k) => map.delete(k),
    };
    const locks = {
      request(k, opts, fn) {
        const p = tail.then(() => {
          locked++;
          return fn();
        });
        tail = p.catch(() => {});
        return p;
      },
    };
    let mode = 'local';
    const store = M.createStore({ storage, locks, mode: () => mode });
    let s = await store.create(session());
    const key = store.key(s.runId);
    const c = cmd(s, 'generate');
    const pair = await Promise.allSettled([
      store.transact(s.runId, c),
      store.transact(s.runId, cmd(s, 'scenario', { kind: 'viewer' })),
    ]);
    assert.equal(pair.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(locked, 3);
    s = store.load(s.runId);
    const saved = map.get(key);
    failWrite = true;
    await assert.rejects(
      () => store.transact(s.runId, cmd(s, 'propose', { days: 3 })),
      /quota/,
    );
    assert.equal(map.get(key), saved);
    failWrite = false;
    mode = 'api';
    await assert.rejects(
      () => store.transact(s.runId, cmd(s, 'propose', { days: 3 })),
      /本地/,
    );
    mode = 'local';
    const noLock = M.createStore({ storage, locks: null, mode: () => mode });
    await assert.rejects(() => noLock.create(session()), /锁/);
    await store.remove(s.runId, s.revision);
    assert.equal(map.has(key), false);
    assert.equal(map.get('ordinary'), 'unchanged');
  },
);
console.log(
  JSON.stringify({
    status: 'PASS',
    checks: results.length,
    results,
    data: 'synthetic process-local maps; no browser/PG/network',
    cleanup: 'maps discarded',
  }),
);
