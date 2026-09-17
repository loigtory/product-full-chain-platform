import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  databaseFixture,
  profileFixture,
  reportFor,
  scenario,
  saveReport,
  patched,
} from './test-data/ai-tools-remediation-fixture.mjs';
const require = createRequire(import.meta.url);
const { withTransaction: tx } = require('./src/persistence/transaction');
const jobs = require('./src/persistence/agent-jobs');
const messages = require('./src/persistence/messages');
const service = require('./src/domain/conversation-service');
const access = require('./src/access');
const report = reportFor(
  '46 API/domain integration on exact isolated 007 and 006 schemas; synthetic transport for worker, zero real calls',
);
let f;
try {
  f = await databaseFixture('api');
  await require('./src/persistence/migrations').migrate(f.db);
  const { db } = f,
    s = db.schema;
  const seed = await f.seed(),
    { ctx } = seed;
  const req = (
    await db.pool.query(`SELECT * FROM "${s}".reqs WHERE tenant_id=$1`, [
      ctx.tenantId,
    ])
  ).rows[0];
  const make = async () =>
    tx(db, async (c) => {
      const user = await messages.create(c, db, ctx, req, {
        turnId: randomUUID(),
        role: 'user',
        stage: 'idea',
        content: 'CODEx_TEST_停止验证',
        status: 'ok',
      });
      const ai = await messages.create(c, db, ctx, req, {
        turnId: user.turn_id,
        role: 'ai',
        stage: 'idea',
        content: '',
        status: 'generating',
        replyTo: user.id,
      });
      const input = {
        content: '只返回合成结果',
        stage: 'idea',
        aiMessageId: ai.id,
        userMessageId: user.id,
      };
      const job = await jobs.enqueue(c, db, ctx, req, {
        kind: 'TEXT',
        commandId: 'MSG-' + user.id,
        inputHash: 'a'.repeat(64),
        input,
      });
      return { job, ai };
    });
  await scenario(
    report,
    'Text jobs cannot mint executable approval records',
    async () => {
      const { job } = await make(),
        owner = randomUUID();
      await tx(db, (c) => jobs.claimById(c, db, job.id, owner));
      await assert.rejects(
        tx(db, (c) =>
          require('./src/persistence/agent-approvals').create(
            c,
            db,
            ctx,
            job.id,
            owner,
            { requestId: 'synthetic' },
          ),
        ),
        { code: 'APPROVAL_SCOPE_CHANGED' },
      );
      assert.equal(
        (
          await db.pool.query(
            'SELECT count(*) n FROM "' +
              s +
              '".agent_approvals WHERE job_id=$1',
            [job.id],
          )
        ).rows[0].n,
        '0',
      );
      await tx(db, (c) =>
        jobs.finish(c, db, job.id, owner, 'FAILED', null, 'SYNTHETIC_END'),
      );
    },
  );
  await scenario(
    report,
    'Queued stop commits CANCELLED and is idempotent',
    async () => {
      const { job, ai } = await make();
      await patched(
        require('./src/runtime'),
        'db',
        () => db,
        () =>
          access.run(ctx, async () => {
            const revision = (
              await db.pool.query(
                `SELECT revision FROM "${s}".reqs WHERE id=$1`,
                [req.id],
              )
            ).rows[0].revision;
            const input = {
              commandId: randomUUID(),
              expectedRevision: revision,
            };
            const result = await service.stopMessage(
              req.public_id,
              ai.public_id,
              input,
            );
            assert.equal(result.cancellation.confirmed, true);
            await service.stopMessage(req.public_id, ai.public_id, input);
          }),
      );
      const state = (
        await db.pool.query(`SELECT state FROM "${s}".agent_jobs WHERE id=$1`, [
          job.id,
        ])
      ).rows[0].state;
      assert.equal(state, 'CANCELLED');
    },
  );
  await scenario(
    report,
    'Recovery cancels undispatched stopped work and never replays dispatched work',
    async () => {
      for (const dispatched of [false, true]) {
        const { job } = await make(),
          owner = randomUUID();
        await tx(db, (c) => jobs.claimById(c, db, job.id, owner));
        if (dispatched)
          await tx(db, (c) => jobs.dispatch(c, db, job.id, owner));
        await tx(db, (c) => jobs.requestCancel(c, db, ctx, req.id, job.id));
        await tx(db, async (c) => {
          await c.query(
            'UPDATE "' + s + '".agent_jobs SET lease_until=$2 WHERE id=$1',
            [job.id, new Date(Date.now() - 1000)],
          );
        });
        const recovered = await tx(db, (c) => jobs.recover(c, db));
        assert.equal(
          recovered.find((x) => x.id === job.id)?.state,
          dispatched ? 'UNKNOWN' : 'CANCELLED',
        );
        const row = (
          await db.pool.query(
            'SELECT state FROM "' + s + '".agent_jobs WHERE id=$1',
            [job.id],
          )
        ).rows[0];
        assert.equal(row.state, dispatched ? 'UNKNOWN' : 'CANCELLED');
      }
    },
  );
  await scenario(
    report,
    'Cancellation guard rejects late success even with a live lease',
    async () => {
      const { job } = await make(),
        owner = randomUUID();
      await tx(db, (c) => jobs.claimById(c, db, job.id, owner));
      await tx(db, (c) => jobs.dispatch(c, db, job.id, owner));
      await tx(db, (c) => jobs.requestCancel(c, db, ctx, req.id, job.id));
      await assert.rejects(
        tx(db, (c) => jobs.finish(c, db, job.id, owner, 'SUCCEEDED', {}, null)),
        { code: 'TURN_CANCELLED' },
      );
      await tx(db, (c) =>
        jobs.finish(c, db, job.id, owner, 'CANCELLED', null, 'TURN_CANCELLED'),
      );
      await assert.rejects(
        tx(db, (c) => jobs.finish(c, db, job.id, owner, 'FAILED', null, 'x')),
        { code: 'AGENT_LEASE_LOST' },
      );
    },
  );
  await scenario(
    report,
    'Lease loss cannot be bypassed by another worker or a terminal force write',
    async () => {
      const { job } = await make(),
        owner = randomUUID();
      await tx(db, (c) => jobs.claimById(c, db, job.id, owner));
      await assert.rejects(
        tx(db, (c) =>
          jobs.finish(c, db, job.id, randomUUID(), 'SUCCEEDED', {}, null),
        ),
        { code: 'AGENT_LEASE_LOST' },
      );
      await assert.rejects(
        tx(db, (c) =>
          jobs.forceFinish(c, db, job.id, 'SUCCEEDED', {}, null, owner),
        ),
      );
      await tx(db, (c) =>
        jobs.finish(c, db, job.id, owner, 'FAILED', null, 'SYNTHETIC'),
      );
    },
  );
  await scenario(
    report,
    'Server context preserves seven stages, distinguishes confirmation, and rejects another requirement source',
    async () => {
      const stages = [
        'idea',
        'req',
        'design',
        'dev',
        'test',
        'accept',
        'release',
      ];
      for (const stage of stages)
        await tx(db, (c) =>
          c.query(
            `INSERT INTO "${s}".req_versions(id,tenant_id,req_id,public_id,stage,version,content,confirmed_by,confirmed_at) VALUES($1,$2,$3,$4,$5,10,$6,$7,$8)`,
            [
              randomUUID(),
              ctx.tenantId,
              req.id,
              'VER-' + stage,
              stage,
              JSON.stringify({ rule: 'CODEx_TEST_' + stage }),
              stage === 'req' ? ctx.actor : null,
              stage === 'req' ? new Date() : null,
            ],
          ),
        );
      const context = require('./src/agent/context-service');
      const snapshot = await tx(db, (c) =>
        context.stageSnapshot(c, db, ctx, req, 'observe'),
      );
      assert.equal(snapshot.snapshot.blocks.length, 7);
      assert.equal(snapshot.snapshot.blocks.at(-1).stage, 'release');
      assert.equal(
        snapshot.snapshot.blocks.find((x) => x.stage === 'req').sources
          .confirmed,
        true,
      );
      assert.equal(
        snapshot.snapshot.blocks.find((x) => x.stage === 'design').sources
          .confirmed,
        false,
      );
      await assert.rejects(
        tx(db, (c) =>
          context.stageSnapshot(c, db, ctx, req, 'observe', [
            { stage: 'req', versionId: 'OTHER-REQ' },
          ]),
        ),
        { code: 'STALE_REFERENCE' },
      );
      await tx(db, (c) =>
        c.query(
          `UPDATE "${s}".req_versions SET stale=true WHERE req_id=$1 AND stage='req'`,
          [req.id],
        ),
      );
      const changed = await tx(db, (c) =>
        context.stageSnapshot(c, db, ctx, req, 'observe'),
      );
      assert.notEqual(snapshot.hash, changed.hash);
    },
  );
  await scenario(
    report,
    'Live worker stop rejects a late provider result and preserves stopped AI metadata',
    async () => {
      const { job, ai } = await make();
      const worker = require('./src/agent/worker'),
        provider =
          require('./src/agent/conversation-provider').TextConversation,
        budget = require('./src/agent/budget');
      let signal,
        finish,
        settled,
        closed = 0;
      const began = new Promise((resolve) => {
        signal = resolve;
      });
      const fake = {
        runText: async ({ reserveTurn, onDelta }) => {
          await reserveTurn();
          onDelta('CODEx_TEST_partial');
          signal();
          return new Promise((resolve) => {
            finish = () =>
              resolve({ text: 'CODEx_TEST_late_success', usage: null });
          });
        },
        close: async () => {
          closed++;
          finish?.();
          return { childExited: true };
        },
      };
      const old = process.env.PFC_CODEX_BINARY;
      process.env.PFC_CODEX_BINARY = 'synthetic-provider';
      try {
        await patched(
          provider,
          'open',
          async () => fake,
          () =>
            patched(
              budget,
              'reserveTurn',
              async () => ({ attemptId: 'synthetic-attempt' }),
              () =>
                patched(
                  budget,
                  'settleTurn',
                  async (_seconds, state) => {
                    settled = state;
                  },
                  async () => {
                    const running = worker.runTextJob({
                      db,
                      ctx,
                      reqPublicId: req.public_id,
                      jobId: job.id,
                    });
                    await Promise.race([
                      began,
                      running.then(() => {
                        throw Error('WORKER_ENDED_BEFORE_PROVIDER');
                      }),
                    ]);
                    await patched(
                      require('./src/runtime'),
                      'db',
                      () => db,
                      () =>
                        access.run(ctx, async () => {
                          const revision = (
                            await db.pool.query(
                              'SELECT revision FROM "' +
                                s +
                                '".reqs WHERE id=$1',
                              [req.id],
                            )
                          ).rows[0].revision;
                          const stopped = await service.stopMessage(
                            req.public_id,
                            ai.public_id,
                            {
                              commandId: randomUUID(),
                              expectedRevision: revision,
                            },
                          );
                          assert.equal(stopped.cancellation.confirmed, true);
                        }),
                    );
                    const outcome = await running;
                    assert.equal(outcome.status, 'CANCELLED');
                    assert.equal(settled, 'CANCELLED');
                    assert.ok(closed >= 1);
                    const message = (
                      await db.pool.query(
                        'SELECT status,content,metadata FROM "' +
                          s +
                          '".messages WHERE id=$1',
                        [ai.id],
                      )
                    ).rows[0];
                    assert.equal(message.status, 'stopped');
                    assert.notEqual(message.content, 'CODEx_TEST_late_success');
                  },
                ),
            ),
        );
      } finally {
        if (old === undefined) delete process.env.PFC_CODEX_BINARY;
        else process.env.PFC_CODEX_BINARY = old;
      }
    },
  );
  await scenario(
    report,
    'Unregistered member, wrong tenant and viewer cannot cancel a job',
    async () => {
      const { ai } = await make();
      await patched(
        require('./src/runtime'),
        'db',
        () => db,
        async () => {
          for (const invalid of [
            { ...ctx, actor: 'CODEx_TEST_unknown', memberId: randomUUID() },
            { ...ctx, tenantId: randomUUID() },
            { ...ctx, role: 'viewer' },
          ]) {
            const revision = (
              await db.pool.query(
                'SELECT revision FROM "' + s + '".reqs WHERE id=$1',
                [req.id],
              )
            ).rows[0].revision;
            await assert.rejects(
              access.run(invalid, () =>
                service.stopMessage(req.public_id, ai.public_id, {
                  commandId: randomUUID(),
                  expectedRevision: revision,
                }),
              ),
            );
          }
        },
      );
    },
  );
  await scenario(
    report,
    'Future-stage bypass remains rejected when the old environment flag is set',
    async () => {
      process.env.PFC_ALLOW_STAGE_BYPASS = '1';
      try {
        await patched(
          require('./src/runtime'),
          'db',
          () => db,
          () =>
            access.run(ctx, async () => {
              const revision = (
                await db.pool.query(
                  `SELECT revision FROM "${s}".reqs WHERE id=$1`,
                  [req.id],
                )
              ).rows[0].revision;
              await assert.rejects(
                service.sendMessage(req.public_id, {
                  commandId: randomUUID(),
                  expectedRevision: revision,
                  stage: 'observe',
                  content: 'CODEx_TEST_bypass',
                }),
                { code: 'INVALID_STAGE' },
              );
            }),
        );
      } finally {
        delete process.env.PFC_ALLOW_STAGE_BYPASS;
      }
    },
  );
  await scenario(
    report,
    'A new turn durably cancels older queued work in the same requirement',
    async () => {
      const { job } = await make();
      await patched(
        require('./src/runtime'),
        'db',
        () => db,
        () =>
          access.run(ctx, async () => {
            const revision = (
              await db.pool.query(
                'SELECT revision FROM "' + s + '".reqs WHERE id=$1',
                [req.id],
              )
            ).rows[0].revision;
            const result = await service.sendMessage(req.public_id, {
              commandId: randomUUID(),
              expectedRevision: revision,
              stage: 'idea',
              content: 'CODEx_TEST_new_turn',
            });
            assert.ok(result.reply.id);
            const row = (
              await db.pool.query(
                'SELECT state FROM "' + s + '".agent_jobs WHERE id=$1',
                [job.id],
              )
            ).rows[0];
            assert.equal(row.state, 'CANCELLED');
          }),
      );
    },
  );
  await scenario(
    report,
    'Actual HTTP session, disabled EXEC status and queued stop match persisted job state',
    async () => {
      const p = await profileFixture(f, seed, 'api');
      let helper;
      try {
        helper = await require('./src/local/lifecycle').start(p.profile);
        const base = 'http://127.0.0.1:5203';
        const login = await fetch(base + '/api/auth/local-session', {
          method: 'POST',
          headers: { Origin: base, 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: p.key }),
        });
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie').split(';')[0],
          headers = {
            Cookie: cookie,
            Origin: base,
            'Content-Type': 'application/json',
          };
        const status = await (
          await fetch(base + '/api/agent/status', { headers })
        ).json();
        assert.equal(status.execCapable, false);
        const capabilities = await (
          await fetch(base + '/api/agent/stage-capabilities', { headers })
        ).json();
        assert.equal(capabilities.stages.length, 8);
        for (const stage of capabilities.stages) {
          assert.deepEqual(stage.skills, []);
          assert.deepEqual(stage.mcps, []);
          assert.deepEqual(stage.tools, ['文本对话']);
        }
        assert.equal(
          status.execution.code,
          'EXEC_APPROVAL_COVERAGE_UNVERIFIED',
        );
        for (const [jobId, approvalId, expected] of [
          ['invalid', randomUUID(), 400],
          [randomUUID(), randomUUID(), 404],
        ]) {
          const response = await fetch(
            base +
              '/api/agent/jobs/' +
              jobId +
              '/approvals/' +
              approvalId +
              '/decision',
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                commandId: randomUUID(),
                decision: 'approve',
                scopeHash: 'a'.repeat(64),
                expectedState: 'PENDING',
              }),
            },
          );
          assert.equal(response.status, expected);
        }
        const { job, ai } = await make();
        const revision = (
          await db.pool.query(
            'SELECT revision FROM "' + s + '".reqs WHERE id=$1',
            [req.id],
          )
        ).rows[0].revision;
        const response = await fetch(
          base +
            '/api/reqs/' +
            req.public_id +
            '/messages/' +
            ai.public_id +
            '/stop',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              commandId: randomUUID(),
              expectedRevision: revision,
            }),
          },
        );
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.cancellation.confirmed, true);
        const row = (
          await db.pool.query(
            'SELECT state FROM "' + s + '".agent_jobs WHERE id=$1',
            [job.id],
          )
        ).rows[0];
        assert.equal(row.state, 'CANCELLED');
      } finally {
        if (helper) {
          await require('./src/local/lifecycle').stop(p.profile);
          await helper.exit;
        }
        await p.cleanup();
      }
    },
  );
} catch (e) {
  report.errors.push({ error: e.code || e.message });
} finally {
  if (f)
    try {
      report.cleanup = await f.cleanup();
      report.cleanup.status = 'PASS';
    } catch (e) {
      report.cleanup = { status: 'FAIL', code: e.code || e.message };
      report.errors.push(report.cleanup);
    }
}
await scenario(
  report,
  '006 actual database stop succeeds without the 007 job table',
  async () => {
    let old;
    try {
      old = await databaseFixture('api', '006');
      await require('./src/persistence/migrations').migrate(old.db);
      const { ctx, req } = await old.seed();
      const ai = await tx(old.db, (c) =>
        messages.create(c, old.db, ctx, req, {
          turnId: randomUUID(),
          role: 'ai',
          stage: 'idea',
          content: 'CODEx_TEST_partial',
          status: 'generating',
        }),
      );
      await patched(
        require('./src/runtime'),
        'db',
        () => old.db,
        () =>
          access.run(ctx, () =>
            service.stopMessage(req.public_id, ai.public_id, {
              commandId: randomUUID(),
              expectedRevision: req.revision,
            }),
          ),
      );
      const row = (
        await old.db.pool.query(
          'SELECT status FROM "' + old.db.schema + '".messages WHERE id=$1',
          [ai.id],
        )
      ).rows[0];
      assert.equal(row.status, 'stopped');
    } finally {
      if (old) {
        const clean = await old.cleanup();
        assert.equal(clean.remaining, 0);
        report.version006Cleanup = clean;
      }
    }
  },
);
saveReport(report, 'api');
