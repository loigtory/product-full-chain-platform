import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  reportFor,
  scenario,
  saveReport,
  workspaceFixture,
  hash,
  workRoot,
} from './test-data/ai-tools-host-exec-fixture.mjs';
const require = createRequire(import.meta.url),
  report = reportFor('host-model');
const actor = '11111111-1111-4111-8111-111111111111';
function plan(workspace) {
  const control = require('./src/agent/exec-control');
  return control.validatePlan({
    control: {
      approvalSource: 'SERVER_AUTHENTICATED',
      approvedBy: actor,
      tenantId: 'tenant',
      reqId: 'req',
      contextHash: 'a'.repeat(64),
      mode: 'strict',
      allowedFiles: ['example.txt', 'new.txt'],
      forbidden: [],
      validUntil: new Date(Date.now() + 120000).toISOString(),
      baselineHash: control.baselineHash(control.scanWorkspace(workspace)),
    },
  });
}
await scenario(
  report,
  'Approved read/write use exact content hash and update the owned diff journal',
  () => {
    const f = workspaceFixture('model-write');
    try {
      const scope = require('./src/agent/scope-policy').createScope(
        f.workspace,
        plan(f.workspace),
      );
      const before = scope.read({ path: 'example.txt' });
      const result = scope.write({
        path: 'example.txt',
        expectedHash: before.sha256,
        content: 'updated\n',
      });
      assert.equal(result.sha256, hash('updated\n'));
      assert.equal(
        fs.readFileSync(path.join(f.workspace, 'example.txt'), 'utf8'),
        'updated\n',
      );
      assert.throws(
        () =>
          scope.write({
            path: 'example.txt',
            expectedHash: before.sha256,
            content: 'stale',
          }),
        { code: 'FILE_BASELINE_CHANGED' },
      );
      assert.equal(scope.diff().changes.length, 1);
      scope.rollback();
      assert.equal(
        fs.readFileSync(path.join(f.workspace, 'example.txt'), 'utf8'),
        'synthetic baseline\n',
      );
    } finally {
      f.cleanup();
    }
  },
);
await scenario(
  report,
  'Traversal, ADS, reserved paths, credentials, links, unknown arguments and excess content reject before effects',
  () => {
    const f = workspaceFixture('model-path');
    try {
      const scope = require('./src/agent/scope-policy').createScope(
        f.workspace,
        plan(f.workspace),
      );
      for (const value of [
        '../outside.txt',
        'C:/x',
        '//server/share',
        'x:stream',
        '.env',
        '.git/config',
        'node_modules/x',
        'NUL',
        'example.txt.',
        'x/../example.txt',
        'x\\y',
      ])
        assert.throws(() => scope.read({ path: value }));
      assert.throws(() =>
        scope.write({
          path: 'example.txt',
          expectedHash: hash('synthetic baseline\n'),
          content: 'x',
          delete: true,
        }),
      );
      assert.throws(() =>
        scope.write({
          path: 'new.txt',
          expectedHash: null,
          content: 'x'.repeat(5242881),
        }),
      );
      assert.throws(() => scope.read({ path: 'outside.txt' }), {
        code: 'TOOL_OUT_OF_SCOPE',
      });
      fs.linkSync(
        path.join(f.workspace, 'example.txt'),
        path.join(f.workspace, 'new.txt'),
      );
      assert.throws(() => scope.read({ path: 'example.txt' }), {
        code: 'WORKSPACE_LINK_DENIED',
      });
    } finally {
      f.cleanup();
    }
  },
);
await scenario(
  report,
  'Rollback preserves an external edit and rejects the entire journal before changing anything',
  () => {
    const f = workspaceFixture('model-conflict');
    try {
      const scope = require('./src/agent/scope-policy').createScope(
        f.workspace,
        plan(f.workspace),
      );
      scope.write({ path: 'new.txt', expectedHash: null, content: 'owned' });
      fs.writeFileSync(path.join(f.workspace, 'new.txt'), 'other actor');
      assert.throws(() => scope.rollback(), { code: 'ROLLBACK_CONFLICT' });
      assert.equal(
        fs.readFileSync(path.join(f.workspace, 'new.txt'), 'utf8'),
        'other actor',
      );
    } finally {
      f.cleanup();
    }
  },
);
await scenario(
  report,
  'Request binding refuses wrong identities, missing notification, changed arguments and duplicate execution',
  async () => {
    const { DynamicBindings } = require('./src/agent/approval-service');
    const b = new DynamicBindings();
    b.start('thread', 'turn');
    const p = {
      threadId: 'thread',
      turnId: 'turn',
      callId: 'call',
      tool: 'pfc_read_file',
      arguments: { path: 'example.txt' },
    };
    assert.throws(() => b.bind({ id: 3, params: p }), {
      code: 'TOOL_ITEM_UNVERIFIED',
    });
    b.observe({
      method: 'item/started',
      params: {
        threadId: 'thread',
        turnId: 'turn',
        item: {
          type: 'dynamicToolCall',
          id: 'call',
          tool: 'pfc_read_file',
          arguments: p.arguments,
        },
      },
    });
    const first = b.bind({ id: 3, params: p });
    assert.equal(first.itemId, 'call');
    assert.throws(
      () => b.bind({ id: 4, params: { ...p, threadId: 'other' } }),
      { code: 'TOOL_IDENTITY_MISMATCH' },
    );
    assert.throws(
      () => b.bind({ id: 4, params: { ...p, arguments: { path: 'new.txt' } } }),
      { code: 'TOOL_ITEM_UNVERIFIED' },
    );
    assert.throws(() => b.bind({ id: 4, params: p }), {
      code: 'TOOL_CALL_REUSED',
    });
    b.stop();
    assert.throws(() => b.bind({ id: 3, params: p }), {
      code: 'TURN_CANCELLED',
    });
  },
);
await scenario(
  report,
  'New host budget is separate, serial, bounded and counts failed dispatches',
  async () => {
    fs.mkdirSync(workRoot, { recursive: true });
    const ledger = path.join(workRoot, 'model-budget.json');
    const { createBudget } = require('./src/agent/budget');
    try {
      const budget = createBudget({
        ledger,
        packageId: '48-ai-tools-host-exec-20260917',
        maxConcurrency: 1,
      });
      const a = await budget.reserveTurn();
      await assert.rejects(budget.reserveTurn(), {
        code: 'MODEL_CONCURRENCY_LIMIT',
      });
      await budget.settleTurn(1, 'FAILED', {}, a.attemptId);
      assert.equal(budget.snapshot().turns, 1);
      assert.equal(budget.snapshot().unresolved, 0);
    } finally {
      if (fs.existsSync(ledger)) fs.unlinkSync(ledger);
    }
  },
);
await scenario(
  report,
  'Fixed command path stays closed without verified OS read/write/network mechanism',
  async () => {
    const {
      commandCapability,
      runCommand,
    } = require('./src/agent/test-runner');
    assert.equal(commandCapability().supported, false);
    let requests = 0;
    await assert.rejects(
      runCommand(
        {
          rpc: {
            request() {
              requests++;
            },
          },
        },
        'node-test',
        {},
      ),
      { code: 'HOST_COMMAND_SANDBOX_UNVERIFIED' },
    );
    assert.equal(requests, 0);
  },
);
await scenario(
  report,
  'Unconfirmed tool effects cannot become a successful job; expired plans and cancellation stop file access',
  () => {
    assert.equal(
      require('./src/agent/job-control')
        .createControl()
        .terminalState('TOOL_EFFECT_UNCONFIRMED'),
      'UNKNOWN',
    );
    const f = workspaceFixture('model-expiry');
    const now = Date.now;
    try {
      const scope = require('./src/agent/scope-policy').createScope(
        f.workspace,
        plan(f.workspace),
      );
      Date.now = () => now() + 301000;
      assert.throws(() => scope.read({ path: 'example.txt' }), {
        code: 'PLAN_EXPIRED',
      });
      Date.now = now;
      scope.stop();
      assert.throws(
        () =>
          scope.write({
            path: 'new.txt',
            expectedHash: null,
            content: 'cancelled',
          }),
        { code: 'TURN_CANCELLED' },
      );
      assert.equal(fs.existsSync(path.join(f.workspace, 'new.txt')), false);
    } finally {
      Date.now = now;
      f.cleanup();
    }
  },
);
saveReport(report, 'model');
