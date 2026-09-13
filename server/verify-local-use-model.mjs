import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  identity,
  syntheticKey,
  clock,
  newRunId,
} from './test-data/local-use-fixture.mjs';
const require = createRequire(import.meta.url);
const out = 'docs/quality-gate/reports/local-use-baseline-20260913/local-use';
const report = { at: new Date().toISOString(), status: 'FAIL', results: [] };
const test = async (name, work) => {
  await work();
  report.results.push({ name, status: 'PASS' });
};
try {
  const { layout } = require('./src/local/profile');
  const { checkRequest } = require('./src/local/security');
  const {
    createVerifier,
    createStore,
    cookieId,
  } = require('./src/local/session-store');
  await test('D1/D3 exact personal and disposable target tuples', () => {
    const p = layout();
    assert.equal(p.schema, 'pfc_workbench');
    assert.equal(p.apiPort, 5188);
    assert.equal(p.dbPort, 5432);
    const runId = newRunId();
    const t = layout({ scope: 'source', runId });
    assert.equal(t.schema, 'codex_test_m2c_20260913_localuse');
    assert.equal(t.apiPort, 5197);
    const r = layout({ scope: 'restore', runId });
    assert.equal(r.dbPort, 5548);
    assert.equal(r.apiPort, 5198);
    for (const scope of ['test', '../personal', 'source '])
      assert.throws(() => layout({ scope, runId }));
    assert.throws(() => layout({ scope: 'source', runId: '../escape' }));
    const { safeChild } = require('./src/local/ops-files');
    for (const name of [
      '../escape',
      'a/../b',
      'C:/outside',
      '/absolute',
      'a\\b',
      'x:stream',
      'a//b',
    ])
      assert.throws(() => safeChild(t.root, name), {
        code: 'LOCAL_PATH_NOT_AUTHORIZED',
      });
  });
  const p = layout({ scope: 'source', runId: newRunId() });
  const headers = {
    host: '127.0.0.1:5197',
    origin: 'http://127.0.0.1:5197',
    'content-type': 'application/json',
  };
  await test('D2 HTTP origin/host/body boundary and spoofed forwarding', () => {
    assert.doesNotThrow(() =>
      checkRequest(
        { method: 'POST', url: '/api/auth/local-session', headers },
        p,
      ),
    );
    assert.doesNotThrow(() =>
      checkRequest(
        { method: 'GET', url: '/', headers: { host: headers.host } },
        p,
      ),
    );
    for (const change of [
      { origin: 'null' },
      { origin: 'https://evil.invalid' },
      { origin: undefined },
      { host: 'evil.invalid', 'x-forwarded-host': headers.host },
      { 'content-type': 'text/plain' },
    ])
      assert.throws(() =>
        checkRequest(
          {
            method: 'POST',
            url: '/api/auth/local-session',
            headers: { ...headers, ...change },
          },
          p,
        ),
      );
    assert.throws(() =>
      checkRequest(
        { method: 'GET', url: '/ws/web?token=old', headers },
        p,
        true,
      ),
    );
    assert.throws(() =>
      checkRequest({ method: 'GET', url: '/ws/bridge', headers }, p, true),
    );
  });
  const verifier = await createVerifier(syntheticKey);
  await test('D2 cookie parsing rejects duplicate, malformed and foreign IDs', () => {
    assert.equal(
      cookieId('pfc_local_session=' + 'a'.repeat(43)),
      'a'.repeat(43),
    );
    assert.equal(cookieId('pfc_local_session=a; pfc_local_session=b'), null);
    assert.equal(cookieId('pfc_local_session=bad'), null);
  });
  await test('D2 opaque session lifetime/idle expiry, logout and close callbacks', async () => {
    const c = clock(),
      s = createStore({ verifier, identity, now: c.now });
    const a = await s.login(syntheticKey);
    assert.equal(s.get(a.id).claims.sub, identity.name);
    let closed = 0;
    s.attach(a.id, () => closed++);
    c.advance(30 * 60000);
    assert.equal(s.get(a.id), null);
    assert.equal(closed, 1);
    const b = await s.login(syntheticKey);
    for (let i = 0; i < 16; i++) {
      c.advance(29 * 60000);
      assert.ok(s.get(b.id, true));
    }
    c.advance(16 * 60000);
    assert.equal(s.get(b.id), null);
    const d = await s.login(syntheticKey);
    s.attach(d.id, () => closed++);
    s.remove(d.id);
    assert.equal(s.get(d.id), null);
    assert.equal(closed, 2);
    s.close();
  });
  await test('D2 four-session ceiling, bounded login failures and one verifier at a time', async () => {
    const c = clock(),
      s = createStore({ verifier, identity, now: c.now });
    for (let i = 0; i < 4; i++) await s.login(syntheticKey);
    await assert.rejects(s.login(syntheticKey), { code: 'SESSION_LIMIT' });
    s.close();
    const f = createStore({ verifier, identity, now: c.now });
    for (let i = 0; i < 5; i++)
      await assert.rejects(f.login('z'.repeat(43)), {
        code: 'LOCAL_LOGIN_FAILED',
      });
    await assert.rejects(f.login(syntheticKey), { code: 'LOGIN_RATE_LIMIT' });
    c.advance(60000);
    const first = f.login(syntheticKey);
    await assert.rejects(f.login(syntheticKey), { code: 'LOGIN_BUSY' });
    await first;
    f.close();
  });
  await test('D2 closing while a key is being verified cannot create a surviving session', async () => {
    const s = createStore({ verifier, identity });
    const pending = s.login(syntheticKey);
    s.close();
    await assert.rejects(pending, { code: 'LOCAL_SESSION_CLOSED' });
    await assert.rejects(s.login(syntheticKey), {
      code: 'LOCAL_SESSION_CLOSED',
    });
  });
  report.status = 'PASS';
} catch (e) {
  report.error = {
    code: e.code || 'ASSERTION',
    message:
      e.code === 'MODULE_NOT_FOUND'
        ? 'Local-use implementation missing (expected initial TDD failure)'
        : String(e.message).slice(0, 500),
  };
  process.exitCode = 1;
} finally {
  mkdirSync(out, { recursive: true });
  writeFileSync(
    out + '/model-' + Date.now() + '.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
