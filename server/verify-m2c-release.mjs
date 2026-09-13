import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fixture,
  schema,
  runId,
  planData,
  resultData,
} from './test-data/m2c-release-fixture.mjs';
const require = createRequire(import.meta.url),
  report = {
    at: new Date().toISOString(),
    status: 'FAIL',
    environment: '127.0.0.1/pfc_local isolated schema only',
    schema,
    data: runId,
    results: [],
  };
let f;
const test = async (name, work) => {
  await work();
  report.results.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  f = await fixture({ start: false });
  await test('T13 explicit006 and unchanged001-005 / readiness fail closed', async () => {
    const m = require('./src/persistence/migrations');
    assert.equal(f.db.targetVersion, '006');
    assert.deepEqual(m.registry('006').slice(0, 5), m.registry('005'));
    await m.assertReady(f.db);
    await f.admin.query(
      `ALTER TABLE "${schema}".release_result_events DISABLE TRIGGER release_result_events_immutable`,
    );
    try {
      await assert.rejects(
        m.assertReady(f.db),
        (e) => e.code === 'MIGRATION_NOT_READY',
      );
    } finally {
      await f.admin.query(
        `ALTER TABLE "${schema}".release_result_events ENABLE TRIGGER release_result_events_immutable`,
      );
    }
  });
  await f.startRuntime();
  for (const who of ['owner', 'owner2', 'executor', 'viewer', 'other'])
    await f.login(who);
  let item, p, o;
  await test('T01-T03 early incomplete draft, current accepted input and Owner preparation review', async () => {
    item = await f.accepted('main');
    const draft = (
      await f.write(
        item.id,
        '/release-plans',
        { target: 'CODEx_TEST_local' },
        201,
      )
    ).plan;
    assert.equal(draft.completeness, 'DRAFT');
    assert.equal((await f.api('/reqs/' + item.id + '/releases')).total, 0);
    assert.equal(
      (await f.write(item.id, '/releases', { planId: draft.id }, 409)).error
        .code,
      'RELEASE_PREPARATION_REQUIRED',
    );
    p = await f.plan(item);
    assert.equal(p.completeness, 'READY');
    await f.approve(item, p);
    const w = await f.api('/reqs/' + item.id + '/release-workspace');
    assert.equal(w.currentRelease.id, p.id);
    assert.equal(w.executionAvailable, false);
  });
  await test('T04/T07 write permission, scope and unavailable execution', async () => {
    const body = {
      ...f.command(),
      expectedRevision: (await f.refresh(item.id)).revision,
      comment: 'CODEx_TEST_denied',
    };
    assert.equal(
      (await f.raw('/releases/' + p.id + '/approve', 'POST', body, 'executor'))
        .status,
      403,
    );
    assert.equal(
      (
        await f.raw(
          '/reqs/' + item.id + '/release-workspace',
          'GET',
          undefined,
          'other',
        )
      ).status,
      404,
    );
    assert.equal(
      (await f.raw('/releases/' + p.id + '/execute', 'POST', {})).body.error
        .code,
      'CAPABILITY_UNAVAILABLE',
    );
    const bad = await f.write(
      item.id,
      '/releases/' + p.id + '/reported-results',
      { ...resultData([item.evidence]), source: 'CI_VERIFIED' },
      400,
    );
    assert.equal(bad.error.code, 'INVALID_RELEASE_SOURCE');
  });
  await test('T08 unknown reconciles same attempt; no duplicate retry; result evidence atomic', async () => {
    const input = {
      ...resultData([item.evidence]),
      status: 'UNKNOWN',
      endedAt: null,
      locator: 'CODEx_TEST_job_1',
      responsible: runId + '_owner',
    };
    const r = (
      await f.write(
        item.id,
        '/releases/' + p.id + '/reported-results',
        input,
        201,
      )
    ).record;
    assert.equal(
      (
        await f.write(
          item.id,
          '/releases/' + p.id + '/reported-results',
          resultData([item.evidence]),
          409,
        )
      ).error.code,
      'RELEASE_RESULT_UNKNOWN',
    );
    const success = await f.write(
      item.id,
      '/releases/' + p.id + '/reported-results',
      {
        ...resultData([item.evidence]),
        startedAt: input.startedAt,
        previousRecordId: r.id,
      },
      201,
    );
    o = success.observation;
    assert.equal(o.state, 'OPEN');
    assert.equal((await f.refresh(item.id)).stage, 'observe');
    const rows = (
      await f.admin.query(`SELECT count(*) n FROM "${schema}".release_attempts`)
    ).rows;
    assert.equal(Number(rows[0].n), 1);
  });
  await test('T10 metric required after expired window; T14 business writes locked; chat remains available', async () => {
    const payload = {
      decision: 'ACCEPTED',
      checks: { goals: true, evidence: true, followups: true },
      actual: 'CODEx_TEST_100%',
      conclusion: 'CODEx_TEST_完成',
      retrospective: 'CODEx_TEST_复盘',
      risks: '无',
    };
    assert.equal(
      (
        await f.write(
          item.id,
          '/observations/' + o.id + '/final-acceptances',
          payload,
          403,
          'executor',
        )
      ).error.code,
      'FORBIDDEN',
    );
    await f.write(
      item.id,
      '/releases/' + p.id + '/return-to-repair',
      { returnStage: 'dev', comment: 'CODEx_TEST_无权限' },
      403,
      'executor',
    );
    assert.equal(
      (
        await f.write(
          item.id,
          '/observations/' + o.id + '/final-acceptances',
          payload,
          409,
        )
      ).error.code,
      'OBSERVATION_INCOMPLETE',
    );
    assert.equal(
      (
        await f.write(
          item.id,
          '/versions',
          { stage: 'dev', content: { title: 'CODEx_TEST_禁止', fields: [] } },
          409,
        )
      ).error.code,
      'RELEASE_PHASE_LOCKED',
    );
    await f.write(
      item.id,
      '/observations/' + o.id + '/entries',
      {
        kind: 'METRIC',
        metricId: 'METRIC_1',
        sampledFrom: o.startedAt,
        sampledTo: o.endsAt,
        status: 'MET',
        actual: 'CODEx_TEST_100%',
        sourceDescription: 'CODEx_TEST_合成窗口末端',
        evidence: [item.evidence],
        source: 'USER_REPORTED',
      },
      201,
    );
    assert.deepEqual(
      (await f.api('/reqs/' + item.id + '/observations/' + o.id)).observation
        .blockers,
      [],
    );
  });
  await test('T11-T12 final acceptance is separate immutable close; local restart readback', async () => {
    const payload = {
      decision: 'ACCEPTED',
      checks: { goals: true, evidence: true, followups: true },
      actual: 'CODEx_TEST_100%',
      conclusion: 'CODEx_TEST_完成',
      retrospective: 'CODEx_TEST_复盘',
      risks: '无',
    };
    const accepted = await f.write(
      item.id,
      '/observations/' + o.id + '/final-acceptances',
      payload,
      201,
    );
    assert.ok(accepted.closedAt);
    await f.restart();
    assert.ok((await f.refresh(item.id)).closed);
    await assert.rejects(
      f.admin.query(
        `UPDATE "${schema}".final_acceptances SET decision='REJECTED'`,
      ),
      (e) => e.code === '23514',
    );
    assert.equal(
      (
        await f.write(
          item.id,
          '/releases/' + p.id + '/return-to-repair',
          { returnStage: 'dev', comment: 'CODEx_TEST_禁止' },
          409,
        )
      ).error.code,
      'RELEASE_PHASE_LOCKED',
    );
  });
  await test('T05/T06 draft does not replace approval; semantic baseline invalidates before publish', async () => {
    const t = await f.accepted('stale'),
      a = await f.plan(t);
    await f.approve(t, a);
    await f.write(t.id, '/release-plans', { target: 'CODEx_TEST_draft' }, 201);
    assert.equal(
      (await f.api('/reqs/' + t.id + '/release-workspace')).currentRelease.id,
      a.id,
    );
    await f.saveDev(t.id, 'CODEx_TEST_新实现');
    assert.equal(
      (
        await f.write(
          t.id,
          '/releases/' + a.id + '/reported-results',
          resultData([t.evidence]),
          409,
        )
      ).error.code,
      'RELEASE_PREPARATION_REQUIRED',
    );
  });
  await test('T07 late report checks actual time; boolean forged source rejected', async () => {
    const t = await f.accepted('late'),
      data = planData([t.evidence], runId + '_owner'),
      a = (await f.write(t.id, '/release-plans', data, 201)).plan;
    await f.approve(t, a);
    const bad = await f.write(
      t.id,
      '/releases/' + a.id + '/reported-results',
      { ...resultData([t.evidence]), source: false },
      400,
    );
    assert.equal(bad.error.code, 'INVALID_RELEASE_SOURCE');
    const r = await f.write(
      t.id,
      '/releases/' + a.id + '/reported-results',
      resultData([t.evidence]),
      201,
    );
    assert.equal(r.record.status, 'SUCCESS');
  });
  await test('T09 rollback UNKNOWN blocks repair; same-attempt terminal record stops observation', async () => {
    const t = await f.accepted('rollback'),
      a = await f.plan(t);
    await f.approve(t, a);
    await f.write(
      t.id,
      '/releases/' + a.id + '/reported-results',
      resultData([t.evidence]),
      201,
    );
    const data = {
      ...resultData([t.evidence]),
      versionRef: 'CODEx_TEST_build_0',
      status: 'UNKNOWN',
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      endedAt: null,
      locator: 'CODEx_TEST_rollback_job',
      responsible: runId + '_owner',
    };
    const unknown = (
      await f.write(
        t.id,
        '/releases/' + a.id + '/reported-rollbacks',
        data,
        201,
      )
    ).record;
    assert.equal(
      (
        await f.write(
          t.id,
          '/releases/' + a.id + '/return-to-repair',
          { returnStage: 'dev', comment: 'CODEx_TEST_返回' },
          409,
        )
      ).error.code,
      'RELEASE_RESULT_UNKNOWN',
    );
    await f.write(
      t.id,
      '/releases/' + a.id + '/reported-rollbacks',
      {
        ...data,
        status: 'SUCCESS',
        endedAt: new Date(Date.parse(data.startedAt) + 1000).toISOString(),
        previousRecordId: unknown.id,
      },
      201,
    );
    const returned = await f.write(
      t.id,
      '/releases/' + a.id + '/return-to-repair',
      { returnStage: 'dev', comment: 'CODEx_TEST_回退后修复' },
    );
    assert.equal(returned.nextStage, 'dev');
    assert.equal(
      (await f.api('/reqs/' + t.id + '/releases/' + a.id)).release.stale,
      true,
    );
    assert.equal(
      (await f.api('/reqs/' + t.id + '/releases/' + a.id + '/reported-results'))
        .total,
      3,
    );
  });
  await test('T10/T11 window/metric/issue/followup completeness and accountable close', async () => {
    const t = await f.accepted('followup'),
      a = await f.plan(t);
    await f.approve(t, a);
    const r = await f.write(
        t.id,
        '/releases/' + a.id + '/reported-results',
        resultData([t.evidence]),
        201,
      ),
      o = r.observation;
    const path = '/observations/' + o.id;
    const followup = (
      await f.write(
        t.id,
        path + '/followups',
        {
          title: 'CODEx_TEST_阻断缺陷',
          blocking: true,
          owner: runId + '_executor',
          dueAt: new Date(Date.now() + 3600000).toISOString(),
        },
        201,
      )
    ).followup;
    const entry = {
      kind: 'METRIC',
      metricId: 'METRIC_1',
      sampledFrom: o.startedAt,
      sampledTo: o.endsAt,
      status: 'MET',
      actual: 'CODEx_TEST_100%',
      sourceDescription: 'CODEx_TEST_本窗口',
      evidence: [t.evidence],
    };
    await f.write(
      t.id,
      path + '/entries',
      { ...entry, sampledTo: new Date(Date.now() + 60000).toISOString() },
      400,
    );
    await f.write(t.id, path + '/entries', entry, 201);
    assert.ok(
      (await f.api('/reqs/' + t.id + path)).observation.blockers.includes(
        'OBSERVATION_INCOMPLETE',
      ),
    );
    const issue = {
      ...entry,
      kind: 'ISSUE',
      issueId: 'ISSUE_1',
      status: 'OPEN',
      responsible: runId + '_owner',
    };
    const firstIssue = (await f.write(t.id, path + '/entries', issue, 201))
      .entry;
    await f.write(
      t.id,
      path + '/followups/' + followup.id + '/events',
      {
        status: 'DONE',
        owner: runId + '_executor',
        dueAt: new Date(Date.now() + 3600000).toISOString(),
        comment: 'CODEx_TEST_已处理',
        evidence: [t.evidence],
      },
      201,
    );
    assert.ok(
      (await f.api('/reqs/' + t.id + path)).observation.blockers.includes(
        'OBSERVATION_INCOMPLETE',
      ),
    );
    await f.write(
      t.id,
      path + '/entries',
      { ...issue, status: 'RESOLVED', sequence: 2, previousRecordId: null },
      409,
    );
    await f.write(
      t.id,
      path + '/entries',
      {
        ...issue,
        status: 'RESOLVED',
        sequence: 2,
        previousRecordId: firstIssue.id,
      },
      201,
    );
    assert.deepEqual(
      (await f.api('/reqs/' + t.id + path)).observation.blockers,
      [],
    );
  });
  await test('T14/T15 historical attachment version remains readable; revocation blocks new acceptance', async () => {
    const t = await f.accepted('evidence'),
      a = await f.plan(t);
    await f.approve(t, a);
    const o = (
      await f.write(
        t.id,
        '/releases/' + a.id + '/reported-results',
        resultData([t.evidence]),
        201,
      )
    ).observation;
    await f.write(t.id, '/materials/' + t.evidence.id + '/versions', {
      content: 'CODEx_TEST_附件第二版',
    });
    const historical = (await f.api('/reqs/' + t.id + '/releases/' + a.id))
      .release.evidence;
    assert.ok(historical.every((e) => e.available && e.version === 1));
    await f.write(t.id, '/materials/' + t.evidence.id + '/impact', {
      decision: 'exclude',
    });
    assert.ok(
      (
        await f.api('/reqs/' + t.id + '/releases/' + a.id)
      ).release.evidence.every((e) => e.available === false && !e.hash),
    );
    assert.ok(
      (
        await f.api('/reqs/' + t.id + '/observations/' + o.id)
      ).observation.blockers.includes('RELEASE_EVIDENCE_UNAVAILABLE'),
    );
  });
  await test('T16 double submission returns one receipt; role checked before cached result', async () => {
    const t = await f.accepted('replay'),
      body = {
        ...planData([t.evidence], runId + '_owner'),
        ...f.command(),
        expectedRevision: (await f.refresh(t.id)).revision,
      },
      path = '/reqs/' + t.id + '/release-plans';
    const [a, b] = await Promise.all([
      f.raw(path, 'POST', body),
      f.raw(path, 'POST', body),
    ]);
    assert.equal(a.status, 201);
    assert.deepEqual(b.body, a.body);
    assert.equal((await f.api('/reqs/' + t.id + '/release-plans')).total, 1);
    const owner = (await f.api('/members')).items.find(
      (m) => m.name === runId + '_owner',
    );
    const down = await f.api(
      '/members/' + owner.id + '/role',
      'PATCH',
      { role: 'viewer', expectedRevision: owner.revision, ...f.command() },
      'owner2',
    );
    try {
      assert.equal((await f.raw(path, 'POST', body)).status, 403);
    } finally {
      await f.api(
        '/members/' + owner.id + '/role',
        'PATCH',
        {
          role: 'owner',
          expectedRevision: down.member.revision,
          ...f.command(),
        },
        'owner2',
      );
    }
  });
  await test('T01 preparation persists before product acceptance and notifies only after submit', async () => {
    const t = await f.prepare('early-preparation');
    assert.equal((await f.refresh(t.id)).stage, 'test');
    const p = (
      await f.write(
        t.id,
        '/release-plans',
        { target: 'CODEx_TEST_提前准备' },
        201,
      )
    ).plan;
    await f.restart();
    assert.equal(
      (await f.api('/reqs/' + t.id + '/release-plans/' + p.id)).release.content
        .target,
      'CODEx_TEST_提前准备',
    );
    assert.equal(
      (await f.write(t.id, '/releases', { planId: p.id }, 409)).error.code,
      'RELEASE_PREPARATION_REQUIRED',
    );
    const notices = await f.api('/notices');
    assert.ok(JSON.stringify(notices).includes('待Owner评审'));
  });
  await test('T12 nonblocking followup closes with accountable risk; later events preserve final snapshot', async () => {
    const t = await f.accepted('nonblocking'),
      p = await f.plan(t);
    await f.approve(t, p);
    const o = (
        await f.write(
          t.id,
          '/releases/' + p.id + '/reported-results',
          resultData([t.evidence]),
          201,
        )
      ).observation,
      path = '/observations/' + o.id;
    const followup = (
      await f.write(
        t.id,
        path + '/followups',
        {
          title: 'CODEx_TEST_文案优化',
          blocking: false,
          owner: runId + '_executor',
          dueAt: new Date(Date.now() + 3600000).toISOString(),
        },
        201,
      )
    ).followup;
    const value = {
      decision: 'REJECTED',
      checks: { goals: true, evidence: true, followups: true },
      actual: 'CODEx_TEST_实际待核对',
      conclusion: 'CODEx_TEST_继续观察',
      retrospective: 'CODEx_TEST_改进说明',
      risks: 'CODEx_TEST_明确接受非阻断文案后续处理',
    };
    await f.write(t.id, path + '/final-acceptances', value, 201);
    assert.equal((await f.refresh(t.id)).closed, false);
    await f.write(
      t.id,
      path + '/entries',
      {
        kind: 'METRIC',
        metricId: 'METRIC_1',
        status: 'MET',
        sampledFrom: o.startedAt,
        sampledTo: o.endsAt,
        actual: 'CODEx_TEST_100%',
        sourceDescription: 'CODEx_TEST_窗口末端',
        evidence: [t.evidence],
      },
      201,
    );
    const accepted = (
      await f.write(
        t.id,
        path + '/final-acceptances',
        { ...value, decision: 'ACCEPTED', actual: 'CODEx_TEST_100%' },
        201,
      )
    ).acceptance;
    await f.write(
      t.id,
      path + '/followups/' + followup.id + '/events',
      {
        status: 'DONE',
        comment: 'CODEx_TEST_完成文案',
        owner: runId + '_executor',
        dueAt: new Date(Date.now() + 3600000).toISOString(),
        evidence: [t.evidence],
      },
      201,
    );
    const history = await f.api('/reqs/' + t.id + path + '/final-acceptances');
    assert.deepEqual(
      history.items.find((a) => a.id === accepted.id).snapshot,
      accepted.snapshot,
    );
    assert.equal(accepted.snapshot.followups[0].status, 'OPEN');
    assert.equal(
      (await f.api('/reqs/' + t.id + path + '/followups')).items[0].status,
      'DONE',
    );
    const versions = (await f.refresh(t.id)).versions.filter(
      (v) => ['release', 'observe'].includes(v.stage) && v.content.confirmed,
    );
    assert.equal(versions.length, 2);
    await assert.rejects(
      require('./src/persistence/transaction').withTransaction(f.db, (c) =>
        c.query(
          `UPDATE "${schema}".req_versions SET confirmed_at=NULL WHERE public_id=$1`,
          [versions[0].id],
        ),
      ),
      (e) => e.code === '23514',
    );
  });
  await test('T04 current Owner re-reviews inactive approver on same UNKNOWN attempt when product inputs remain valid', async () => {
    const t = await f.accepted('review-recovery'),
      p = await f.plan(t);
    await f.write(t.id, '/releases', { planId: p.id }, 201);
    const review = async (who) =>
      f.api(
        '/releases/' + p.id + '/approve',
        'POST',
        {
          ...f.command(),
          expectedRevision: (await f.refresh(t.id)).revision,
          comment: 'CODEx_TEST_重新核对原计划',
        },
        who,
      );
    await review('owner2');
    const original = resultData([t.evidence]),
      unknown = (
        await f.write(
          t.id,
          '/releases/' + p.id + '/reported-results',
          {
            ...original,
            status: 'UNKNOWN',
            endedAt: null,
            locator: 'CODEx_TEST_原任务',
            responsible: runId + '_owner',
          },
          201,
        )
      ).record;
    const owner = (await f.api('/members')).items.find(
      (m) => m.name === runId + '_owner2',
    );
    const down = await f.api('/members/' + owner.id + '/role', 'PATCH', {
      role: 'viewer',
      expectedRevision: owner.revision,
      ...f.command(),
    });
    try {
      await f.write(
        t.id,
        '/releases/' + p.id + '/reported-results',
        { ...original, previousRecordId: unknown.id },
        409,
      );
      assert.equal(
        (await f.api('/reqs/' + t.id + '/releases/' + p.id)).release
          .canReReview,
        true,
      );
      await review('owner');
      await f.write(
        t.id,
        '/releases/' + p.id + '/reported-results',
        { ...original, previousRecordId: unknown.id },
        201,
      );
      assert.equal((await f.api('/reqs/' + t.id + '/observations')).total, 1);
      assert.equal(
        (await f.api('/reqs/' + t.id + '/releases/' + p.id + '/reviews')).total,
        2,
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*) n FROM "${schema}".release_attempts a JOIN "${schema}".reqs q ON q.id=a.req_id WHERE q.public_id=$1`,
            [t.id],
          )
        ).rows[0].n,
        '1',
      );
    } finally {
      await f.api('/members/' + owner.id + '/role', 'PATCH', {
        role: 'owner',
        expectedRevision: down.member.revision,
        ...f.command(),
      });
    }
  });
  for (const disabled of [false, true])
    await test(
      'D2/D3 confirmed historical acceptance recovery after ' +
        (disabled ? 'disable' : 'demotion'),
      async () => {
        const r = await f.recovery('historical-' + disabled, disabled);
        const path = '/releases/' + r.plan.id + '/reported-results';
        const frozen = async () =>
          (
            await f.admin.query(
              `SELECT p.snapshot,p.fingerprint,a.review_id,a.id attempt_id,pa.id acceptance_id,pa.member_id,pa.decision FROM "${schema}".release_plans p JOIN "${schema}".release_attempts a ON a.plan_id=p.id JOIN "${schema}".product_acceptances pa ON pa.req_id=p.req_id WHERE p.public_id=$1`,
              [r.plan.id],
            )
          ).rows;
        try {
          const before = await frozen();
          assert.equal(
            (await r.read('/reqs/' + r.item.id + '/release-inputs'))
              .inputsReady,
            false,
          );
          await r.write(
            path,
            { ...r.original, previousRecordId: r.unknown.id },
            409,
          );
          await r.review(403, 'viewer');
          await r.review(403, 'executor');
          await r.review(); // Red before implementing the user-confirmed exception.
          const review = (
            await r.read(
              '/reqs/' + r.item.id + '/releases/' + r.plan.id + '/reviews',
            )
          ).items[0];
          assert.match(review.comment, /沿用冻结验收/);
          assert.equal(
            (await r.read('/reqs/' + r.item.id + '/release-inputs'))
              .inputsReady,
            false,
          );
          await r.write('/release-plans', { target: 'CODEx_TEST_new' }, 409);
          await r.write(path, { ...r.original, historicalMembers: true }, 409);
          await r.write(
            path,
            {
              ...r.original,
              previousRecordId: r.unknown.id,
              startedAt: new Date(
                Date.parse(r.original.startedAt) + 1000,
              ).toISOString(),
            },
            409,
          );
          const secondUnknown = (
            await r.write(
              path,
              {
                ...r.original,
                status: 'UNKNOWN',
                endedAt: null,
                previousRecordId: r.unknown.id,
                locator: 'CODEx_TEST_继续核查',
                responsible: runId + '_owner2',
              },
              201,
            )
          ).record;
          await r.write(
            path,
            { ...r.original, previousRecordId: r.unknown.id },
            409,
          );
          const resolved = await r.write(
            path,
            { ...r.original, previousRecordId: secondUnknown.id },
            201,
          );
          assert.equal(
            resolved.record.reconciliation.acceptanceId,
            r.plan.snapshot.acceptanceId,
          );
          assert.equal(resolved.record.reconciliation.reviewId, review.id);
          assert.equal(resolved.record.source, 'USER_REPORTED');
          assert.equal(resolved.executionAvailable, false);
          assert.deepEqual(await frozen(), before);
          assert.equal(
            (await r.read('/reqs/' + r.item.id + '/observations')).total,
            1,
          );
          assert.equal(
            (
              await r.read(
                '/reqs/' + r.item.id + '/releases/' + r.plan.id + '/reviews',
              )
            ).total,
            2,
          );
          await r.write(
            path,
            { ...r.original, previousRecordId: secondUnknown.id },
            409,
          );
        } finally {
          await r.restore();
        }
      },
    );
  await test('D2/D3 historical reconciliation preserves evidence and business fingerprint blockers', async () => {
    const r = await f.recovery('historical-guards');
    const path = '/releases/' + r.plan.id + '/reported-results';
    try {
      // Isolated fault injection; restore exact field before the next assertion.
      await f.admin.query(
        `UPDATE "${schema}".reqs SET goal=goal || '_CHANGED' WHERE public_id=$1`,
        [r.item.id],
      );
      await r.review(409);
      await f.admin.query(
        `UPDATE "${schema}".reqs SET goal=$2 WHERE public_id=$1`,
        [r.item.id, r.plan.snapshot.goal],
      );
      await f.admin.query(
        `UPDATE "${schema}".materials SET allowed=false WHERE public_id=$1`,
        [r.item.evidence.id],
      );
      await r.review(409);
      await f.admin.query(
        `UPDATE "${schema}".materials SET allowed=true WHERE public_id=$1`,
        [r.item.evidence.id],
      );
      await r.review();
      await f.admin.query(
        `UPDATE "${schema}".reqs SET artifact_design_epoch=artifact_design_epoch+1 WHERE public_id=$1`,
        [r.item.id],
      );
      await r.write(
        path,
        { ...r.original, previousRecordId: r.unknown.id },
        409,
      );
      await f.admin.query(
        `UPDATE "${schema}".reqs SET artifact_design_epoch=artifact_design_epoch-1 WHERE public_id=$1`,
        [r.item.id],
      );
      await f.admin.query(
        `UPDATE "${schema}".materials SET allowed=false WHERE public_id=$1`,
        [r.item.evidence.id],
      );
      await r.write(
        path,
        { ...r.original, previousRecordId: r.unknown.id },
        409,
      );
      assert.equal(
        (await r.read('/reqs/' + r.item.id + '/observations')).total,
        0,
      );
    } finally {
      await r.restore();
    }
  });
  await test('T13 explicit repair requires new delivery/test/acceptance and keeps prior observation', async () => {
    const t = await f.accepted('second-round'),
      p = await f.plan(t);
    await f.approve(t, p);
    const first = (
      await f.write(
        t.id,
        '/releases/' + p.id + '/reported-results',
        resultData([t.evidence]),
        201,
      )
    ).observation;
    await f.write(t.id, '/releases/' + p.id + '/return-to-repair', {
      returnStage: 'dev',
      comment: 'CODEx_TEST_修复后新轮次',
    });
    await f.write(
      t.id,
      '/releases/' + p.id + '/reported-results',
      resultData([t.evidence]),
      409,
    );
    await f.saveDev(t.id, '第二版实现');
    const delivery = (
      await f.write(
        t.id,
        '/delivery-baselines',
        { ...(await t.deliveryBody()), versionRef: 'CODEx_TEST_build_2' },
        201,
      )
    ).delivery;
    const batch = await f.batch(t);
    await f.write(
      t.id,
      '/test-batches/' + batch.id + '/results',
      { results: t.cases.map((c) => ({ ...f.result(t), caseId: c.caseId })) },
      201,
    );
    await f.write(t.id, '/test-batches/' + batch.id + '/complete', {});
    await f.write(
      t.id,
      '/product-acceptances',
      {
        baselineId: delivery.id,
        batchId: batch.id,
        decision: 'ACCEPTED',
        checks: { functionality: true, exceptions: true, evidence: true },
        comment: 'CODEx_TEST_第二轮产品验收',
        risks: '无',
      },
      201,
    );
    const body = planData([t.evidence], runId + '_owner');
    body.versionRef = 'CODEx_TEST_build_2';
    body.authorization.versionRef = body.versionRef;
    const next = (await f.write(t.id, '/release-plans', body, 201)).plan;
    await f.approve(t, next);
    const second = (
      await f.write(
        t.id,
        '/releases/' + next.id + '/reported-results',
        { ...resultData([t.evidence]), versionRef: body.versionRef },
        201,
      )
    ).observation;
    assert.notEqual(second.id, first.id);
    assert.equal((await f.api('/reqs/' + t.id + '/observations')).total, 2);
    assert.equal(
      (await f.api('/reqs/' + t.id + '/observations/' + first.id)).observation
        .state,
      'STOPPED',
    );
    assert.equal(
      (await f.api('/reqs/' + t.id + '/releases/' + p.id + '/reported-results'))
        .items[0].status,
      'SUCCESS',
    );
  });
  await test('T19 bounded plans / pagination / oversized requests; fault rows only in owned schema', async () => {
    const t = await f.accepted('limits'),
      p = await f.plan(t);
    // Fault injection tests the server boundary without pretending these are API-created business facts.
    await f.admin.query(
      `INSERT INTO "${schema}".release_plans(id,tenant_id,req_id,public_id,version,release_epoch,baseline_id,content,snapshot,fingerprint,completeness,missing_fields,created_by,created_name)
      SELECT gen_random_uuid(),tenant_id,req_id,'CODEx_TEST_BOUND_PLAN_'||n,n,release_epoch,baseline_id,content,snapshot,fingerprint,completeness,missing_fields,created_by,created_name FROM "${schema}".release_plans CROSS JOIN generate_series(2,100) n WHERE public_id=$1`,
      [p.id],
    );
    f.createdIds.push('CODEx_TEST_BOUND_PLAN_2..100');
    assert.equal(
      (
        await f.write(
          t.id,
          '/release-plans',
          { target: 'CODEx_TEST_overflow' },
          413,
        )
      ).error.code,
      'RELEASE_LIMIT_EXCEEDED',
    );
    assert.equal(
      (await f.api('/reqs/' + t.id + '/release-plans?limit=20&offset=80')).items
        .length,
      20,
    );
    assert.equal(
      (await f.raw('/reqs/' + t.id + '/release-plans?limit=101')).status,
      400,
    );
    assert.equal(
      (
        await f.write(
          t.id,
          '/release-plans',
          { target: 'x'.repeat(524289) },
          413,
        )
      ).error.code,
      'RELEASE_LIMIT_EXCEEDED',
    );
  });
  report.status = 'PASS';
} catch (e) {
  report.error = { message: e.message, stack: e.stack };
  console.error(e);
  process.exitCode = 1;
} finally {
  if (f)
    try {
      const c = await f.cleanup();
      report.cleanup = { ...c, readback: undefined };
    } catch (e) {
      report.status = 'FAIL';
      report.cleanupError = e.message;
      process.exitCode = 1;
    }
  const root = resolve(
    'docs/quality-gate/reports/local-use-baseline-20260913/release',
  );
  mkdirSync(root, { recursive: true });
  writeFileSync(
    resolve(root, 'api-' + report.at.replace(/[:.]/g, '-') + '.json'),
    JSON.stringify(report, null, 2),
  );
}
