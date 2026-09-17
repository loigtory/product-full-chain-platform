import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {
  reportFor,
  scenario,
  saveReport,
  patched,
  workRoot,
} from './test-data/ai-tools-remediation-fixture.mjs';
const require = createRequire(import.meta.url);
const report = reportFor(
  '46 R1 deterministic regressions; no database or real model',
);
const service = require('./src/domain/conversation-service');
const reqs = require('./src/domain/requirement-service');
const worker = require('./src/agent/worker');
const messages = require('./src/persistence/messages');

await scenario(
  report,
  'Stop awaits committed mutation before cancelling the matching job',
  async () => {
    let committed = false,
      cancelled = 0;
    await patched(
      reqs,
      'mutate',
      async () => {
        await new Promise((resolve) => setImmediate(resolve));
        committed = true;
        return { jobId: 'job-1' };
      },
      () =>
        patched(
          worker,
          'cancel',
          async (id) => {
            assert.equal(committed, true);
            assert.equal(id, 'job-1');
            cancelled++;
            return true;
          },
          async () => {
            await service.stopMessage('R-1', 'ai-1', {});
            assert.equal(cancelled, 1);
          },
        ),
    );
  },
);

await scenario(
  report,
  'Stop associates the AI message, never builds a command key from its ID',
  async () => {
    const statements = [];
    const ctx = { tenantId: 'tenant', memberId: 'owner', role: 'owner' };
    const db = { schema: 'unit_fixture', targetVersion: '007' };
    const client = {
      query: async (sql, args) => {
        statements.push({ sql, args });
        return { rows: [], rowCount: 0 };
      },
    };
    await patched(
      messages,
      'find',
      async () => ({
        id: 'ai-1',
        reply_to: 'user-1',
        role: 'ai',
        status: 'generating',
      }),
      () =>
        patched(
          reqs,
          'mutate',
          async (_id, _input, _operation, fn) =>
            fn(client, db, ctx, { id: 'req-1' }),
          () => service.stopMessage('R-1', 'ai-1', {}),
        ),
    );
    const lookup = statements.find((s) => s.sql.includes('agent_jobs'));
    assert.ok(lookup);
    assert.ok(lookup.sql.includes('aiMessageId'));
    assert.ok(lookup.args.includes('ai-1'));
    assert.ok(!lookup.args.includes('EXEC-ai-1'));
  },
);

await scenario(
  report,
  '006 stop never queries the missing 007 table',
  async () => {
    const db = { schema: 'unit_fixture', targetVersion: '006' };
    const client = {
      query: async (sql) => {
        assert.ok(!sql.includes('agent_jobs'));
        return { rows: [], rowCount: 1 };
      },
    };
    await patched(
      messages,
      'find',
      async () => ({ id: 'ai-1', role: 'ai', status: 'generating' }),
      () =>
        patched(
          reqs,
          'mutate',
          async (_id, _input, _operation, fn) =>
            fn(client, db, { tenantId: 't' }, { id: 'r' }),
          () => service.stopMessage('R-1', 'ai-1', {}),
        ),
    );
  },
);

await scenario(
  report,
  'HTTP status and arbitrary metadata cannot turn a failed assertion into PASS',
  async () => {
    const { assertion, summarize } =
      await import('./test-support/gate-result.mjs');
    const failed = assertion('request', false, {
      status: 400,
      name: 'spoof',
      httpStatus: 400,
    });
    assert.equal(failed.status, 'FAIL');
    assert.equal(failed.name, 'request');
    assert.equal(failed.httpStatus, 400);
    assert.equal(summarize({ tests: [failed], errors: [] }), 'FAIL');
    assert.equal(summarize({ tests: [], errors: [] }), 'BLOCKED');
    assert.equal(
      summarize({ tests: [assertion('ok', true)], errors: ['failure'] }),
      'FAIL',
    );
    assert.equal(
      summarize({ tests: [{ name: 'old', status: 'HISTORICAL' }], errors: [] }),
      'BLOCKED',
    );
    assert.equal(
      summarize({ tests: [assertion('ok', true)], errors: [], exitCode: 1 }),
      'FAIL',
    );
  },
);

await scenario(
  report,
  'EXEC requires an explicit plan and server-owned approval identity',
  async () => {
    const { validatePlan } = require('./src/agent/exec-control');
    assert.throws(() => validatePlan({}), { code: 'PLAN_REQUIRED' });
    assert.throws(
      () =>
        validatePlan({
          control: {
            mode: 'strict',
            allowedFiles: ['src/a.js'],
            approvedBy: 'owner',
          },
        }),
      { code: 'PLAN_IDENTITY_REQUIRED' },
    );
  },
);

await scenario(
  report,
  'Seven previous stages are retained; excessive context fails instead of truncating',
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
    const input = {
      stageContext: stages.map((stage) => ({
        stage,
        title: stage,
        text: stage,
      })),
    };
    const result = service.resolveRealJobInput(input, {
      userMessageId: 'u',
      aiMessageId: 'a',
      content: 'continue',
      refs: [],
      stage: 'observe',
    });
    assert.equal(result.input.stageContext.length, 7);
    assert.equal(result.input.stageContext.at(-1).stage, 'release');
    assert.ok(
      result.input.stageContext.every((c) => c.provenance === 'USER_SUPPLIED'),
    );
    assert.throws(
      () =>
        service.resolveRealJobInput(
          { stageContext: [{ stage: 'idea', text: 'x'.repeat(30001) }] },
          { userMessageId: 'u', aiMessageId: 'a', stage: 'req' },
        ),
      { code: 'AGENT_CONTEXT_LIMIT' },
    );
  },
);

await scenario(
  report,
  'Job cancellation is sticky and completion waits for a confirmed process exit',
  async () => {
    const { createControl } = require('./src/agent/job-control');
    const c = createControl();
    let calls = 0;
    c.attach({
      close: async () => {
        calls++;
        return { childExited: true };
      },
    });
    await c.stop('TURN_CANCELLED');
    await c.stop('TURN_TIMED_OUT');
    assert.equal(c.reason, 'TURN_CANCELLED');
    assert.equal(calls, 1);
    assert.equal(c.exitConfirmed, true);
    assert.throws(() => c.check(), { code: 'TURN_CANCELLED' });
    const uncertain = createControl();
    uncertain.attach({ close: async () => ({ childExited: false }) });
    await uncertain.stop('TURN_CANCELLED');
    assert.equal(uncertain.terminalState(), 'UNKNOWN');
  },
);

await scenario(
  report,
  'New budget uses unique attempts, counts failures, and settles concurrent turns idempotently',
  async () => {
    const { createBudget } = require('./src/agent/budget');
    assert.equal(typeof createBudget, 'function');
    const dir = path.join(workRoot, 'unit-budget');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'budget.json');
    assert.ok(!fs.existsSync(file));
    const b = createBudget({
      ledger: file,
      maxTurns: 2,
      maxSeconds: 600,
      packageId: 'unit-fixture',
    });
    try {
      const [a, z] = await Promise.all([b.reserveTurn(), b.reserveTurn()]);
      assert.notEqual(a.attemptId, z.attemptId);
      await Promise.all([
        b.settleTurn(2, 'FAILED', {}, a.attemptId),
        b.settleTurn(3, 'SUCCEEDED', {}, z.attemptId),
      ]);
      await b.settleTurn(2, 'FAILED', {}, a.attemptId);
      assert.equal(b.snapshot().turns, 2);
      await assert.rejects(b.reserveTurn(), { code: 'MODEL_TURN_LIMIT' });
      assert.equal(JSON.parse(fs.readFileSync(file)).attempts.length, 2);
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      assert.ok(!fs.existsSync(file + '.lock'));
      fs.rmdirSync(dir);
    }
  },
);

await scenario(
  report,
  'Repeated provider close waits for the same confirmed exit',
  async () => {
    const { TextConversation } = require('./src/agent/conversation-provider');
    const session = new TextConversation();
    let exits = 0,
      rejected = 0;
    session.active = {
      turnId: 'synthetic',
      reject: () => {
        rejected++;
      },
    };
    session.threadId = 'synthetic';
    session.connection = {
      rpc: { request: async () => ({}) },
      close: async () => {
        exits++;
        await new Promise((resolve) => setImmediate(resolve));
        return { childExited: true };
      },
    };
    const [a, b] = await Promise.all([session.close(), session.close()]);
    assert.equal(a.childExited, true);
    assert.equal(b.childExited, true);
    assert.equal(exits, 1);
    assert.equal(rejected, 1);
  },
);
await scenario(
  report,
  'Protocol close is bounded and cannot report an unobserved process exit',
  async () => {
    const { PreflightRpc } = await import('./src/agent/protocol.mjs');
    const rpc = Object.create(PreflightRpc.prototype);
    rpc.pending = new Map();
    rpc.closed = false;
    rpc.child = { stdin: { destroyed: false, end() {} }, kill() {} };
    rpc.exited = new Promise(() => {});
    const began = Date.now(),
      result = await rpc.close();
    assert.equal(result.childExited, false);
    assert.ok(Date.now() - began < 4500);
    assert.equal(await rpc.close(), result);
  },
);
await scenario(
  report,
  '006 defaults remain compatible and explicit 007 is passed to the runtime',
  async () => {
    const { layout } = require('./src/local/profile');
    assert.equal(layout().targetVersion, '006');
    const p = layout({
      scope: 'source',
      runId: require('node:path').basename(workRoot),
      targetVersion: '007',
    });
    assert.equal(p.dbPort, 5432);
    assert.equal(p.schema, 'codex_test_ai_fix_20260916_ops');
    const env = require('./src/local/ops-config').environment({
      ...p,
      jwtSecret: 'synthetic',
    });
    assert.equal(env.PFC_DB_TARGET_VERSION, '007');
    assert.throws(
      () => layout({ scope: 'source', runId: p.runId, targetVersion: '008' }),
      { code: 'LOCAL_VERSION_INVALID' },
    );
  },
);
await scenario(
  report,
  'New schema allowance rejects every unapproved role, name and port',
  async () => {
    const { validateTarget } = require('./src/persistence/connection');
    const checked = (schema, port) =>
      validateTarget({
        schema,
        authorizedSchema: schema,
        connectionString:
          'postgresql://pfc_app_local:synthetic@127.0.0.1:' +
          port +
          '/pfc_local',
      });
    assert.equal(checked('codex_test_ai_fix_20260916_api', 5432).pg.port, 5432);
    assert.equal(checked('codex_test_ai_fix_20260916_ops', 5549).pg.port, 5549);
    assert.throws(() => checked('codex_test_ai_fix_20260916_api', 5549), {
      code: 'PG_TARGET_NOT_AUTHORIZED',
    });
    assert.throws(() => checked('codex_test_ai_fix_20260916_other', 5432), {
      code: 'SCHEMA_NOT_AUTHORIZED',
    });
  },
);
await scenario(
  report,
  'Frozen workspace plan rejects widened commands and rollback preserves unrelated changes',
  async () => {
    const control = require('./src/agent/exec-control'),
      policy = require('./src/agent/execution-policy');
    const workspace = path.join(workRoot, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    const names = ['CODEx_TEST_owned.txt', 'CODEx_TEST_other.txt'];
    for (const name of names)
      assert.equal(fs.existsSync(path.join(workspace, name)), false);
    try {
      fs.writeFileSync(path.join(workspace, names[0]), 'before', {
        flag: 'wx',
      });
      fs.writeFileSync(path.join(workspace, names[1]), 'unrelated', {
        flag: 'wx',
      });
      const before = control.scanWorkspace(workspace),
        ctx = {
          role: 'owner',
          memberId: '11111111-1111-4111-8111-111111111111',
          tenantId: 't',
        };
      const input = {
        workspace,
        control: {
          confirmed: true,
          mode: 'strict',
          allowedFiles: [names[0]],
          allowedCommands: [['git', 'status', '--porcelain=v1']],
          baselineHash: control.baselineHash(before),
          validUntil: new Date(Date.now() + 120000).toISOString(),
        },
      };
      const frozen = control.freezeForActor(
        input,
        ctx,
        { id: 'r' },
        'a'.repeat(64),
      );
      assert.equal(frozen.approvedBy, ctx.memberId);
      assert.equal(
        policy.exactCommand(
          ['git', 'status', '--porcelain=v1'],
          workspace,
          frozen,
        ),
        true,
      );
      for (const cmd of [
        ['git', 'status', '--porcelain=v1', ';', 'anything'],
        ['git', 'status'],
        ['powershell', '-Command', 'x'],
      ])
        assert.equal(policy.exactCommand(cmd, workspace, frozen), false);
      assert.throws(
        () =>
          control.validatePlan({
            control: {
              ...frozen,
              validUntil: new Date(Date.now() - 1).toISOString(),
            },
          }),
        { code: 'PLAN_EXPIRED' },
      );
      fs.writeFileSync(path.join(workspace, names[0]), 'owned change');
      fs.writeFileSync(path.join(workspace, names[1]), 'third party');
      assert.throws(
        () => control.freezeForActor(input, ctx, { id: 'r' }, 'a'.repeat(64)),
        { code: 'PLAN_BASELINE_CHANGED' },
      );
      const current = control.scanWorkspace(workspace),
        journal = new Map([[names[0], current.get(names[0]).sha256]]);
      fs.writeFileSync(path.join(workspace, names[0]), 'conflicting user edit');
      assert.throws(() => control.revert(workspace, before, journal), {
        code: 'ROLLBACK_CONFLICT',
      });
      assert.equal(
        fs.readFileSync(path.join(workspace, names[1]), 'utf8'),
        'third party',
      );
      fs.writeFileSync(path.join(workspace, names[0]), 'owned change');
      assert.deepEqual(control.revert(workspace, before, journal), [names[0]]);
      assert.equal(
        fs.readFileSync(path.join(workspace, names[0]), 'utf8'),
        'before',
      );
      assert.equal(
        fs.readFileSync(path.join(workspace, names[1]), 'utf8'),
        'third party',
      );
      assert.throws(
        () =>
          control.revert(
            workspace,
            before,
            new Map([['..' + String.fromCharCode(92) + 'outside', null]]),
          ),
        { code: 'PLAN_INVALID_PATH' },
      );
    } finally {
      for (const name of names)
        fs.rmSync(path.join(workspace, name), { force: true });
      if (fs.readdirSync(workspace).length === 0) fs.rmdirSync(workspace);
    }
  },
);
saveReport(report, 'model');
