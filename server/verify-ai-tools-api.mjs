import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '007 persistence and queue; HTTP and browser integration pending',
  tests: [],
};
try {
  const { registry } = require('./src/persistence/migrations');
  const old = registry('006');
  const current = registry('007');
  assert.deepEqual(current.slice(0, 6), old);
  assert.equal(current.at(-1).version, '007');
  report.tests.push({
    name: '007 is additive; all six old checksums remain identical',
    status: 'PASS',
  });
  if (process.argv.includes('--pg')) {
    const { aiDatabaseFixture } =
      await import('./test-data/ai-tools-fixture.mjs');
    const f = await aiDatabaseFixture('api');
    try {
      const { migrate, assertReady } = require('./src/persistence/migrations');
      await migrate(f.db);
      await assertReady(f.db);
      report.tests.push({
        name: '007 isolated migration and independent readiness',
        status: 'PASS',
      });
      const { ctx, req } = await f.seed();
      const { withTransaction } = require('./src/persistence/transaction');
      const jobs = require('./src/persistence/agent-jobs');
      const events = require('./src/persistence/agent-events');
      const tx = (fn) => withTransaction(f.db, fn);
      const input = {
        commandId: 'CODEx_TEST_job',
        kind: 'TEXT',
        inputHash: 'a'.repeat(64),
        input: { content: 'CODEx_TEST_提前7天' },
      };
      await assert.rejects(
        tx(async (client) => {
          await jobs.enqueue(client, f.db, ctx, req, input);
          throw Error('ROLLBACK');
        }),
        /ROLLBACK/,
      );
      assert.equal(
        (
          await f.db.pool.query(
            `SELECT count(*) n FROM "${f.db.schema}".agent_jobs`,
          )
        ).rows[0].n,
        '0',
      );
      const job = await tx((c) => jobs.enqueue(c, f.db, ctx, req, input));
      assert.equal(
        (await tx((c) => jobs.enqueue(c, f.db, ctx, req, input))).id,
        job.id,
      );
      await assert.rejects(
        tx((c) =>
          jobs.enqueue(c, f.db, ctx, req, {
            ...input,
            inputHash: 'b'.repeat(64),
          }),
        ),
        { code: 'COMMAND_REUSED' },
      );
      assert.equal(
        await jobs.find(
          f.db.pool,
          f.db,
          { ...ctx, tenantId: randomUUID() },
          req.id,
          job.id,
        ),
        undefined,
      );
      report.tests.push({
        name: 'Domain and queued event rollback together; command idempotency and tenant isolation',
        status: 'PASS',
      });
      const ownerA = randomUUID(),
        ownerB = randomUUID();
      const claims = await Promise.all([
        tx((c) => jobs.claim(c, f.db, ownerA)),
        tx((c) => jobs.claim(c, f.db, ownerB)),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      const claimed = claims.find(Boolean),
        owner = claimed.owner_id;
      await assert.rejects(
        tx((c) => jobs.dispatch(c, f.db, job.id, randomUUID())),
        { code: 'AGENT_LEASE_LOST' },
      );
      await tx((c) => jobs.dispatch(c, f.db, job.id, owner));
      await assert.rejects(
        tx((c) => jobs.dispatch(c, f.db, job.id, owner)),
        { code: 'AGENT_REPLAY_FORBIDDEN' },
      );
      assert.deepEqual(await tx((c) => jobs.recover(c, f.db, owner)), [
        { id: job.id, state: 'UNKNOWN' },
      ]);
      assert.equal(await tx((c) => jobs.claim(c, f.db, owner)), null);
      await assert.rejects(
        tx((c) =>
          jobs.finish(c, f.db, job.id, owner, 'SUCCEEDED', { text: 'forged' }),
        ),
        { code: 'AGENT_LEASE_LOST' },
      );
      const replay = await events.list(f.db.pool, f.db, ctx, req.id, job.id, 0);
      assert.deepEqual(
        replay.map((e) => [e.sequence, e.type]),
        [
          [1, 'queued'],
          [2, 'started'],
          [3, 'unknown'],
        ],
      );
      assert.deepEqual(
        (await events.list(f.db.pool, f.db, ctx, req.id, job.id, 2)).map(
          (e) => e.sequence,
        ),
        [3],
      );
      assert.equal(
        (
          await events.list(
            f.db.pool,
            f.db,
            { ...ctx, tenantId: randomUUID() },
            req.id,
            job.id,
          )
        ).length,
        0,
      );
      report.tests.push({
        name: 'Concurrent workers claim once; dispatched jobs become UNKNOWN and cannot replay or accept stale results',
        status: 'PASS',
      });
      const next = await tx((c) =>
        jobs.enqueue(c, f.db, ctx, req, {
          ...input,
          commandId: 'CODEx_TEST_undispatched',
        }),
      );
      await tx((c) => jobs.claim(c, f.db, owner));
      assert.deepEqual(await tx((c) => jobs.recover(c, f.db, owner)), [
        { id: next.id, state: 'QUEUED' },
      ]);
      await tx((c) => jobs.claim(c, f.db, owner));
      await tx((c) => jobs.dispatch(c, f.db, next.id, owner));
      await tx((c) =>
        jobs.finish(c, f.db, next.id, owner, 'SUCCEEDED', {
          text: 'CODEx_TEST_verified',
        }),
      );
      await assert.rejects(
        tx((c) =>
          jobs.finish(c, f.db, next.id, owner, 'SUCCEEDED', { text: 'late' }),
        ),
        { code: 'AGENT_LEASE_LOST' },
      );
      await assert.rejects(
        f.db.pool.query(
          `UPDATE "${f.db.schema}".agent_jobs SET result='{}' WHERE id=$1`,
          [next.id],
        ),
        { code: '23514' },
      );
      await assert.rejects(
        f.db.pool.query(
          `UPDATE "${f.db.schema}".agent_events SET payload='{}' WHERE job_id=$1`,
          [next.id],
        ),
        { code: '23514' },
      );
      report.tests.push({
        name: 'Only undispatched work can requeue; terminal result and ordered evidence cannot be overwritten',
        status: 'PASS',
      });
      const materialRepo = require('./src/persistence/materials');
      const contextService = require('./src/agent/context-service');
      const extractionRepo = require('./src/persistence/material-extractions');
      const { extractMaterial } =
        await import('./src/agent/material-extractor.mjs');
      const material = await tx((c) =>
        materialRepo.create(c, f.db, ctx, req.id, {
          name: 'CODEx_TEST_rules.txt',
          content: 'CODEx_TEST_积分到期前7天提醒，同一会员同一到期日一次。',
          classification: '内部',
          allowed: true,
          usage: 'material',
          status: '已纳入',
        }),
      );
      const selection = { id: material.public_id, version: material.version };
      const source = await contextService.materialSource(
        f.db.pool,
        f.db,
        ctx,
        req,
        selection,
      );
      const parsed = await extractMaterial({
        bytes: await contextService.sourceBytes(ctx, source),
        extension: 'txt',
      });
      const extractionJob = await tx((c) =>
        jobs.enqueue(c, f.db, ctx, req, {
          ...input,
          kind: 'EXTRACT',
          commandId: 'CODEx_TEST_extract',
        }),
      );
      await tx((c) =>
        extractionRepo.save(c, f.db, extractionJob, source, parsed),
      );
      const selectedContext = await contextService.build(
        f.db.pool,
        f.db,
        ctx,
        req,
        { materials: [selection] },
        'c'.repeat(64),
      );
      assert.equal(
        selectedContext.snapshot.materials[0].segments[0].text,
        source.content,
      );
      const currentInput = {
        selection: { materials: [selection] },
        contextHash: selectedContext.hash,
        consentHash: selectedContext.hash,
      };
      await contextService.assertCurrent(
        f.db.pool,
        f.db,
        ctx,
        req,
        currentInput,
        'c'.repeat(64),
      );
      await assert.rejects(
        contextService.assertCurrent(
          f.db.pool,
          f.db,
          ctx,
          req,
          { ...currentInput, consentHash: '0'.repeat(64) },
          'c'.repeat(64),
        ),
        { code: 'AGENT_CONTEXT_CHANGED' },
      );
      await assert.rejects(
        contextService.materialSource(
          f.db.pool,
          f.db,
          { ...ctx, tenantId: randomUUID() },
          req,
          selection,
        ),
        { code: 'STALE_REFERENCE' },
      );
      await f.db.pool.query(
        `UPDATE "${f.db.schema}".materials SET allowed=false,status='只登记' WHERE id=$1`,
        [material.id],
      );
      await assert.rejects(
        contextService.assertCurrent(
          f.db.pool,
          f.db,
          ctx,
          req,
          currentInput,
          'c'.repeat(64),
        ),
        { code: 'STALE_REFERENCE' },
      );
      report.tests.push({
        name: 'Actual material parsing persists source/version/location; missing consent and revoked/cross-tenant references block',
        status: 'PASS',
      });
      const compatibility = [];
      try {
        await assert.rejects(
          require('./src/persistence/commands').command(
            f.db,
            { ...ctx, actor: f.runId + '_unregistered' },
            'CODEx_TEST_membership',
            { commandId: 'CODEx_TEST_unregistered' },
            async () => ({ forbiddenSideEffect: true }),
          ),
          { code: 'MEMBER_NOT_CONFIGURED' },
        );
        compatibility.push({
          name: '007 retains membership checks',
          status: 'PASS',
        });
      } catch {
        compatibility.push({
          name: '007 retains membership checks',
          status: 'FAIL',
          actual: 'Unregistered identity command accepted',
        });
      }
      try {
        await assert.rejects(
          require('./src/domain/release-guard').guard(
            null,
            f.db,
            ctx,
            { ...req, closed_at: new Date(), stage: 'observe' },
            'version.saved',
            {},
          ),
          { code: 'RELEASE_PHASE_LOCKED' },
        );
        compatibility.push({
          name: '007 retains closure protection',
          status: 'PASS',
        });
      } catch {
        compatibility.push({
          name: '007 retains closure protection',
          status: 'FAIL',
          actual: 'Closed requirement version write guard skipped',
        });
      }
      report.compatibility = compatibility;
      assert.equal(
        compatibility.filter((r) => r.status === 'FAIL').length,
        0,
        '007 must preserve existing authorization and closed-phase protections',
      );
    } finally {
      report.cleanup = await f.cleanup();
    }
  }
  report.status = 'PASS';
} catch (e) {
  report.error = {
    code: e.code ?? 'ASSERTION_FAILED',
    message: String(e.message).slice(0, 180),
  };
  process.exitCode = 1;
} finally {
  const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
  mkdirSync(root, { recursive: true });
  const file = `${root}/api-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      file,
      error: report.error,
    }),
  );
}
