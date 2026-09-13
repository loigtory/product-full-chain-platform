import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import {
  fixture,
  schema,
  runId,
  toRequirement,
  bundle,
} from './test-data/r3-verification-fixture.mjs';
const require = createRequire(import.meta.url);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  data: runId + ': deterministic synthetic only',
  results: [],
};
let f;
async function test(name, fn) {
  const start = performance.now();
  await fn();
  report.results.push({
    name,
    status: 'PASS',
    durationMs: Math.round(performance.now() - start),
  });
  console.log('PASS ' + name);
}
try {
  f = await fixture({ start: false });
  await test('T16 explicit005 and unchanged001-004 prefix', async () => {
    const migrations = require('./src/persistence/migrations');
    assert.equal(f.db.targetVersion, '006');
    assert.deepEqual(
      migrations.registry('005').slice(0, 4),
      migrations.registry('004'),
    );
    await migrations.assertReady(f.db);
    const versions = (
      await f.admin.query(
        `SELECT version FROM "${schema}".schema_migrations ORDER BY version`,
      )
    ).rows.map((x) => x.version);
    assert.deepEqual(versions, ['001', '002', '003', '004', '005', '006']);
    await f.admin.query(
      `ALTER TABLE "${schema}".test_results DISABLE TRIGGER test_results_immutable`,
    );
    await assert.rejects(
      migrations.assertReady(f.db),
      (e) => e.code === 'MIGRATION_NOT_READY',
    );
    await f.admin.query(
      `ALTER TABLE "${schema}".test_results ENABLE TRIGGER test_results_immutable`,
    );
    await migrations.assertReady(f.db);
    await f.admin.query(
      'ALTER TABLE "' + schema + '".test_cases RENAME TO codex_missing_cases',
    );
    try {
      await assert.rejects(
        migrations.assertReady(f.db),
        (e) => e.code === 'MIGRATION_NOT_READY',
      );
    } finally {
      await f.admin.query(
        'ALTER TABLE "' + schema + '".codex_missing_cases RENAME TO test_cases',
      );
    }
    const checksum = (
      await f.admin.query(
        'SELECT checksum FROM "' +
          schema +
          "\".schema_migrations WHERE version='005'",
      )
    ).rows[0].checksum;
    await f.admin.query(
      'UPDATE "' +
        schema +
        "\".schema_migrations SET checksum=$1 WHERE version='005'",
      ['0'.repeat(64)],
    );
    try {
      await assert.rejects(
        migrations.assertReady(f.db),
        (e) => e.code === 'MIGRATION_CHECKSUM_MISMATCH',
      );
    } finally {
      await f.admin.query(
        'UPDATE "' +
          schema +
          "\".schema_migrations SET checksum=$1 WHERE version='005'",
        [checksum],
      );
    }
    await migrations.assertReady(f.db);
  });
  await f.startRuntime();
  for (const who of ['owner', 'owner2', 'executor', 'viewer', 'other'])
    await f.login(who);
  let item, batch;
  await test('T01-T03 adopted suite and atomic delivery into test', async () => {
    item = await f.prepare();
    assert.equal(item.req.stage, 'test');
    assert.equal(item.req.verification.ready, true);
    assert.equal(item.suite.status, 'READY');
    assert.equal(item.draft.suite.status, 'INCOMPLETE');
    const bypass = await f.raw('/reqs/' + item.id + '/stage', 'PATCH', {
      to: 'accept',
      ...f.command(),
      expectedRevision: item.req.revision,
    });
    assert.equal(bypass.body.error.code, 'TEST_COMPLETION_REQUIRED');
  });
  await test('T04-T08 manual results and complete test report', async () => {
    batch = await f.batch(item);
    const empty = await f.write(
      item.id,
      '/test-batches/' + batch.id + '/complete',
      {},
      409,
    );
    assert.equal(empty.error.code, 'TEST_RESULT_REQUIRED');
    const forged = await f.write(
      item.id,
      '/test-batches/' + batch.id + '/results',
      { results: [{ ...f.result(item), source: 'CI_VERIFIED' }] },
      400,
    );
    assert.equal(forged.error.code, 'INVALID_TEST_SOURCE');
    const added = await f.write(
      item.id,
      '/test-batches/' + batch.id + '/results',
      { results: [f.result(item)] },
      201,
    );
    assert.equal(added.results[0].source, 'USER_REPORTED');
    const completed = await f.write(
      item.id,
      '/test-batches/' + batch.id + '/complete',
      {},
    );
    assert.equal(completed.nextStage, 'accept');
  });
  await test('T09 product acceptance and read-only release inputs', async () => {
    const input = {
      baselineId: item.delivery.id,
      batchId: batch.id,
      decision: 'ACCEPTED',
      checks: { functionality: true, exceptions: true, evidence: true },
      comment: 'CODEx_TEST_产品检查完成',
      risks: '无',
    };
    const denied = await f.write(
      item.id,
      '/product-acceptances',
      input,
      403,
      'executor',
    );
    assert.equal(denied.error.code, 'FORBIDDEN');
    const accepted = await f.write(item.id, '/product-acceptances', input, 201);
    assert.equal(accepted.nextStage, 'release');
    const inputs = await f.api('/reqs/' + item.id + '/release-inputs');
    assert.equal(inputs.inputsReady, true);
    assert.equal(inputs.scope, 'PREPARATION_ONLY');
    assert.equal(inputs.executionAvailable, false);
    await f.restart();
    const after = await f.api('/reqs/' + item.id + '/release-inputs');
    assert.equal(after.acceptance.id, accepted.acceptance.id);
    assert.equal(after.inputsReady, true);
  });

  await test('T01 early draft before business/design confirmation survives restart', async () => {
    const q = await toRequirement(f, 'early'),
      w = await f.api('/reqs/' + q.id + '/artifact-workspace');
    const proposal = await f.write(
      q.id,
      '/artifact-proposals',
      {
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: bundle(),
      },
      201,
    );
    await f.write(
      q.id,
      '/artifact-proposals/' + proposal.proposal.id + '/adopt',
      { baselineGroupId: null, inputFingerprint: w.inputFingerprint },
    );
    const g = (await f.api('/reqs/' + q.id + '/artifact-workspace'))
      .currentGroup;
    const draft = await f.write(
      q.id,
      '/test-suites',
      { baseGroupId: g.id, fromAcceptance: true },
      201,
    );
    assert.equal(draft.suite.status, 'INCOMPLETE');
    assert.equal(
      (
        await f.write(
          q.id,
          '/test-suites/' + draft.suite.id + '/adopt',
          { baseGroupId: g.id, currentSuiteId: null },
          409,
        )
      ).error.code,
      'TEST_SUITE_INCOMPLETE',
    );
    assert.equal(
      (
        await f.write(
          q.id,
          '/delivery-baselines',
          await item.deliveryBody(),
          409,
        )
      ).error.code,
      'TEST_HANDOFF_REQUIRED',
    );
    await f.restart();
    assert.equal(
      (await f.api('/reqs/' + q.id + '/test-suites/' + draft.suite.id)).suite
        .id,
      draft.suite.id,
    );
    await f.api(
      '/reqs/' + q.id + '/test-suites/' + item.suite.id,
      'GET',
      undefined,
      'owner',
      404,
    );
    await f.api(
      '/reqs/' + q.id + '/verification-workspace',
      'GET',
      undefined,
      'other',
      404,
    );
    await f.write(
      q.id,
      '/test-suites',
      { baseGroupId: g.id, fromAcceptance: true },
      403,
      'viewer',
    );
  });
  await test('T02 T10 draft preservation and explicit adoption invalidate release only when adopted', async () => {
    const saved = await f.write(
      item.id,
      '/test-suites',
      {
        baseGroupId: item.group.id,
        baseSuiteId: item.suite.id,
        cases: item.cases,
      },
      201,
    );
    assert.equal(
      (await f.api('/reqs/' + item.id + '/release-inputs')).inputsReady,
      true,
    );
    await f.write(
      item.id,
      '/test-suites/' + saved.suite.id + '/adopt',
      { baseGroupId: item.group.id, currentSuiteId: null },
      409,
    );
    await f.write(item.id, '/test-suites/' + saved.suite.id + '/adopt', {
      baseGroupId: item.group.id,
      currentSuiteId: item.suite.id,
    });
    assert.equal((await f.refresh(item.id)).stage, 'dev');
    assert.equal(
      (await f.api('/reqs/' + item.id + '/release-inputs')).inputsReady,
      false,
    );
    assert.equal(
      (await f.api('/reqs/' + item.id + '/product-acceptances')).total,
      1,
    );
  });
  let cycle, cb, failed, defect;
  await test('T05 T06 atomic mixed batch, command replay and concurrent result sequence', async () => {
    cycle = await f.prepare('regression');
    cb = await f.batch(cycle);
    const path = '/reqs/' + cycle.id + '/test-batches/' + cb.id + '/results';
    const body = {
      results: [f.result(cycle, 'FAIL'), { ...f.result(cycle), caseId: 'BAD' }],
      expectedRevision: (await f.refresh(cycle.id)).revision,
      ...f.command(),
    };
    assert.equal((await f.raw(path, 'POST', body)).status, 400);
    assert.equal(
      (await f.api('/reqs/' + cycle.id + '/test-batches/' + cb.id)).results
        .total,
      0,
    );
    body.results = [f.result(cycle, 'FAIL')];
    const alternate = { ...body, ...f.command() };
    const rows = await Promise.all([
      f.raw(path, 'POST', body),
      f.raw(path, 'POST', alternate),
    ]);
    assert.deepEqual(rows.map((r) => r.status).sort(), [201, 409]);
    failed = rows.find((r) => r.status === 201).body.results[0];
    const win = rows[0].status === 201 ? body : alternate;
    if (win) {
      assert.equal(
        (await f.raw(path, 'POST', win)).body.results[0].id,
        failed.id,
      );
      assert.equal(
        (
          await f.raw(path, 'POST', {
            ...win,
            results: [f.result(cycle, 'PASS')],
          })
        ).body.error.code,
        'COMMAND_CONFLICT',
      );
      assert.equal(
        (
          await f.raw(
            '/reqs/' + item.id + '/test-batches/' + cb.id + '/results',
            'POST',
            win,
          )
        ).body.error.code,
        'COMMAND_CONFLICT',
      );
    }
    assert.equal(
      (await f.api('/reqs/' + cycle.id + '/test-batches/' + cb.id)).results
        .total,
      1,
    );
    assert.equal(
      (await f.write(cycle.id, '/test-batches/' + cb.id + '/complete', {}, 409))
        .error.code,
      'TEST_RESULT_REQUIRED',
    );
  });
  await test('T07 T08 defect fixed new delivery and failed then passed regression', async () => {
    defect = (
      await f.write(
        cycle.id,
        '/defects',
        {
          resultId: failed.id,
          title: 'CODEx_TEST_未提示必填',
          description: 'CODEx_TEST_名称为空仍保存',
        },
        201,
      )
    ).defect;
    const oldDev = (await f.refresh(cycle.id)).versions
      .filter((v) => v.stage === 'dev')
      .at(-1).id;
    await f.write(
      cycle.id,
      '/defects/' + defect.id + '/resolve',
      {
        devVersionId: oldDev,
        comment: 'CODEx_TEST_修复',
        evidence: [cycle.evidence],
      },
      409,
    );
    await f.saveDev(cycle.id, '修复一');
    const dev = (await cycle.deliveryBody()).devVersionId;
    await f.write(cycle.id, '/defects/' + defect.id + '/resolve', {
      devVersionId: dev,
      comment: 'CODEx_TEST_补充必填',
      evidence: [cycle.evidence],
    });
    assert.equal((await f.refresh(cycle.id)).stage, 'dev');
    await cycle.handoff();
    let b = await f.batch(cycle),
      r = (
        await f.write(
          cycle.id,
          '/test-batches/' + b.id + '/results',
          { results: [f.result(cycle, 'FAIL')] },
          201,
        )
      ).results[0];
    const reopened = await f.write(
      cycle.id,
      '/defects/' + defect.id + '/retest',
      { resultId: r.id, comment: 'CODEx_TEST_仍未通过' },
    );
    assert.equal(reopened.defect.state, 'REOPEN');
    await f.saveDev(cycle.id, '修复二');
    await f.write(cycle.id, '/defects/' + defect.id + '/resolve', {
      devVersionId: (await cycle.deliveryBody()).devVersionId,
      comment: 'CODEx_TEST_修复全部路径',
      evidence: [cycle.evidence],
    });
    await cycle.handoff();
    b = await f.batch(cycle);
    r = (
      await f.write(
        cycle.id,
        '/test-batches/' + b.id + '/results',
        { results: [f.result(cycle)] },
        201,
      )
    ).results[0];
    assert.equal(
      (await f.write(cycle.id, '/test-batches/' + b.id + '/complete', {}, 409))
        .error.code,
      'DEFECT_RETEST_REQUIRED',
    );
    const closed = await f.write(
      cycle.id,
      '/defects/' + defect.id + '/retest',
      { resultId: r.id, comment: 'CODEx_TEST_全部回归通过' },
    );
    assert.equal(closed.defect.state, 'CLOSED');
    const history = await f.api('/reqs/' + cycle.id + '/defects/' + defect.id);
    assert.deepEqual(
      history.events
        .sort((a, b) => a.sequence - b.sequence)
        .map((e) => e.state),
      ['OPEN', 'RESOLVED', 'REOPEN', 'RESOLVED', 'CLOSED'],
    );
    await f.write(cycle.id, '/test-batches/' + b.id + '/complete', {});
    cb = b;
  });
  await test('T09 Owner rejection and demotion blocks successful receipt replay', async () => {
    const baseline = (await f.refresh(cycle.id)).verification.currentDelivery;
    const body = {
      ...f.command(),
      expectedRevision: (await f.refresh(cycle.id)).revision,
      baselineId: baseline.id,
      batchId: cb.id,
      decision: 'ACCEPTED',
      checks: { functionality: true, exceptions: true, evidence: true },
      comment: 'CODEx_TEST_确认',
      risks: '无',
    };
    const path = '/reqs/' + cycle.id + '/product-acceptances',
      ok = await f.api(path, 'POST', body, 'owner', 201);
    const owner = (await f.api('/members')).items.find(
      (m) => m.name === runId + '_owner',
    );
    const down = await f.api(
      '/members/' + owner.id + '/role',
      'PATCH',
      { role: 'executor', expectedRevision: owner.revision, ...f.command() },
      'owner2',
    );
    assert.equal((await f.raw(path, 'POST', body)).status, 403);
    assert.equal(
      (await f.api('/reqs/' + cycle.id + '/release-inputs')).inputsReady,
      false,
    );
    await f.api(
      '/members/' + owner.id + '/role',
      'PATCH',
      { role: 'owner', expectedRevision: down.member.revision, ...f.command() },
      'owner2',
    );
    assert.equal(
      (await f.api(path, 'POST', body, 'owner', 201)).acceptance.id,
      ok.acceptance.id,
    );
    const newBatch = await f.batch(cycle);
    await f.write(
      cycle.id,
      '/test-batches/' + newBatch.id + '/results',
      { results: [f.result(cycle)] },
      201,
    );
    assert.equal((await f.refresh(cycle.id)).stage, 'dev');
    assert.equal(
      (await f.api('/reqs/' + cycle.id + '/release-inputs')).inputsReady,
      false,
    );
    await cycle.handoff();
    const rejectedBatch = await f.batch(cycle);
    await f.write(
      cycle.id,
      '/test-batches/' + rejectedBatch.id + '/results',
      { results: [f.result(cycle)] },
      201,
    );
    await f.write(
      cycle.id,
      '/test-batches/' + rejectedBatch.id + '/complete',
      {},
    );
    const rejected = await f.write(
      cycle.id,
      '/product-acceptances',
      {
        ...body,
        baselineId: (await f.refresh(cycle.id)).verification.currentDelivery.id,
        batchId: rejectedBatch.id,
        decision: 'REJECTED',
        comment: 'CODEx_TEST_业务例外未接受',
      },
      201,
    );
    assert.equal(rejected.nextStage, 'dev');
  });
  await test('T12 immutable projections and new-stage chat with report and attachment refs', async () => {
    await item.handoff();
    const b = await f.batch(item);
    await f.write(
      item.id,
      '/test-batches/' + b.id + '/results',
      { results: [f.result(item)] },
      201,
    );
    await f.write(item.id, '/test-batches/' + b.id + '/complete', {});
    const req = await f.refresh(item.id),
      v = req.versions.filter((v) => v.stage === 'test').at(-1);
    await f.write(
      item.id,
      '/versions',
      { stage: 'test', baseVersionId: v.id, content: v.content },
      409,
    );
    assert.equal(
      (
        await f.write(
          item.id,
          '/versions/' + v.id + '/reviews',
          { result: '通过', comment: 'CODEx_TEST_通用绕过' },
          409,
        )
      ).error.code,
      'VERIFICATION_WRITE_REQUIRED',
    );
    assert.equal(
      (await f.write(item.id, '/versions/' + v.id + '/confirm', {}, 409)).error
        .code,
      'VERIFICATION_WRITE_REQUIRED',
    );
    for (const stage of ['test', 'accept']) {
      const sent = await f.write(
        item.id,
        '/messages',
        {
          stage,
          content: 'CODEx_TEST_核对当前报告',
          refs: [
            { kind: 'artifact', id: v.id, version: v.version },
            { kind: 'attachment', ...item.evidence },
          ],
        },
        201,
      );
      assert.ok(sent);
    }
    const messages = await f.api('/reqs/' + item.id + '/messages?limit=100');
    assert.ok(messages.items.some((m) => m.stage === 'accept'));
    await assert.rejects(
      f.admin.query(
        'UPDATE "' +
          schema +
          '".req_versions SET content=content||\'{"title":"tamper"}\'::jsonb WHERE public_id=$1',
        [v.id],
      ),
    );
  });
  await test('T11 attachment permissions and corruption block use without changing input on unused uploads', async () => {
    const before = await f.api('/reqs/' + item.id + '/verification-workspace');
    await f.upload(item.id);
    assert.equal(
      (await f.api('/reqs/' + item.id + '/verification-workspace')).ready,
      before.ready,
    );
    await f.admin.query(
      'UPDATE "' + schema + '".materials SET allowed=false WHERE public_id=$1',
      [item.evidence.id],
    );
    assert.equal(
      (await f.api('/reqs/' + item.id + '/verification-workspace')).ready,
      false,
    );
    assert.equal(
      (
        await f.api(
          '/reqs/' +
            item.id +
            '/delivery-baselines/' +
            before.currentDelivery.id,
          'GET',
          undefined,
          'owner',
          409,
        )
      ).error.code,
      'VERIFICATION_EVIDENCE_UNAVAILABLE',
    );
    await f.admin.query(
      'UPDATE "' + schema + '".materials SET allowed=true WHERE public_id=$1',
      [item.evidence.id],
    );
  });
  await test('T14 result/proof/audit/event/receipt transaction rolls back on injected failure', async () => {
    await cycle.handoff();
    const b = await f.batch(cycle),
      path = '/reqs/' + cycle.id + '/test-batches/' + b.id + '/results';
    const tables = [
      'test_results',
      'verification_refs',
      'audit_logs',
      'domain_events',
      'command_receipts',
    ];
    const counts = async () =>
      Promise.all(
        tables.map(async (t) => [
          t,
          Number(
            (
              await f.admin.query(
                'SELECT count(*) n FROM "' + schema + '"."' + t + '"',
              )
            ).rows[0].n,
          ),
        ]),
      );
    const before = await counts(),
      revision = (await f.refresh(cycle.id)).revision;
    await f.admin.query(
      'CREATE FUNCTION "' +
        schema +
        "\".codex_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CODEx_TEST_rollback'; END $$",
    );
    await f.admin.query(
      'CREATE TRIGGER codex_fault BEFORE INSERT ON "' +
        schema +
        '".verification_refs FOR EACH ROW EXECUTE FUNCTION "' +
        schema +
        '".codex_fault()',
    );
    const body = {
      results: [f.result(cycle)],
      ...f.command(),
      expectedRevision: revision,
    };
    assert.equal((await f.raw(path, 'POST', body)).status, 503);
    assert.deepEqual(await counts(), before);
    assert.equal((await f.refresh(cycle.id)).revision, revision);
    await f.admin.query(
      'DROP TRIGGER codex_fault ON "' + schema + '".verification_refs',
    );
    await f.admin.query('DROP FUNCTION "' + schema + '".codex_fault()');
    assert.equal((await f.raw(path, 'POST', body)).status, 201);
  });
  await test('T15 pagination and open batch limits', async () => {
    await f.api(
      '/reqs/' + item.id + '/test-suites?limit=101',
      'GET',
      undefined,
      'owner',
      400,
    );
    await f.api(
      '/reqs/' + item.id + '/test-suites?offset=10001',
      'GET',
      undefined,
      'owner',
      400,
    );
    const all = await f.api('/reqs/' + cycle.id + '/test-batches?limit=100');
    for (const b of all.items.filter((b) => b.state === 'OPEN'))
      await f.write(cycle.id, '/test-batches/' + b.id + '/cancel', {
        reason: 'CODEx_TEST_边界清理',
      });
    for (let i = 0; i < 5; i++) await f.batch(cycle);
    const rejected = await f.write(
      cycle.id,
      '/test-batches',
      {
        baselineId: (await f.refresh(cycle.id)).verification.currentDelivery.id,
        source: 'USER_REPORTED',
        environment: 'CODEx_TEST_',
      },
      409,
    );
    assert.equal(rejected.error.code, 'VERIFICATION_LIMIT_EXCEEDED');
  });

  await test('T11 actual evidence hash/missing-file checks and revoked result actor', async () => {
    const t = await f.prepare('proof_faults'),
      b = await f.batch(t);
    const row = (
      await f.admin.query(
        'SELECT f.tenant_id,f.hash FROM "' +
          schema +
          '".materials m JOIN "' +
          schema +
          '".material_versions v ON v.material_id=m.id AND v.version=m.version JOIN "' +
          schema +
          '".file_objects f ON f.id=v.file_id WHERE m.public_id=$1',
        [t.evidence.id],
      )
    ).rows[0];
    const path = resolve(f.filesRoot, row.tenant_id, row.hash),
      rel = relative(f.filesRoot, path);
    assert.ok(!rel.startsWith('..') && !isAbsolute(rel));
    const bytes = readFileSync(path);
    try {
      writeFileSync(path, 'CODEx_TEST_corrupt');
      assert.equal(
        (await f.api('/reqs/' + t.id + '/verification-workspace')).ready,
        false,
      );
      unlinkSync(path);
      assert.equal(
        (await f.api('/reqs/' + t.id + '/verification-workspace')).ready,
        false,
      );
    } finally {
      writeFileSync(path, bytes);
    }
    assert.equal(
      (await f.api('/reqs/' + t.id + '/verification-workspace')).ready,
      true,
    );
    const cross = await f.write(
      t.id,
      '/test-batches/' + b.id + '/results',
      { results: [{ ...f.result(t), evidence: [item.evidence] }] },
      409,
    );
    assert.equal(cross.error.code, 'VERIFICATION_EVIDENCE_UNAVAILABLE');
    await f.write(
      t.id,
      '/test-batches/' + b.id + '/results',
      { results: [f.result(t)] },
      201,
      'executor',
    );
    const member = (await f.api('/members')).items.find(
      (m) => m.name === runId + '_executor',
    );
    const down = await f.api('/members/' + member.id + '/role', 'PATCH', {
      role: 'viewer',
      expectedRevision: member.revision,
      ...f.command(),
    });
    await f.write(t.id, '/test-batches/' + b.id + '/complete', {}, 409);
    await f.api('/members/' + member.id + '/role', 'PATCH', {
      role: 'executor',
      expectedRevision: down.member.revision,
      ...f.command(),
    });
    await f.write(t.id, '/test-batches/' + b.id + '/complete', {});
  });
  await test('T10 older open batch results invalidate completed test before acceptance', async () => {
    const t = await f.prepare('older_open'),
      older = await f.batch(t),
      newer = await f.batch(t);
    await f.write(
      t.id,
      '/test-batches/' + newer.id + '/results',
      { results: [f.result(t)] },
      201,
    );
    await f.write(t.id, '/test-batches/' + newer.id + '/complete', {});
    assert.equal((await f.refresh(t.id)).stage, 'accept');
    await f.write(
      t.id,
      '/test-batches/' + older.id + '/results',
      { results: [f.result(t, 'FAIL')] },
      201,
    );
    const q = await f.refresh(t.id);
    assert.equal(q.stage, 'test');
    assert.equal(q.verification.currentTest, null);
  });
  await test('T14 delivery/defect/acceptance and audit/event/receipt faults roll back atomically', async () => {
    const tables = [
      'delivery_baselines',
      'test_batches',
      'test_results',
      'defects',
      'defect_events',
      'product_acceptances',
      'verification_refs',
      'req_versions',
      'audit_logs',
      'domain_events',
      'command_receipts',
    ];
    const counts = async () => {
      const result = {};
      for (const t of tables)
        result[t] = Number(
          (
            await f.admin.query(
              'SELECT count(*) n FROM "' + schema + '"."' + t + '"',
            )
          ).rows[0].n,
        );
      return result;
    };
    const fault = async (id, path, input, table) => {
      assert.ok(tables.includes(table));
      const before = await counts(),
        revision = (await f.refresh(id)).revision,
        body = { ...input, ...f.command(), expectedRevision: revision };
      await f.admin.query(
        'CREATE FUNCTION "' +
          schema +
          "\".codex_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CODEx_TEST_rollback'; END $$",
      );
      await f.admin.query(
        'CREATE TRIGGER codex_fault BEFORE INSERT ON "' +
          schema +
          '"."' +
          table +
          '" FOR EACH ROW EXECUTE FUNCTION "' +
          schema +
          '".codex_fault()',
      );
      try {
        assert.equal(
          (await f.raw('/reqs/' + id + path, 'POST', body)).status,
          503,
        );
        assert.deepEqual(await counts(), before);
        assert.equal((await f.refresh(id)).revision, revision);
      } finally {
        await f.admin.query(
          'DROP TRIGGER codex_fault ON "' + schema + '"."' + table + '"',
        );
        await f.admin.query('DROP FUNCTION "' + schema + '".codex_fault()');
      }
      return body;
    };
    const t = await f.prepare('multi_fault', { handoff: false });
    for (const table of [
      'delivery_baselines',
      'audit_logs',
      'domain_events',
      'command_receipts',
    ])
      await fault(t.id, '/delivery-baselines', await t.deliveryBody(), table);
    await t.handoff();
    const b = await f.batch(t);
    const r = (
      await f.write(
        t.id,
        '/test-batches/' + b.id + '/results',
        { results: [f.result(t, 'FAIL')] },
        201,
      )
    ).results[0];
    const input = {
      resultId: r.id,
      title: 'CODEx_TEST_失败',
      description: 'CODEx_TEST_重现',
    };
    const body = await fault(t.id, '/defects', input, 'defect_events');
    const defect = (
      await f.api('/reqs/' + t.id + '/defects', 'POST', body, 'owner', 201)
    ).defect;
    await f.saveDev(t.id, '故障后修复');
    await f.write(t.id, '/defects/' + defect.id + '/resolve', {
      devVersionId: (await t.deliveryBody()).devVersionId,
      comment: 'CODEx_TEST_修复',
      evidence: [t.evidence],
    });
    await t.handoff();
    const b2 = await f.batch(t),
      r2 = (
        await f.write(
          t.id,
          '/test-batches/' + b2.id + '/results',
          { results: [f.result(t)] },
          201,
        )
      ).results[0];
    await f.write(t.id, '/defects/' + defect.id + '/retest', {
      resultId: r2.id,
      comment: 'CODEx_TEST_通过',
    });
    const pages = [];
    for (let offset = 0; offset < 3; offset++) {
      const p = await f.api(
        '/reqs/' + t.id + '/defects/' + defect.id + '?limit=1&offset=' + offset,
      );
      assert.equal(p.total, 3);
      pages.push(p.events[0].sequence);
    }
    assert.deepEqual(pages, [3, 2, 1]);
    await f.api(
      '/reqs/' + t.id + '/defects/' + defect.id + '?limit=101',
      'GET',
      undefined,
      'owner',
      400,
    );
    await f.write(t.id, '/test-batches/' + b2.id + '/complete', {});
    const acceptance = {
      baselineId: (await f.refresh(t.id)).verification.currentDelivery.id,
      batchId: b2.id,
      decision: 'ACCEPTED',
      checks: { functionality: true, exceptions: true, evidence: true },
      comment: 'CODEx_TEST_验收',
      risks: '无',
    };
    const receipt = await fault(
      t.id,
      '/product-acceptances',
      acceptance,
      'command_receipts',
    );
    assert.equal(
      (
        await f.api(
          '/reqs/' + t.id + '/product-acceptances',
          'POST',
          receipt,
          'owner',
          201,
        )
      ).nextStage,
      'release',
    );
  });

  await test('T03 active/unknown runs, old dev and stale input cannot hand off', async () => {
    const t = await f.prepare('handoff_gates', { handoff: false }),
      old = await t.deliveryBody();
    await f.saveDev(t.id, '新交付版本');
    await f.write(t.id, '/delivery-baselines', old, 409);
    const req = await f.refresh(t.id),
      plan = await f.api(
        '/runs',
        'POST',
        { ...f.command(), reqId: t.id, expectedRevision: req.revision },
        'owner',
        201,
      );
    for (const status of ['RUNNING', 'CANCELLING', 'UNKNOWN']) {
      await f.admin.query(
        'UPDATE "' + schema + '".runs SET status=$1 WHERE public_id=$2',
        [status, plan.run.id],
      );
      await f.write(t.id, '/delivery-baselines', await t.deliveryBody(), 409);
    }
    await f.admin.query(
      'UPDATE "' + schema + "\".runs SET status='CANCELLED' WHERE public_id=$1",
      [plan.run.id],
    );
    await t.handoff();
    assert.equal((await f.refresh(t.id)).stage, 'test');
  });
  await test('T10 upstream design/business changes backflow from each newly supported stage', async () => {
    for (const stage of ['test', 'accept', 'release']) {
      const t = await f.prepare('backflow_' + stage);
      if (stage !== 'test') {
        const b = await f.batch(t);
        await f.write(
          t.id,
          '/test-batches/' + b.id + '/results',
          { results: [f.result(t)] },
          201,
        );
        await f.write(t.id, '/test-batches/' + b.id + '/complete', {});
        if (stage === 'release')
          await f.write(
            t.id,
            '/product-acceptances',
            {
              baselineId: t.delivery.id,
              batchId: b.id,
              decision: 'ACCEPTED',
              checks: { functionality: true, exceptions: true, evidence: true },
              comment: 'CODEx_TEST_通过',
              risks: '无',
            },
            201,
          );
      }
      let req = await f.refresh(t.id);
      assert.equal(req.stage, stage);
      if (stage === 'accept') {
        const design = req.versions.filter((v) => v.stage === 'design').at(-1);
        await f.write(
          t.id,
          '/versions',
          {
            stage: 'design',
            baseVersionId: design.id,
            content: {
              ...design.content,
              fields: [
                { name: 'CODEx_TEST_设计', value: 'CODEx_TEST_补充异常分支' },
              ],
            },
          },
          201,
        );
        req = await f.refresh(t.id);
        assert.equal(req.stage, 'design');
      } else {
        const w = await f.api('/reqs/' + t.id + '/artifact-workspace'),
          ac = structuredClone(w.currentGroup.acceptance.content);
        ac.items[0].expected = 'CODEx_TEST_变化后的验收项';
        const proposal = await f.write(
          t.id,
          '/artifact-proposals',
          {
            baseGroupId: w.currentGroup.id,
            inputFingerprint: w.inputFingerprint,
            inputMode: 'manual',
            changes: { acceptance: ac },
          },
          201,
        );
        await f.write(
          t.id,
          '/artifact-proposals/' + proposal.proposal.id + '/adopt',
          {
            baselineGroupId: w.currentGroup.id,
            inputFingerprint: proposal.proposal.inputFingerprint,
          },
        );
        req = await f.refresh(t.id);
        assert.equal(req.stage, 'req');
      }
      assert.equal(req.verification.ready, false);
      assert.ok(
        (await f.api('/reqs/' + t.id + '/delivery-baselines')).items.some(
          (d) => d.id === t.delivery.id,
        ),
      );
    }
  });
  report.status = 'PASS';
} catch (e) {
  report.error = { code: e.code, message: e.message };
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (f)
    try {
      report.cleanup = await f.cleanup();
    } catch (e) {
      report.cleanupError = e.message;
      report.status = 'FAIL';
      process.exitCode = 1;
    }
  const root = new URL(
    '../docs/quality-gate/reports/m2c-4-release-observation-20260913/testing/',
    import.meta.url,
  );
  mkdirSync(root, { recursive: true });
  writeFileSync(
    new URL('integration.json', root),
    JSON.stringify(report, null, 2) + '\n',
  );
}
