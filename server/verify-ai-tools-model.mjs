import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { TextConversation } from './src/agent/conversation-provider.js';
import {
  textConversationFixture,
  instructionSourceFixture,
} from './test-data/ai-tools-fixture.mjs';
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: 'text session policy only; full state/approval gate pending',
  tests: [],
};
try {
  const { textThreadParams, assertTextThread, checkedTextInput } =
    await import('./src/agent/config.js');
  const test = async (name, fn) => {
    await fn();
    report.tests.push({ name, status: 'PASS' });
  };
  const cwd = process.cwd();
  await test('Only the exact approved instruction source and fingerprint are accepted', async () => {
    const f = await instructionSourceFixture();
    try {
      const { assertInstructionSources } =
        await import('./src/agent/config.js');
      assert.equal(typeof assertInstructionSources, 'function');
      assertInstructionSources([f.file], [f.approval]);
      for (const [sources, approval] of [
        [[f.file], []],
        [[f.file, f.file + '.other'], [f.approval]],
        [[], [f.approval]],
        [[f.file], [{ ...f.approval, sha256: '0'.repeat(64) }]],
      ])
        assert.throws(() => assertInstructionSources(sources, approval), {
          code: 'THREAD_CONTEXT_UNVERIFIED',
        });
      await f.addOverride();
      assert.throws(() => assertInstructionSources([f.file], [f.approval]), {
        code: 'THREAD_CONTEXT_UNVERIFIED',
      });
    } finally {
      await f.cleanup();
    }
  });
  await test('A changed context is blocked before budget reservation or turn dispatch', async () => {
    const f = await instructionSourceFixture();
    const { session, calls } = textConversationFixture(TextConversation, cwd);
    let reservations = 0;
    try {
      session.instructionSources = [f.file];
      session.approvedInstructionSources = [f.approval];
      await f.change();
      await assert.rejects(
        session.runText({
          text: 'CODEx_TEST_context',
          reserveTurn: () => reservations++,
        }),
        { code: 'THREAD_CONTEXT_UNVERIFIED' },
      );
      assert.equal(reservations, 0);
      assert.deepEqual(calls, []);
    } finally {
      await session.close();
      await f.cleanup();
    }
  });
  await test('Context is rechecked after an asynchronous reservation immediately before dispatch', async () => {
    const f = await instructionSourceFixture();
    const { session, calls } = textConversationFixture(TextConversation, cwd);
    try {
      session.instructionSources = [f.file];
      session.approvedInstructionSources = [f.approval];
      await assert.rejects(
        session.runText({ text: 'CODEx_TEST_context', reserveTurn: f.change }),
        { code: 'THREAD_CONTEXT_UNVERIFIED' },
      );
      assert.deepEqual(calls, []);
    } finally {
      await session.close();
      await f.cleanup();
    }
  });
  await test('Context excludes inherited instructions, skills, environment access and tool capabilities', () => {
    const p = textThreadParams({ model: 'synthetic' }, cwd, {
      data: [{ skills: [{ path: cwd + '/synthetic/SKILL.md' }], errors: [] }],
    });
    assert.equal(p.config.project_doc_max_bytes, 0);
    assert.equal(p.config['skills.config'][0].enabled, false);
    assert.deepEqual(p.environments, []);
    assert.deepEqual(p.selectedCapabilityRoots, []);
    assert.equal(p.ephemeral, true);
    assert.equal(p.allowProviderModelFallback, false);
  });
  await test('Unknown skill inventory and unexpected thread settings fail before any turn', () => {
    assert.throws(
      () =>
        textThreadParams({ model: 'synthetic' }, cwd, {
          data: [{ skills: [], errors: [{}] }],
        }),
      { code: 'SKILL_INVENTORY_UNVERIFIED' },
    );
    const t = {
      thread: { id: 'synthetic-thread' },
      cwd,
      model: 'synthetic',
      sandbox: { type: 'readOnly', networkAccess: false },
      instructionSources: [],
      approvalPolicy: 'on-request',
    };
    assertTextThread(t, { model: 'synthetic' }, cwd);
    assert.throws(
      () =>
        assertTextThread(
          { ...t, instructionSources: ['private'] },
          { model: 'synthetic' },
          cwd,
        ),
      { code: 'THREAD_CONTEXT_UNVERIFIED' },
    );
    assert.throws(
      () =>
        assertTextThread({ ...t, model: 'other' }, { model: 'synthetic' }, cwd),
      { code: 'THREAD_CONTEXT_UNVERIFIED' },
    );
    assert.throws(
      () =>
        assertTextThread(
          { ...t, sandbox: { type: 'dangerFullAccess' } },
          { model: 'synthetic' },
          cwd,
        ),
      { code: 'THREAD_CONTEXT_UNVERIFIED' },
    );
  });
  await test('Only bounded explicit text is accepted; paths or tool inputs cannot be injected', () => {
    assert.deepEqual(checkedTextInput('CODEx_TEST_synthetic'), [
      { type: 'text', text: 'CODEx_TEST_synthetic', text_elements: [] },
    ]);
    for (const x of [
      '',
      'x'.repeat(200001),
      { type: 'localImage', path: 'private' },
    ])
      assert.throws(() => checkedTextInput(x), { code: 'TEXT_INPUT_INVALID' });
  });
  await test('Rejected reservation sends no turn and closes the owned session', async () => {
    const { session, calls, state } = textConversationFixture(
      TextConversation,
      cwd,
    );
    await assert.rejects(
      session.runText({
        text: 'CODEx_TEST_reservation',
        reserveTurn: () => {
          throw Object.assign(new Error('LIMIT'), { code: 'LIMIT' });
        },
      }),
      { code: 'LIMIT' },
    );
    assert.deepEqual(calls, []);
    assert.equal(state.closed, true);
  });
  await test('Cross-thread text is ignored and provider failure cannot become success', async () => {
    const { session, state } = textConversationFixture(TextConversation, cwd);
    const promise = session.runText({
      text: 'CODEx_TEST_failure',
      reserveTurn: () => {},
    });
    session.receive({
      method: 'item/completed',
      params: {
        threadId: 'other',
        item: { type: 'agentMessage', text: 'forged' },
      },
    });
    session.receive({
      method: 'turn/completed',
      params: {
        threadId: session.threadId,
        turn: { id: 'CODEx_TEST_turn', status: 'failed' },
      },
    });
    await assert.rejects(promise, { code: 'TURN_FAILED' });
    assert.equal(state.closed, true);
  });
  await test('Provider terminal text is required; valid events retain correlated identity', async () => {
    const { session } = textConversationFixture(TextConversation, cwd);
    const promise = session.runText({
      text: 'CODEx_TEST_result',
      reserveTurn: () => {},
    });
    session.receive({
      method: 'item/completed',
      params: {
        threadId: session.threadId,
        item: {
          type: 'agentMessage',
          phase: 'final_answer',
          text: 'CODEx_TEST_answer',
        },
      },
    });
    session.receive({
      method: 'turn/completed',
      params: {
        threadId: session.threadId,
        turn: { id: 'CODEx_TEST_turn', status: 'completed' },
      },
    });
    const result = await promise;
    assert.equal(result.text, 'CODEx_TEST_answer');
    assert.equal(result.turnId, 'CODEx_TEST_turn');
    await session.close();
  });
  await test('Late events from another turn in the same thread cannot replace the new result', async () => {
    const { session } = textConversationFixture(TextConversation, cwd);
    const promise = session.runText({
      text: 'CODEx_TEST_next',
      reserveTurn: () => {},
    });
    session.receive({
      method: 'item/completed',
      params: {
        threadId: session.threadId,
        turnId: 'CODEx_TEST_old',
        item: { type: 'agentMessage', text: 'stale' },
      },
    });
    session.receive({
      method: 'turn/completed',
      params: {
        threadId: session.threadId,
        turn: { id: 'CODEx_TEST_old', status: 'completed' },
      },
    });
    session.receive({
      method: 'item/completed',
      params: {
        threadId: session.threadId,
        turnId: 'CODEx_TEST_turn',
        item: { type: 'agentMessage', text: 'fresh' },
      },
    });
    session.receive({
      method: 'turn/completed',
      params: {
        threadId: session.threadId,
        turn: { id: 'CODEx_TEST_turn', status: 'completed' },
      },
    });
    assert.equal((await promise).text, 'fresh');
    await session.close();
  });
  report.status = 'PASS';
} catch (e) {
  report.error = {
    code: e.code ?? 'ASSERTION_FAILED',
    message: e.message.slice(0, 180),
  };
  process.exitCode = 1;
} finally {
  const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
  mkdirSync(root, { recursive: true });
  const file = `${root}/model-${Date.now()}.json`;
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
