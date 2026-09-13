import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { fixture, gate, prefix } from './test-data/local-use-fixture.mjs';
const require = createRequire(import.meta.url),
  WS = require('ws');
await gate('api', async (report, test) => {
  const f = await fixture();
  let cookie;
  try {
    report.runId = f.target.runId;
    await f.start();
    await test('D1 empty single owner, static exact allowlist, fixed same-origin bootstrap', async () => {
      const h = await (await f.request('/api/health')).json();
      assert.equal(h.profile, 'personal');
      assert.equal(h.realTools, false);
      const html = await (await f.request('/')).text();
      assert.match(html, /local-config.js/);
      for (const path of [
        '/server/src/index.js',
        '/original/../../server/src/index.js',
        '/profile.json',
        '/.env.local',
      ])
        assert.equal((await f.request(path)).status, 404);
      const js = await (await f.request('/local-config.js')).text();
      assert.match(js, /PFC_DATA_MODE.*api/);
      assert.equal((await f.request('/api/reqs')).status, 401);
      const r = await f.request('/api/auth/local-session', {
        method: 'POST',
        body: { key: f.key },
      });
      assert.equal(r.status, 200);
      const set = r.headers.get('set-cookie');
      assert.match(set, /HttpOnly; SameSite=Strict; Path=\//);
      assert.doesNotMatch(set, /Domain=|Max-Age=|Expires=|Secure/);
      cookie = set.split(';')[0];
      const status = await (
        await f.request('/api/local-status', { cookie })
      ).json();
      assert.equal(status.storage, 'pg');
      assert.equal(status.files.readable, true);
      assert.equal(status.files.count, 0);
      assert.equal(status.lastBackup, null);
      assert.match(status.sourceCommit, /^[a-f0-9]{40}$/);
      assert.equal(JSON.stringify(status).includes(f.key), false);
      assert.equal(
        (await (await f.request('/api/reqs', { cookie })).json()).items.length,
        0,
      );
      assert.equal(
        (
          await f.pool.query(
            'SELECT count(*) n FROM "' + f.target.schema + '".members',
          )
        ).rows[0].n,
        '1',
      );
    });
    await test('D2 wrong origin, oversized/invalid JSON, old bearer and dev-login rejected', async () => {
      assert.equal(
        (await f.request('/api/auth/dev-login', { method: 'POST', body: {} }))
          .status,
        403,
      );
      assert.equal(
        (
          await f.request('/api/auth/me', {
            headers: { Authorization: 'Bearer legacy' },
          })
        ).status,
        401,
      );
      for (const origin of [
        'null',
        'https://evil.invalid',
        'http://127.0.0.1:5198',
      ])
        assert.equal(
          (
            await f.request('/api/auth/local-session', {
              method: 'POST',
              headers: { Origin: origin },
              body: { key: f.key },
            })
          ).status,
          403,
        );
      assert.equal(
        (
          await f.request('/api/auth/local-session', {
            method: 'POST',
            body: { key: 'a'.repeat(5000) },
          })
        ).status,
        413,
      );
      assert.equal(
        (
          await f.request('/api/auth/local-session', {
            method: 'POST',
            body: '{',
          })
        ).status,
        400,
      );
    });
    await test('D2 cookie WS, logout revokes socket and live membership, fresh login', async () => {
      const ws = new WS(f.base.replace('http', 'ws') + '/ws/web', {
        headers: { Origin: f.base, Cookie: cookie },
      });
      await once(ws, 'open');
      const closed = once(ws, 'close');
      await f.request('/api/auth/local-session', {
        method: 'DELETE',
        cookie,
        body: {},
      });
      await closed;
      assert.equal((await f.request('/api/auth/me', { cookie })).status, 401);
      cookie = await f.login();
      await f.pool.query(
        'INSERT INTO "' +
          f.target.schema +
          '".members(id,tenant_id,public_id,name,role) VALUES(gen_random_uuid(),$1,$2,$3,$4)',
        [f.profile.tenantId, 'M-2', prefix + '_second_owner', 'owner'],
      );
      await f.pool.query(
        'UPDATE "' +
          f.target.schema +
          '".members SET active=false,disabled_at=now() WHERE id=$1',
        [f.profile.memberId],
      );
      assert.equal((await f.request('/api/auth/me', { cookie })).status, 403);
      await f.pool.query(
        'UPDATE "' +
          f.target.schema +
          '".members SET active=true,disabled_at=NULL WHERE id=$1',
        [f.profile.memberId],
      );
      await f.pool.query(
        'DELETE FROM "' + f.target.schema + '".members WHERE public_id=$1',
        ['M-2'],
      );
      assert.equal((await f.request('/api/auth/me', { cookie })).status, 200);
    });
    await test('D4 persisted requirement survives restart; old cookie cannot resume', async () => {
      const r = await f.request('/api/reqs', {
        method: 'POST',
        cookie,
        body: {
          name: prefix + '_restart',
          goal: '合成需求重启读回',
          scope: '本地测试',
          commandId: prefix + '_create',
        },
      });
      assert.equal(r.status, 201);
      const body = await r.json();
      f.createdIds.push(body.req.id);
      await f.stop();
      await f.start();
      assert.equal((await f.request('/api/auth/me', { cookie })).status, 401);
      cookie = await f.login();
      assert.equal(
        (await (await f.request('/api/reqs', { cookie })).json()).items.length,
        1,
      );
    });
    await test('L11 exact 10 MiB originals and 100 MiB quota accept boundaries and reject overflow without residue', async () => {
      const id = f.createdIds[0];
      const oversized = await f.uploadBytes(
        id,
        Buffer.alloc(10485761, 91),
        'oversize',
        413,
      );
      assert.equal(oversized.error.code, 'FILE_TOO_LARGE');
      for (let n = 0; n < 10; n++)
        await f.uploadBytes(id, Buffer.alloc(10485760, n + 1), 'boundary-' + n);
      const overQuota = await f.uploadBytes(
        id,
        Buffer.from('CODEx_TEST_overflow'),
        'overflow',
        413,
      );
      assert.equal(overQuota.error.code, 'FILE_QUOTA_EXCEEDED');
      const status = await (
        await f.request('/api/local-status', { cookie })
      ).json();
      assert.equal(status.files.count, 10);
      assert.equal(status.files.bytes, 104857600);
      assert.equal(status.files.readable, true);
      report.capacity = {
        originalLimitBytes: 10485760,
        quotaBytes: 104857600,
        overflowRejected: true,
        originalCount: 10,
      };
    });
  } finally {
    report.cleanup = await f.cleanup();
  }
});
