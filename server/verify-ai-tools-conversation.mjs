import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
const require = createRequire(import.meta.url);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'conversation real-mode closed loop: job queue, worker success/failure, message writeback; stub provider only, no model turn',
  tests: [],
};
const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
const savedBinary = process.env.PFC_CODEX_BINARY;
const savedCwd = process.env.PFC_CODEX_PREFLIGHT_CWD;
let fixture;
try {
  const { aiDatabaseFixture } = await import('./test-data/ai-tools-fixture.mjs');
  fixture = await aiDatabaseFixture('real');
  const { migrate, assertReady } = require('./src/persistence/migrations');
  await migrate(fixture.db);
  await assertReady(fixture.db);
  const { ctx, req } = await fixture.seed();
  const db = fixture.db;
  const reqRow = (
    await db.pool.query(`SELECT * FROM "${db.schema}".reqs WHERE id=$1`, [
      req.id,
    ])
  ).rows[0];
  const reqPublicId = reqRow.public_id;
  const { withTransaction } = require('./src/persistence/transaction');
  const jobs = require('./src/persistence/agent-jobs');
  const repo = require('./src/persistence/messages');
  const tx = (fn) => withTransaction(db, fn);
  const eventTypes = async () =>
    (
      await db.pool.query(
        `SELECT type FROM "${db.schema}".domain_events ORDER BY seq`,
      )
    ).rows.map((r) => r.type);

  const createPair = async (content) => {
    let out = {};
    await tx(async (client) => {
      const user = await repo.create(client, db, ctx, reqRow, {
        turnId: 'T-' + randomUUID(),
        role: 'user',
        stage: 'idea',
        content,
        status: 'ok',
        metadata: { refs: [], attachments: [] },
      });
      const ai = await repo.create(client, db, ctx, reqRow, {
        turnId: user.turn_id,
        role: 'ai',
        stage: 'idea',
        content: '',
        status: 'generating',
        replyTo: user.id,
        metadata: { full: null, refs: [], attachments: [], real: true },
      });
      const job = await jobs.enqueue(client, db, ctx, reqRow, {
        commandId: 'MSG-' + user.id,
        kind: 'TEXT',
        inputHash: require('node:crypto')
          .createHash('sha256')
          .update(JSON.stringify({ content, stage: 'idea' }))
          .digest('hex'),
        input: {
          userMessageId: user.id,
          aiMessageId: ai.id,
          content,
          refs: [],
          stage: 'idea',
        },
      });
      out = { user, ai, job };
    });
    return out;
  };

  // Stub the provider AFTER worker load would capture the real class, so
  // patch the CommonJS cache first, then load worker.
  const provider = require('./src/agent/conversation-provider');
  const originalOpen = provider.TextConversation.open;
  let deltas = [];
  provider.TextConversation.open = async () => ({
    threadId: 'STUB_thread',
    runText: async ({ text, onDelta }) => {
      onDelta('真实');
      onDelta('回复文本');
      return {
        text: '真实回复文本',
        usage: { inputTokens: 7, outputTokens: 9 },
        threadId: 'STUB_thread',
        turnId: 'STUB_turn',
        status: 'SUCCEEDED',
      };
    },
    close: async () => ({ process: { closed: true } }),
  });

  const worker = require('./src/agent/worker');

  // ---- Success path: stub provider returns text, delta writeback + SUCCEEDED
  process.env.PFC_CODEX_BINARY = 'stub-binary';
  process.env.PFC_CODEX_PREFLIGHT_CWD = process.cwd();
  {
    const { user, ai, job } = await createPair('CODEx_TEST_真实模式作业');
    deltas = [];
    const out = await worker.runTextJob({
      db,
      ctx,
      reqPublicId,
      jobId: job.id,
    });
    assert.equal(out.status, 'SUCCEEDED');
    const final = (
      await db.pool.query(
        `SELECT content,status,metadata FROM "${db.schema}".messages WHERE id=$1`,
        [ai.id],
      )
    ).rows[0];
    assert.equal(final.status, 'ok');
    assert.equal(final.content, '真实回复文本');
    const meta = final.metadata;
    assert.equal(meta.real, true);
    assert.equal(meta.full, '真实回复文本');
    assert.equal(meta.usage.outputTokens, 9);
    const done = (
      await db.pool.query(
        `SELECT state,result,error_code FROM "${db.schema}".agent_jobs WHERE id=$1`,
        [job.id],
      )
    ).rows[0];
    assert.equal(done.state, 'SUCCEEDED');
    assert.equal(done.result.turnId, 'STUB_turn');
    const types = await eventTypes();
    assert.ok(types.some((t) => t === 'message.updated'));
    assert.ok(types.some((t) => t === 'message.completed'));
    const agentEvents = (
      await db.pool.query(
        `SELECT type FROM "${db.schema}".agent_events WHERE job_id=$1 ORDER BY sequence`,
        [job.id],
      )
    ).rows.map((r) => r.type);
    assert.deepEqual(agentEvents, ['queued', 'started', 'completed']);
    report.tests.push({
      name: 'worker success: stub text, delta writeback, SUCCEEDED and events',
      status: 'PASS',
    });
  }

  // ---- Failure path: connection unavailable must fail explicitly, no mock success
  delete process.env.PFC_CODEX_BINARY;
  delete process.env.PFC_CODEX_PREFLIGHT_CWD;
  {
    const { ai, job } = await createPair('CODEx_TEST_无连接失败');
    const out = await worker.runTextJob({ db, ctx, reqPublicId, jobId: job.id });
    assert.equal(out.status, 'FAILED');
    assert.equal(out.code, 'CONNECTION_UNAVAILABLE');
    const msg = (
      await db.pool.query(
        `SELECT status,metadata FROM "${db.schema}".messages WHERE id=$1`,
        [ai.id],
      )
    ).rows[0];
    assert.equal(msg.status, 'failed');
    assert.equal(msg.metadata.error, 'CONNECTION_UNAVAILABLE');
    const done = (
      await db.pool.query(
        `SELECT state,error_code FROM "${db.schema}".agent_jobs WHERE id=$1`,
        [job.id],
      )
    ).rows[0];
    assert.equal(done.state, 'FAILED');
    assert.equal(done.error_code, 'CONNECTION_UNAVAILABLE');
    const agentEvents = (
      await db.pool.query(
        `SELECT type FROM "${db.schema}".agent_events WHERE job_id=$1 ORDER BY sequence`,
        [job.id],
      )
    ).rows.map((r) => r.type);
    assert.deepEqual(agentEvents, ['queued', 'started', 'failed']);
    const domainTypes = await eventTypes();
    assert.ok(
      domainTypes.some((t) => t === 'message.failed'),
      'message.failed domain event must be appended on worker failure',
    );
    report.tests.push({
      name: 'worker failure: no connection fails explicitly with message writeback',
      status: 'PASS',
    });
  }

  // ---- No budget consumed: stub provider never calls reserveTurn
  const budget = require('./src/agent/budget').snapshot();
  report.budget = budget;
  report.tests.push({
    name: 'no model turn consumed by stub verification',
    status: 'PASS',
  });

  provider.TextConversation.open = originalOpen;
  report.status = 'PASS';
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: e.message };
  process.exitCode = 1;
} finally {
  if (fixture) await fixture.cleanup();
  if (savedBinary === undefined) delete process.env.PFC_CODEX_BINARY;
  else process.env.PFC_CODEX_BINARY = savedBinary;
  if (savedCwd === undefined) delete process.env.PFC_CODEX_PREFLIGHT_CWD;
  else process.env.PFC_CODEX_PREFLIGHT_CWD = savedCwd;
  mkdirSync(root, { recursive: true });
  const file = `${root}/conversation-${Date.now()}.json`;
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
