import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  reportFor,
  scenario,
  saveReport,
  hostJobFixture,
  hash,
} from './test-data/ai-tools-host-exec-fixture.mjs';
process.env.PFC_HOST_EXEC_TEST_PACKAGE = '48';
const { databaseFixture } =
  await import('./test-data/ai-tools-remediation-fixture.mjs');
const require = createRequire(import.meta.url),
  report = reportFor('host-api-pg');
const { withTransaction: tx } = require('./src/persistence/transaction'),
  jobs = require('./src/persistence/agent-jobs');
let f;
const workspaces = [];
try {
  f = await databaseFixture('api');
  await require('./src/persistence/migrations').migrate(f.db);
  const db = f.db,
    s = db.schema;
  async function setup() {
    const x = await hostJobFixture(f, 'api');
    workspaces.push(x.wf);
    return x;
  }
  const call = (tool, args, id = randomUUID()) => ({
    requestId: 'request-' + id,
    threadId: 'thread',
    turnId: 'turn',
    callId: id,
    itemId: id,
    tool,
    arguments: args,
  });
  await scenario(
    report,
    'Owner file read/write persists approval and tool evidence, independently matched to file hash',
    async () => {
      const x = await setup(),
        before = fs.readFileSync(path.join(x.wf.workspace, 'example.txt'));
      const read = await x.dispatch(
        call('pfc_read_file', { path: 'example.txt' }),
      );
      assert.equal(read.success, true, JSON.stringify(read));
      const write = await x.dispatch(
        call('pfc_write_file', {
          path: 'example.txt',
          expectedHash: hash(before),
          content: 'synthetic approved write\n',
        }),
      );
      assert.equal(write.success, true, JSON.stringify(write));
      const rows = (
        await db.pool.query(
          `SELECT t.state,t.evidence,a.state approval_state FROM "${s}".tool_executions t JOIN "${s}".agent_approvals a ON a.id=t.approval_id WHERE t.job_id=$1 ORDER BY t.created_at`,
          [x.job.id],
        )
      ).rows;
      assert.equal(rows.length, 2);
      assert.ok(
        rows.every(
          (r) => r.state === 'SUCCEEDED' && r.approval_state === 'APPROVED',
        ),
      );
      assert.equal(
        rows[1].evidence.sha256,
        hash(fs.readFileSync(path.join(x.wf.workspace, 'example.txt'))),
      );
      assert.equal(
        JSON.stringify(rows).includes('synthetic approved write'),
        false,
      );
      x.scope.rollback();
      return {
        jobId: x.job.id,
        toolRows: rows.length,
        fileRestored:
          hash(before) ===
          hash(fs.readFileSync(path.join(x.wf.workspace, 'example.txt'))),
      };
    },
  );
  for (const kind of [
    'revoked',
    'viewer',
    'nonmember',
    'closed-phase',
    'cancelled',
    'expired-lease',
    'context-changed',
  ])
    await scenario(
      report,
      kind + ' refuses before filesystem effect',
      async () => {
        const x = await setup();
        if (kind === 'revoked') {
          const backupOwner = randomUUID();
          f.createdIds.push(backupOwner);
          await db.pool.query(
            `INSERT INTO "${s}".members(id,tenant_id,public_id,name,role,active) VALUES($1,$2,$3,$4,'owner',true)`,
            [
              backupOwner,
              x.ctx.tenantId,
              'MEM-' + backupOwner,
              'synthetic_backup_owner',
            ],
          );
          await tx(db, (c) =>
            c.query(
              `UPDATE "${s}".members SET active=false,disabled_at=now(),revision=revision+1 WHERE id=$1`,
              [x.ctx.memberId],
            ),
          );
        }
        if (kind === 'viewer')
          await db.pool.query(
            `UPDATE "${s}".members SET role='viewer' WHERE id=$1`,
            [x.ctx.memberId],
          );
        if (kind === 'nonmember') x.ctx.actor = 'unregistered';
        if (kind === 'closed-phase')
          await db.pool.query(
            `UPDATE "${s}".reqs SET stage='test' WHERE id=$1`,
            [x.req.id],
          );
        if (kind === 'cancelled')
          await tx(db, (c) =>
            jobs.requestCancel(c, db, x.ctx, x.req.id, x.job.id),
          );
        if (kind === 'expired-lease')
          await db.pool.query(
            `UPDATE "${s}".agent_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`,
            [x.job.id],
          );
        if (kind === 'context-changed')
          await tx(db, (c) =>
            c.query(
              `UPDATE "${s}".req_versions SET content=$1 WHERE req_id=$2`,
              [JSON.stringify({ goal: 'changed synthetic version' }), x.req.id],
            ),
          );
        const response = await x.dispatch(
          call('pfc_write_file', {
            path: 'new.txt',
            expectedHash: null,
            content: 'must not appear',
          }),
        );
        assert.equal(response.success, false);
        assert.equal(
          fs.existsSync(path.join(x.wf.workspace, 'new.txt')),
          false,
        );
        assert.equal(
          (
            await db.pool.query(
              `SELECT count(*)::int n FROM "${s}".tool_executions WHERE job_id=$1`,
              [x.job.id],
            )
          ).rows[0].n,
          0,
        );
        return {
          code: JSON.parse(response.contentItems[0].text).code,
          jobId: x.job.id,
        };
      },
    );
  await scenario(
    report,
    'Out-of-scope request creates a visible pending decision; shell stays denied',
    async () => {
      const x = await setup();
      for (const c of [
        call('pfc_write_file', {
          path: 'extra.txt',
          expectedHash: null,
          content: 'outside',
        }),
        call('pfc_run_checks', {}),
      ])
        assert.equal((await x.dispatch(c)).success, false);
      const rows = (
        await db.pool.query(
          `SELECT state,request FROM "${s}".agent_approvals WHERE job_id=$1 ORDER BY created_at`,
          [x.job.id],
        )
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.state),
        ['PENDING', 'DENIED'],
      );
      assert.equal(
        fs.existsSync(path.join(x.wf.workspace, 'extra.txt')),
        false,
      );
      return { jobId: x.job.id, states: rows.map((r) => r.state) };
    },
  );
  await scenario(
    report,
    'HTTP control readback is tenant scoped and contains hashes rather than file content',
    async () => {
      const x = await setup(),
        other = await setup();
      await x.dispatch(
        call('pfc_write_file', {
          path: 'new.txt',
          expectedHash: null,
          content: 'private synthetic body',
        }),
      );
      const express = require('express'),
        access = require('./src/access'),
        runtime = require('./src/runtime');
      const previous = runtime.db;
      runtime.db = () => db;
      const app = express();
      app.use((req, res, next) => access.run(x.ctx, next));
      app.use('/api/agent', require('./src/routes/agent'));
      app.use((e, req, res, next) => {
        void next;
        res.status(e.status || 500).json({ code: e.code || 'FAILED' });
      });
      const server = await new Promise((resolve) => {
        const h = app.listen(5203, '127.0.0.1', () => resolve(h));
      });
      try {
        const res = await fetch(
          'http://127.0.0.1:5203/api/agent/requirements/' +
            x.req.public_id +
            '/tool-control',
        );
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.executions.length, 1);
        assert.equal(data.executions[0].sha256, hash('private synthetic body'));
        assert.equal(
          JSON.stringify(data).includes('private synthetic body'),
          false,
        );
        const denied = await fetch(
          'http://127.0.0.1:5203/api/agent/requirements/' +
            other.req.id +
            '/tool-control',
        );
        assert.equal(denied.status, 404);
      } finally {
        await new Promise((resolve) => server.close(resolve));
        runtime.db = previous;
      }
    },
  );
  await scenario(
    report,
    'A pending scope expansion can be denied after an earlier approved file write',
    async () => {
      const x = await setup();
      assert.equal(
        (
          await x.dispatch(
            call('pfc_write_file', {
              path: 'new.txt',
              expectedHash: null,
              content: 'owned',
            }),
          )
        ).success,
        true,
      );
      const response = await x.dispatch(
        call('pfc_write_file', {
          path: 'extra.txt',
          expectedHash: null,
          content: 'denied',
        }),
      );
      const id = JSON.parse(response.contentItems[0].text).approvalId;
      const row = (
        await db.pool.query(
          `SELECT * FROM "${s}".agent_approvals WHERE id=$1`,
          [id],
        )
      ).rows[0];
      const result = await tx(db, (c) =>
        require('./src/persistence/agent-approvals').decide(
          c,
          db,
          x.ctx,
          x.req,
          id,
          {
            decision: 'deny',
            scopeHash: row.scope_hash,
            contextHash: x.scope.plan.contextHash,
          },
        ),
      );
      assert.equal(result.state, 'DENIED');
      assert.equal(
        fs.existsSync(path.join(x.wf.workspace, 'extra.txt')),
        false,
      );
    },
  );
  await scenario(
    report,
    'Identical callback replay returns its prior result; another turn and undispatched job cannot act',
    async () => {
      const x = await setup(),
        request = call('pfc_write_file', {
          path: 'new.txt',
          expectedHash: null,
          content: 'once',
        });
      const first = await x.dispatch(request);
      assert.equal(first.success, true);
      assert.deepEqual(await x.dispatch(request), first);
      assert.equal(
        (
          await db.pool.query(
            `SELECT count(*)::int n FROM "${s}".tool_executions WHERE job_id=$1`,
            [x.job.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await x.dispatch({
            ...call('pfc_read_file', { path: 'example.txt' }),
            turnId: 'another-turn',
          })
        ).success,
        false,
      );
      const y = await hostJobFixture(f, 'not-dispatched', false);
      workspaces.push(y.wf);
      const denied = await y.dispatch(
        call('pfc_read_file', { path: 'example.txt' }),
      );
      assert.equal(
        JSON.parse(denied.contentItems[0].text).code,
        'AGENT_NOT_DISPATCHED',
      );
    },
  );
  await scenario(
    report,
    'Restart never replays a durable RUNNING file operation as success',
    async () => {
      const x = await setup();
      const request = call('pfc_write_file', {
        path: 'new.txt',
        expectedHash: null,
        content: 'interrupted before effect',
      });
      await tx(db, async (c) => {
        const approval =
          await require('./src/persistence/agent-approvals').create(
            c,
            db,
            x.ctx,
            x.job.id,
            x.ownerId,
            {
              ...request,
              kind: 'fileChange',
              contextHash: x.scope.plan.contextHash,
            },
          );
        const approved = (
          await c.query(
            `UPDATE "${s}".agent_approvals SET state='APPROVED',decided_by=$1,decided_at=now() WHERE id=$2 RETURNING *`,
            [x.ctx.memberId, approval.id],
          )
        ).rows[0];
        await require('./src/persistence/tool-executions').begin(
          c,
          db,
          x.job,
          approved,
          request,
        );
      });
      await db.pool.query(
        `UPDATE "${s}".agent_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`,
        [x.job.id],
      );
      const recovered = await tx(db, (c) => jobs.recover(c, db));
      assert.ok(
        recovered.some((r) => r.id === x.job.id && r.state === 'UNKNOWN'),
      );
      assert.equal(
        (
          await db.pool.query(
            `SELECT state FROM "${s}".tool_executions WHERE job_id=$1`,
            [x.job.id],
          )
        ).rows[0].state,
        'UNKNOWN',
      );
      assert.equal(fs.existsSync(path.join(x.wf.workspace, 'new.txt')), false);
      assert.equal(
        (await x.dispatch(call('pfc_read_file', { path: 'example.txt' })))
          .success,
        false,
      );
    },
  );
} catch (e) {
  report.errors.push({ code: e.code || e.message });
} finally {
  for (const w of workspaces) w.cleanup();
  if (f)
    try {
      report.cleanup = await f.cleanup();
    } catch (e) {
      report.errors.push({ cleanup: e.code || e.message });
    }
}
saveReport(report, 'api');
