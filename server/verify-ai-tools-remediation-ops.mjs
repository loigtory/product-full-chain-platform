import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  databaseFixture,
  profileFixture,
  reportFor,
  scenario,
  saveReport,
  hash,
  patched,
} from './test-data/ai-tools-remediation-fixture.mjs';
const require = createRequire(import.meta.url);
const report = reportFor(
  '46 local operational compatibility; 006 and 007 synthetic cold backup and isolated 5549 recovery',
);
for (const version of ['006', '007']) {
  let f, p;
  try {
    f = await databaseFixture('ops', version);
    await require('./src/persistence/migrations').migrate(f.db);
    const seed = await f.seed();
    p = await profileFixture(f, seed);
    const backup = require('./src/local/backup');
    await patched(
      require('./src/runtime'),
      'db',
      () => f.db,
      () =>
        patched(
          require('./src/runtime'),
          'config',
          () => ({ filesRoot: p.profile.filesRoot, quota: 104857600 }),
          () =>
            require('./src/access').run(seed.ctx, () =>
              require('./src/domain/material-service').addMaterial(
                seed.req.public_id,
                {
                  commandId: randomUUID(),
                  expectedRevision: seed.req.revision,
                  name: 'CODEx_TEST_backup.txt',
                  usage: 'attachment',
                  file: {
                    name: 'CODEx_TEST_backup.txt',
                    encoding: 'base64',
                    mimeType: 'text/plain',
                    content: Buffer.from(
                      'CODEx_TEST_合成备份文件：提前7天提醒一次',
                    ).toString('base64'),
                  },
                },
              ),
            ),
        ),
    );
    if (version === '007')
      await require('./src/persistence/transaction').withTransaction(
        f.db,
        async (c) => {
          const jobs = require('./src/persistence/agent-jobs'),
            job = await jobs.enqueue(c, f.db, seed.ctx, seed.req, {
              kind: 'TEXT',
              commandId: randomUUID(),
              inputHash: 'a'.repeat(64),
              input: { content: 'CODEx_TEST_historical_job' },
            }),
            owner = randomUUID();
          await jobs.claimById(c, f.db, job.id, owner);
          await jobs.finish(
            c,
            f.db,
            job.id,
            owner,
            'FAILED',
            null,
            'SYNTHETIC_BACKUP_HISTORY',
          );
        },
      );
    await scenario(
      report,
      version +
        ' preflight and cold backup use the exact verified migration version',
      async () => {
        const check = await require('./src/local/preflight').preflight(
          p.profile,
        );
        assert.equal(check.status, 'READY');
        assert.equal(check.schemaVersion, version);
        const result = await backup.backup(p.profile);
        assert.equal(result.status, 'COMPLETE');
        const pack = backup.verify(p.profile, result.id);
        assert.equal(pack.manifest.migrations.length, Number(version));
        const before = hash(JSON.stringify(await backup.snapshot(p.profile)));
        const restored =
          await require('./src/local/restore-check').restoreCheck(
            p.profile,
            result.id,
          );
        assert.equal(restored.downloads, 1);
        assert.equal(restored.status, 'PASS');
        assert.equal(restored.port, 5549);
        assert.equal(restored.cleanup, 'PASS');
        assert.equal(
          hash(JSON.stringify(await backup.snapshot(p.profile))),
          before,
        );
        assert.equal(
          fs.existsSync(path.resolve(p.profile.root, '../restore')),
          false,
        );
        return { backupId: result.id, ...restored };
      },
    );
    await scenario(
      report,
      version + ' corrupted backup is refused before restoration',
      async () => {
        const item = backup.latest(p.profile);
        assert.ok(item);
        const verified = backup.verify(p.profile, item.id),
          file = path.join(verified.folder, 'manifest.json'),
          before = fs.readFileSync(file);
        try {
          fs.writeFileSync(file, Buffer.concat([before, Buffer.from(' ')]));
          assert.throws(() => backup.verify(p.profile, item.id), {
            code: 'LOCAL_BACKUP_MANIFEST_MISMATCH',
          });
        } finally {
          fs.writeFileSync(file, before);
        }
        assert.ok(backup.verify(p.profile, item.id));
      },
    );
  } catch (e) {
    report.errors.push({ version, code: e.code || e.message });
  } finally {
    try {
      if (p) await p.cleanup();
    } catch (e) {
      report.errors.push({ cleanup: e.code || e.message });
    }
    try {
      if (f) {
        const cleanup = await f.cleanup();
        report.cleanups ??= [];
        report.cleanups.push(cleanup);
      }
    } catch (e) {
      report.errors.push({ cleanup: e.code || e.message });
    }
  }
}
report.cleanup = {
  status:
    report.cleanups?.length === 2 && !report.errors.some((x) => x.cleanup)
      ? 'PASS'
      : 'FAIL',
};
saveReport(report, 'ops');
