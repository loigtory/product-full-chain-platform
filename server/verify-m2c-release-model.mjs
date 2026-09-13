import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { planData, resultData } from './test-data/m2c-release-fixture.mjs';
const require = createRequire(import.meta.url),
  root = 'docs/quality-gate/reports/m2c-4-release-observation-20260913/release';
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  results: [],
  data: 'CODEx_TEST_ deterministic process-local only; no database/external effects',
};
const now = Date.parse('2026-09-13T12:00:00Z'),
  evidence = [{ id: 'CODEx_TEST_FILE', version: 1 }];
const test = (name, work) => {
  work();
  report.results.push({ name, status: 'PASS' });
};
const rejects = (work, code) => assert.throws(work, (e) => e.code === code);
try {
  const p = require('./src/domain/release-policy');
  test('T08 unknown result does not invent a smoke outcome', () => {
    const input = {
      ...resultData([], now),
      status: 'UNKNOWN',
      endedAt: null,
      locator: 'CODEx_TEST_job',
      responsible: 'CODEx_TEST_owner',
      smoke: [{ checkId: 'SMOKE_1', status: 'NOT_RUN', actual: '' }],
    };
    assert.equal(
      p.result(
        input,
        planData(evidence, 'CODEx_TEST_owner', now),
        'DEPLOY',
        now,
      ).smokePassed,
      false,
    );
    rejects(
      () =>
        p.result(
          { ...input, source: false },
          planData(evidence, 'CODEx_TEST_owner', now),
          'DEPLOY',
          now,
        ),
      'INVALID_RELEASE_SOURCE',
    );
  });
  test('T01 T03 incomplete drafts retain input but cannot be submitted', () => {
    const draft = p.plan({ target: 'CODEx_TEST_local' });
    assert.equal(draft.complete, false);
    assert.ok(draft.missingFields.includes('发布范围'));
    const ready = p.plan(planData(evidence, 'CODEx_TEST_owner', now));
    assert.equal(ready.complete, true);
    const bad = p.plan({
      ...planData(evidence, 'CODEx_TEST_owner', now),
      monitoring: '待补充',
    });
    assert.equal(bad.complete, false);
  });
  test('T03 T19 stable ids, limits and bounded payloads', () => {
    const v = planData(evidence, 'CODEx_TEST_owner', now);
    rejects(
      () => p.plan({ ...v, metrics: [...v.metrics, ...v.metrics] }),
      'INVALID_INPUT',
    );
    rejects(() => p.plan({ ...v, hours: 0 }), 'INVALID_INPUT');
    rejects(() => p.plan({ ...v, hours: 169 }), 'INVALID_INPUT');
    rejects(() => p.plan({ ...v, scope: 'x'.repeat(4001) }), 'INVALID_INPUT');
    rejects(() => p.size({ x: 'x'.repeat(524288) }), 'RELEASE_LIMIT_EXCEEDED');
  });
  test('T07 reject fake sources and evidence duplication', () => {
    rejects(
      () => p.plan({ ...planData(evidence), source: 'CI_VERIFIED' }),
      'INVALID_RELEASE_SOURCE',
    );
    rejects(() => p.evidence([...evidence, ...evidence]), 'INVALID_INPUT');
    rejects(
      () => p.evidence([{ id: 'CODEx_TEST_FILE', version: 0 }]),
      'INVALID_INPUT',
    );
  });
  test('T06 T07 manual outcome matches target, version, evidence and time', () => {
    const v = p.plan(planData(evidence, 'CODEx_TEST_owner', now)).content,
      r = resultData(evidence, now);
    assert.equal(p.result(r, v, 'DEPLOY', now).status, 'SUCCESS');
    rejects(
      () => p.result({ ...r, target: 'different' }, v, 'DEPLOY', now),
      'RELEASE_BASELINE_STALE',
    );
    rejects(
      () =>
        p.result(
          { ...r, endedAt: new Date(now + 1).toISOString() },
          v,
          'DEPLOY',
          now,
        ),
      'INVALID_INPUT',
    );
    rejects(
      () =>
        p.result({ ...r, startedAt: '2026-09-31T00:00:00Z' }, v, 'DEPLOY', now),
      'INVALID_INPUT',
    );
    rejects(
      () => p.result({ ...r, evidence: [] }, v, 'DEPLOY', now),
      'RELEASE_EVIDENCE_UNAVAILABLE',
    );
  });
  test('T08 unknown has nullable end and must carry reconciliation context', () => {
    const v = p.plan(planData(evidence, 'CODEx_TEST_owner', now)).content;
    const r = {
      ...resultData([], now),
      status: 'UNKNOWN',
      endedAt: null,
      locator: 'CODEx_TEST_job_1',
      responsible: 'CODEx_TEST_owner',
    };
    assert.equal(p.result(r, v, 'DEPLOY', now).endedAt, null);
    rejects(
      () => p.result({ ...r, locator: '' }, v, 'DEPLOY', now),
      'INVALID_INPUT',
    );
  });
  test('T07 T09 authorization and declared rollback scope are enforced', () => {
    const v = p.plan(planData(evidence, 'CODEx_TEST_owner', now)).content,
      r = resultData(evidence, now);
    rejects(
      () =>
        p.result(
          { ...r, startedAt: new Date(now - 172800000).toISOString() },
          v,
          'DEPLOY',
          now,
        ),
      'RELEASE_APPROVAL_REQUIRED',
    );
    rejects(() => p.result(r, v, 'ROLLBACK', now), 'RELEASE_BASELINE_STALE');
    assert.equal(
      p.result({ ...r, versionRef: v.rollback.target }, v, 'ROLLBACK', now)
        .status,
      'SUCCESS',
    );
  });
  test('T10 observation clock and evidence, independent of client shortcut', () => {
    const v = p.plan(planData(evidence, 'CODEx_TEST_owner', now)).content;
    const o = {
      startedAt: new Date(now - 7200000).toISOString(),
      endsAt: new Date(now - 3600000).toISOString(),
      plan: v,
    };
    const entry = {
      kind: 'METRIC',
      metricId: 'METRIC_1',
      actual: '100',
      status: 'MET',
      sourceDescription: 'CODEx_TEST_logs',
      sampledFrom: o.endsAt,
      sampledTo: o.endsAt,
      evidence,
    };
    assert.equal(p.entry(entry, o, now).metricId, 'METRIC_1');
    rejects(
      () =>
        p.entry(
          { ...entry, sampledTo: new Date(now + 1).toISOString() },
          o,
          now,
        ),
      'INVALID_INPUT',
    );
    rejects(
      () => p.entry({ ...entry, metricId: 'other' }, o, now),
      'INVALID_INPUT',
    );
    assert.ok(
      p
        .observationBlockers(
          { ...o, endsAt: new Date(now + 1).toISOString() },
          [],
          [],
          now,
        )
        .includes('OBSERVATION_WINDOW_OPEN'),
    );
    assert.ok(
      p.observationBlockers(o, [], [], now).includes('OBSERVATION_INCOMPLETE'),
    );
    assert.deepEqual(
      p.observationBlockers(o, [p.entry(entry, o, now)], [], now),
      [],
    );
  });
  test('T11 T12 blocking and nonblocking followups keep named accountability', () => {
    const f = {
      title: 'CODEx_TEST_说明',
      blocking: false,
      owner: 'CODEx_TEST_owner',
      dueAt: new Date(now + 86400000).toISOString(),
    };
    assert.equal(p.followup(f).blocking, false);
    rejects(() => p.followup({ ...f, owner: '' }), 'INVALID_INPUT');
    rejects(
      () =>
        p.final({
          decision: 'ACCEPTED',
          conclusion: 'CODEx_TEST_达到目标',
          actual: 'CODEx_TEST_实际值',
          retrospective: 'CODEx_TEST_复盘',
          risks: '无',
          checks: { goals: true, evidence: true, followups: false },
        }),
      'INVALID_INPUT',
    );
  });
  test('T11 explicit prior event and sequence prevent stale judgments', () => {
    assert.deepEqual(p.sequence({}, null), {
      sequence: 1,
      previousRecordId: null,
    });
    const prior = { id: 'OME-1', sequence: 1 };
    rejects(() => p.sequence({ sequence: 2 }, prior), 'REVISION_CONFLICT');
    rejects(
      () => p.sequence({ sequence: 3, previousRecordId: 'OME-1' }, prior),
      'REVISION_CONFLICT',
    );
    assert.deepEqual(
      p.sequence({ sequence: 2, previousRecordId: 'OME-1' }, prior),
      { sequence: 2, previousRecordId: 'OME-1' },
    );
  });
  test('D2/D3 frozen confirmation selection ignores historical access only, never versions or epochs', () => {
    const q = { artifact_business_epoch: 3, artifact_design_epoch: 4 };
    const baseline = {
      business_confirmation_id: 'B1',
      design_confirmation_id: 'D1',
    };
    const common = {
      group_id: 'G1',
      business_epoch: 3,
      input_fingerprint: 'F1',
      member_active: false,
      current_role: 'viewer',
    };
    const u = {
      group: { id: 'G1' },
      inputs: { fingerprint: 'F1' },
      history: [
        { ...common, id: 'B1', kind: 'BUSINESS' },
        {
          ...common,
          id: 'D1',
          kind: 'DESIGN',
          design_epoch: 4,
          design_version_id: 'V1',
        },
      ],
      latest: () => ({ id: 'V1', stale: false, confirmed_at: '2026-09-13' }),
    };
    const selected = p.frozenConfirmations(u, q, baseline);
    assert.equal(selected.business.id, 'B1');
    assert.equal(selected.design.id, 'D1');
    assert.equal(
      p.frozenConfirmations(u, { ...q, artifact_business_epoch: 5 }, baseline)
        .business,
      undefined,
    );
    assert.equal(
      p.frozenConfirmations(u, { ...q, artifact_design_epoch: 5 }, baseline)
        .design,
      null,
    );
    assert.equal(
      p.frozenConfirmations(
        { ...u, latest: () => ({ id: 'V2', confirmed_at: '2026-09-13' }) },
        q,
        baseline,
      ).design,
      null,
    );
    assert.equal(
      p.frozenConfirmations(
        { ...u, inputs: { fingerprint: 'CHANGED' } },
        q,
        baseline,
      ).business,
      undefined,
    );
    assert.equal(
      p.frozenConfirmations(u, q, {
        ...baseline,
        business_confirmation_id: 'OTHER',
      }).business,
      undefined,
    );
  });
  report.status = 'PASS';
} catch (e) {
  report.error = { code: e.code, message: e.message };
  process.exitCode = 1;
}
mkdirSync(root, { recursive: true });
writeFileSync(
  root + '/model-' + Date.now() + '.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
