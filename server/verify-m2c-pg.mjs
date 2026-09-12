import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import net from 'node:net';
import {
  fixture,
  context,
  secondContext,
  schema,
  runId,
  config,
} from './test-data/m2c-pg-fixture.mjs';

const require = createRequire(import.meta.url);
const results = [],
  observations = [];
const evidence = resolve(
  '.local/m2c-1-storage-20260912/pg-' +
    new Date().toISOString().replace(/[:.]/g, '-'),
);
mkdirSync(evidence, { recursive: true });
let f,
  cleanup,
  phase = 'load-storage-contract';
const check = async (name, fn) => {
  phase = name;
  await fn();
  results.push({ name, status: 'PASS' });
  console.log(JSON.stringify(results.at(-1)));
};
const code = (e) =>
  /^[A-Z_0-9]{2,60}$/.test(e.code || '') ? e.code : 'ASSERTION_OR_TEST_FAILED';
try {
  const {
    openDatabase,
    validateTarget,
  } = require('./src/persistence/connection');
  const { migrate, baseline } = require('./src/persistence/migrations');
  const { withTransaction } = require('./src/persistence/transaction');
  const repo = require('./src/persistence/requirements');
  const { resolveIdentifier } = require('./src/persistence/identifiers');
  await check('target-rejected-before-side-effects', async () => {
    for (const bad of [
      { schema: 'pfc' },
      { schema: 'public' },
      { authorizedSchema: schema + '_other' },
      { schema: schema + '";DROP SCHEMA pfc' },
      { connectionString: '' },
      {
        connectionString: 'postgresql://user:secret@external.invalid/pfc_local',
      },
      {
        connectionString:
          'postgresql://user:secret@127.0.0.1/pfc_local?host=external.invalid',
      },
      { connectionString: 'postgresql://user:secret@127.0.0.1/other_db' },
    ]) {
      assert.throws(() => validateTarget({ ...config(), ...bad }));
    }
    await assert.rejects(openDatabase({ ...config(), mode: 'auto' }), {
      code: 'MODE_REQUIRED',
    });
    const memory = await openDatabase({ mode: 'memory' });
    assert.equal(memory.mode, 'memory');
    assert.equal(memory.pool, undefined);
    await memory.close();
  });
  f = await fixture();
  const { db, admin, options } = f;
  await check('connect-does-not-migrate-and-readiness-fails', async () => {
    await assert.rejects(openDatabase(options), {
      code: 'MIGRATION_NOT_READY',
    });
    assert.equal(
      (
        await admin.query('SELECT * FROM pg_tables WHERE schemaname=$1', [
          schema,
        ])
      ).rowCount,
      0,
    );
  });
  await check('versioned-migration-repeat-and-checksum', async () => {
    assert.equal((await migrate(db)).applied, true);
    assert.equal((await migrate(db)).applied, false);
    const ready = await openDatabase(options);
    await ready.close();
    const old = baseline();
    await admin.query(`UPDATE "${schema}".schema_migrations SET checksum=$1`, [
      '0'.repeat(64),
    ]);
    await assert.rejects(migrate(db), { code: 'MIGRATION_CHECKSUM_MISMATCH' });
    await assert.rejects(openDatabase(options), {
      code: 'MIGRATION_CHECKSUM_MISMATCH',
    });
    await admin.query(`UPDATE "${schema}".schema_migrations SET checksum=$1`, [
      old.checksum,
    ]);
    await admin.query(
      `INSERT INTO "${schema}".tenants(id,name) VALUES($1,$2),($3,$4)`,
      [context.tenantId, runId + '_A', secondContext.tenantId, runId + '_B'],
    );
    f.createdIds.push(context.tenantId, secondContext.tenantId);
  });
  await check(
    'readiness-detects-missing-table-despite-migration-ledger',
    async () => {
      await admin.query(
        `ALTER TABLE "${schema}".audit_logs RENAME TO audit_logs_hidden`,
      );
      try {
        // Keep the returned pool closeable even if this assertion exposes a bug.
        let unexpected;
        try {
          await assert.rejects(
            async () => {
              unexpected = await openDatabase(options);
            },
            { code: 'MIGRATION_NOT_READY' },
          );
        } finally {
          await unexpected?.close();
        }
      } finally {
        await admin.query(
          `ALTER TABLE "${schema}".audit_logs_hidden RENAME TO audit_logs`,
        );
      }
    },
  );
  let req;
  await check(
    'requirement-version-audit-independent-sql-readback',
    async () => {
      req = await repo.createRequirement(db, context, {
        name: runId + '_valid',
        goal: '合成提醒',
        scope: '仅隔离验证',
        content: { title: '提醒草案' },
      });
      f.createdIds.push(req.requirement.id);
      assert.match(req.requirement.public_id, /^R-\d+$/);
      const sql = (
        await admin.query(
          `SELECT r.id,r.public_id,v.content,a.actor FROM "${schema}".reqs r
      JOIN "${schema}".req_versions v ON v.req_id=r.id AND v.tenant_id=r.tenant_id
      JOIN "${schema}".audit_logs a ON a.req_id=r.id AND a.tenant_id=r.tenant_id WHERE r.id=$1`,
          [req.requirement.id],
        )
      ).rows;
      assert.equal(sql.length, 1);
      assert.equal(sql[0].public_id, req.requirement.public_id);
      assert.deepEqual(sql[0].content, { title: '提醒草案' });
      assert.equal(sql[0].actor, runId);
    },
  );
  await check(
    'rollback-removes-requirement-version-audit-and-counter-change',
    async () => {
      const counters = (
        await admin.query(
          `SELECT * FROM "${schema}".id_counters ORDER BY tenant_id,entity`,
        )
      ).rows;
      await assert.rejects(
        repo.createRequirement(db, context, {
          name: runId + '_invalid',
          content: [],
        }),
        { code: '23514' },
      );
      assert.equal(
        (
          await admin.query(`SELECT * FROM "${schema}".reqs WHERE name=$1`, [
            runId + '_invalid',
          ])
        ).rowCount,
        0,
      );
      assert.deepEqual(
        (
          await admin.query(
            `SELECT * FROM "${schema}".id_counters ORDER BY tenant_id,entity`,
          )
        ).rows,
        counters,
      );
      const retried = await repo.createRequirement(db, context, {
        name: runId + '_retry',
        content: { valid: true },
      });
      assert.equal(retried.versions.length, 1);
      assert.equal(retried.audit.length, 1);
      f.createdIds.push(retried.requirement.id);
    },
  );
  await check(
    'concurrent-identifiers-and-version-conflict-are-atomic',
    async () => {
      const pair = await Promise.all(
        [1, 2].map((n) =>
          repo.createRequirement(db, context, {
            name: runId + '_parallel_' + n,
          }),
        ),
      );
      assert.notEqual(
        pair[0].requirement.public_id,
        pair[1].requirement.public_id,
      );
      f.createdIds.push(...pair.map((r) => r.requirement.id));
      const versions = await Promise.allSettled(
        [1, 2].map(() =>
          repo.addVersion(db, context, req.requirement.public_id, {
            stage: 'idea',
            version: 2,
            content: {},
          }),
        ),
      );
      assert.equal(versions.filter((v) => v.status === 'fulfilled').length, 1);
      assert.equal(
        versions.find((v) => v.status === 'rejected').reason.code,
        '23505',
      );
      const loaded = await repo.getRequirement(
        db,
        context,
        req.requirement.public_id,
      );
      assert.equal(loaded.versions.length, 2);
      assert.equal(loaded.audit.length, 2);
    },
  );
  await check('tenant-identity-mapping-and-foreign-keys', async () => {
    assert.equal(
      await repo.getRequirement(db, secondContext, req.requirement.public_id),
      null,
    );
    const other = await repo.createRequirement(db, secondContext, {
      name: runId + '_other_tenant',
    });
    f.createdIds.push(other.requirement.id);
    assert.equal(other.requirement.public_id, req.requirement.public_id);
    assert.notEqual(other.requirement.id, req.requirement.id);
    assert.equal(
      (
        await repo.getRequirement(
          db,
          secondContext,
          other.requirement.public_id,
        )
      ).requirement.name,
      runId + '_other_tenant',
    );
    await withTransaction(db, async (client) => {
      assert.equal(
        await resolveIdentifier(
          client,
          db,
          context.tenantId,
          'req_versions',
          req.requirement.public_id,
        ),
        null,
      );
    });
    await assert.rejects(
      repo.addVersion(db, context, 'R-999999', {
        stage: 'idea',
        version: 2,
        content: {},
      }),
      { code: 'REQ_NOT_FOUND' },
    );
    await assert.rejects(
      admin.query(
        `INSERT INTO "${schema}".req_versions(id,tenant_id,req_id,public_id,stage,version,content)
      VALUES('30000000-0000-4000-8000-000000000001',$1,$2,'SV-invalid','idea',9,'{}')`,
        [secondContext.tenantId, req.requirement.id],
      ),
      { code: '23503' },
    );
  });
  await check(
    'independent-process-restart-preserves-identifiers-and-records',
    async () => {
      const path = fileURLToPath(
        new URL('./test-data/m2c-pg-fixture.mjs', import.meta.url),
      );
      const exec = (args) =>
        JSON.parse(
          execFileSync(process.execPath, [path, ...args], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 1024 * 1024,
          }),
        );
      const a = exec(['write']);
      const b = exec(['read', a.result.requirement.public_id]);
      assert.notEqual(a.pid, b.pid);
      assert.deepEqual(b.result, a.result);
      observations.push({
        scenario: 'restart',
        writerPid: a.pid,
        readerPid: b.pid,
        publicId: b.result.requirement.public_id,
        uuid: b.result.requirement.id,
      });
      assert.equal(b.result.versions.length, 1);
      assert.equal(b.result.audit.length, 1);
      f.createdIds.push(b.result.requirement.id);
    },
  );
  await check(
    'connection-and-sql-timeouts-fail-without-memory-fallback',
    async () => {
      const listener = net.createServer();
      await new Promise((r) => listener.listen(0, '127.0.0.1', r));
      const port = listener.address().port;
      await new Promise((r) => listener.close(r));
      const badUrl = new URL(options.connectionString);
      badUrl.port = String(port);
      await assert.rejects(
        openDatabase({ ...options, connectionString: badUrl.href }),
        { code: 'PG_CONNECT_FAILED' },
      );
      const bounded = await openDatabase({
        ...options,
        statementTimeoutMs: 100,
      });
      try {
        await assert.rejects(
          withTransaction(bounded, (c) => c.query('SELECT pg_sleep(1)')),
          { code: '57014' },
        );
      } finally {
        await bounded.close();
      }
      assert.equal((await db.pool.query('SELECT 1 n')).rows[0].n, 1);
    },
  );
  await check(
    'cli-refuses-unapproved-target-and-repeats-migration',
    async () => {
      const cli = fileURLToPath(
        new URL('./scripts/migrate-m2c.mjs', import.meta.url),
      );
      const env = {
        ...process.env,
        DATABASE_URL: options.connectionString,
        PFC_M2C_AUTHORIZED_SCHEMA: schema,
      };
      assert.throws(() =>
        execFileSync(process.execPath, [cli, '--schema', 'pfc'], {
          env,
          windowsHide: true,
          timeout: 10000,
          stdio: 'pipe',
        }),
      );
      const result = JSON.parse(
        execFileSync(process.execPath, [cli, '--schema', schema], {
          env,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000,
        }),
      );
      assert.equal(result.applied, false);
    },
  );
  await check(
    'storage-does-not-depend-on-memory-domain-or-change-app-entry',
    async () => {
      for (const file of [
        'connection',
        'transaction',
        'identifiers',
        'requirements',
        'migrations',
      ]) {
        const source = readFileSync(
          new URL('./src/persistence/' + file + '.js', import.meta.url),
          'utf8',
        );
        assert.doesNotMatch(
          source,
          /domain\/store|\.\.\/db|app_state|seedFromState|new Map\(/,
        );
      }
      for (const file of ['index', 'db', 'ws', 'domain/service']) {
        assert.doesNotMatch(
          readFileSync(
            new URL('./src/' + file + '.js', import.meta.url),
            'utf8',
          ),
          /require\([^)]*persistence\//,
        );
      }
    },
  );
} catch (e) {
  results.push({ name: phase, status: 'FAIL', code: code(e) });
} finally {
  if (f)
    try {
      cleanup = await f.cleanup();
      results.push({ name: 'cleanup-independent-readback', status: 'PASS' });
    } catch (e) {
      cleanup = { schema, status: 'FAILED', code: code(e) };
      results.push({
        name: 'cleanup-independent-readback',
        status: 'FAIL',
        code: code(e),
      });
    }
  const report = {
    status:
      results.length === 13 && results.every((r) => r.status === 'PASS')
        ? 'PASS'
        : 'FAIL',
    runId,
    results,
    observations,
    cleanup,
    evidence,
    scope:
      'isolated PostgreSQL components only; business API still memory; no external effects',
  };
  writeFileSync(
    resolve(evidence, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
