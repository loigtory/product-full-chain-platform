import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import net from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fixture, gate, prepareChain } from './test-data/local-use-fixture.mjs';
const require = createRequire(import.meta.url);
const { preflight, metadata } = require('./src/local/preflight');
const { acquire } = require('./src/local/workspace-lock');
const { backup, verify, snapshot } = require('./src/local/backup');
const { restoreCheck, checkToc } = require('./src/local/restore-check');
const lifecycle = require('./src/local/lifecycle');
const { atomicJson } = require('./src/local/ops-files');
await gate('ops', async (report, test) => {
  const f = await fixture({ initialize: false });
  let oldCookie, completed;
  try {
    report.runId = f.target.runId;
    await test('L01 readonly preflight and unknown pre-existing root refused', async () => {
      assert.equal(
        (await preflight(f.target)).status,
        'INITIALIZATION_REQUIRED',
      );
      assert.equal(await metadata(f.target), null);
      assert.equal(fs.existsSync(f.target.root), false);
      fs.mkdirSync(f.target.root, { recursive: true });
      await assert.rejects(f.initialize(), { code: 'LOCAL_TARGET_EXISTS' });
      fs.rmdirSync(f.target.root);
    });
    await test('L02 phased interruption resumes same attempt/OID without duplicate owner', async () => {
      for (const phase of ['schema', 'migration', 'owner']) {
        await assert.rejects(f.initialize({ failAfter: phase }), {
          code: 'SYNTHETIC_INITIALIZATION_INTERRUPTED',
        });
        assert.equal(
          (await preflight(f.target)).status,
          'INITIALIZATION_INCOMPLETE',
        );
      }
      const { read } = require('./src/local/profile'),
        initial = read(f.target.profileFile, false);
      await f.initialize();
      assert.equal(f.profile.ownedOid, initial.ownedOid);
      assert.equal(f.profile.attemptId, initial.attemptId);
      const key = f.key;
      assert.equal((await f.initialize()).status, 'ALREADY_INITIALIZED');
      assert.equal(f.key, key);
    });
    await test('L03 workspace lock excludes parallel start/initialize/backup', async () => {
      const lock = await acquire(f.profile);
      try {
        await assert.rejects(f.initialize(), { code: 'LOCAL_WORKSPACE_BUSY' });
        await assert.rejects(backup(f.profile), {
          code: 'LOCAL_WORKSPACE_BUSY',
        });
      } finally {
        await lock.release();
      }
      await f.start();
      await assert.rejects(f.start(), { code: 'LOCAL_ALREADY_RUNNING' });
      await assert.rejects(backup(f.profile), { code: 'LOCAL_WORKSPACE_BUSY' });
      oldCookie = await f.login();
    });
    await test('L09 deterministic complete history and 100 requirements / 200 originals', async () => {
      report.chain = await prepareChain(f);
      report.volume = await f.volume(100);
      assert.equal(
        (
          await f.pool.query(
            'SELECT count(*) n FROM "' + f.target.schema + '".file_objects',
          )
        ).rows[0].n,
        '200',
      );
      await f.stop();
    });
    await test('L06/L10 wrong OID/process identity and occupied API port fail without touching foreign target', async () => {
      const stored = fs.readFileSync(f.target.profileFile);
      try {
        atomicJson(f.target.profileFile, {
          ...JSON.parse(stored),
          ownedOid: f.profile.ownedOid + 1,
        });
        assert.equal(
          (await preflight(f.target)).code,
          'LOCAL_OWNERSHIP_MISMATCH',
        );
      } finally {
        fs.writeFileSync(f.target.profileFile, stored);
      }
      atomicJson(f.profile.instanceFile, {
        profileFile: f.profile.profileFile,
        port: 5197,
        id: randomUUID(),
        secret: 'x'.repeat(43),
        pid: process.pid,
        exe: process.execPath,
        started: 'invalid',
      });
      try {
        await assert.rejects(lifecycle.stop(f.profile), {
          code: 'LOCAL_PROCESS_IDENTITY_MISMATCH',
        });
      } finally {
        fs.unlinkSync(f.profile.instanceFile);
      }
      const other = net.createServer();
      try {
        other.listen(5197, '127.0.0.1');
        await once(other, 'listening');
        await assert.rejects(f.start(), { code: 'LOCAL_PORT_OCCUPIED' });
        assert.equal(other.listening, true);
      } finally {
        await new Promise((ok) => other.close(ok));
      }
    });
    await test('L05 cold backup rejects missing/tampered originals and interrupted package', async () => {
      const snap = await snapshot(f.profile),
        file = resolve(f.profile.filesRoot, snap.references[0].path),
        bytes = fs.readFileSync(file);
      fs.unlinkSync(file);
      try {
        await assert.rejects(backup(f.profile), {
          code: 'LOCAL_BACKUP_FILES_MISMATCH',
        });
      } finally {
        fs.writeFileSync(file, bytes);
      }
      fs.writeFileSync(file, 'corrupt');
      try {
        await assert.rejects(backup(f.profile), {
          code: 'LOCAL_BACKUP_FILES_MISMATCH',
        });
      } finally {
        fs.writeFileSync(file, bytes);
      }
      await assert.rejects(backup(f.profile, { failAfter: 'dump' }), {
        code: 'SYNTHETIC_BACKUP_INTERRUPTED',
      });
      assert.equal(
        fs
          .readdirSync(f.profile.backupsRoot)
          .filter((x) => x.endsWith('.partial')).length,
        1,
      );
      completed = await backup(f.profile);
      report.backup = completed;
      assert.equal(completed.files, 200);
    });
    await test('L06 modified manifest/dump and unsafe object list rejected before restore', async () => {
      const good = verify(f.profile, completed.id),
        path = resolve(good.folder, 'manifest.json'),
        bytes = fs.readFileSync(path);
      fs.writeFileSync(path, '{}');
      try {
        assert.throws(() => verify(f.profile, completed.id), {
          code: 'LOCAL_BACKUP_MANIFEST_MISMATCH',
        });
      } finally {
        fs.writeFileSync(path, bytes);
      }
      const dump = resolve(good.folder, 'database.dump'),
        original = fs.readFileSync(dump);
      fs.appendFileSync(dump, 'corrupt');
      try {
        assert.throws(() => verify(f.profile, completed.id), {
          code: 'LOCAL_BACKUP_CONTENT_MISMATCH',
        });
      } finally {
        fs.writeFileSync(dump, original);
      }
      assert.throws(
        () =>
          checkToc(
            '1; 0 0 EXTENSION public unsafe pfc_app_local',
            good.manifest,
          ),
        { code: 'LOCAL_RESTORE_OBJECT_FORBIDDEN' },
      );
    });
    await test('L10 occupied restore port leaves listener intact; interrupted restore cleans owned cluster', async () => {
      const other = net.createServer();
      try {
        other.listen(5548, '127.0.0.1');
        await once(other, 'listening');
        await assert.rejects(restoreCheck(f.profile, completed.id), {
          code: 'LOCAL_RESTORE_PORT_OCCUPIED',
        });
        assert.equal(other.listening, true);
      } finally {
        await new Promise((ok) => other.close(ok));
      }
      await assert.rejects(
        restoreCheck(f.profile, completed.id, { failAfter: 'restore' }),
        { code: 'SYNTHETIC_RESTORE_INTERRUPTED' },
      );
      assert.equal(await require('./src/local/preflight').portFree(5548), true);
      assert.equal(await require('./src/local/preflight').portFree(5198), true);
      assert.equal(
        fs.readdirSync(resolve(f.target.root, '../../restore')).length,
        0,
      );
      assert.equal(verify(f.profile, completed.id).manifest.status, 'COMPLETE');
    });
    await test('L07 independent 5548 cold restore / API readback / new key / original byte equality / cleanup after interruption', async () => {
      report.restore = await restoreCheck(f.profile, completed.id, {
        oldCookie,
      });
      assert.equal(report.restore.requirements, 100);
      assert.equal(report.restore.downloads, 200);
      assert.ok(
        report.restore.timings.clusterStart < 20000,
        'pg_ctl must not inherit daemon output pipes',
      );
    });
  } finally {
    report.cleanup = await f.cleanup();
  }
});
