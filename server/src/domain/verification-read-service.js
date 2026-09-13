'use strict';
const access = require('../access'),
  runtime = require('../runtime'),
  repo = require('../persistence/verification-baselines'),
  reqs = require('../persistence/requirements');
const policy = require('./verification-policy'),
  dto = require('./verification-dto'),
  impact = require('./artifact-impact-service');
async function read(id, work) {
  const ctx = access.current(),
    db = runtime.db();
  return require('./membership-policy').read(db, ctx, false, async (c) => {
    const req = await repo.requirement(c, db, ctx, id);
    if (!req) access.fail('NOT_FOUND', 404);
    return work(c, db, ctx, req);
  });
}
async function mutate(id, input, operation, work) {
  policy.size(input);
  const ctx = access.current(true),
    db = runtime.db();
  return require('../persistence/commands').command(
    db,
    ctx,
    operation,
    { ...input, _reqTarget: id },
    async (c) => {
      const req = await reqs.lock(c, db, ctx, id);
      access.revision(req, input.expectedRevision);
      const result = await work(c, db, ctx, req);
      const updated = await reqs.touch(c, db, ctx, req, operation);
      return {
        ...result,
        req: require('./dto').req(updated),
        reqId: id,
        revision: updated.revision,
      };
    },
  );
}
async function evidence(c, d, x, q, refs, required = true) {
  const checked = policy.evidence(refs, required),
    rows = await repo.evidenceRows(c, d, x, q, checked);
  if (
    rows.reduce((n, r) => n + Number(r.size), 0) > policy.limits.evidenceBytes
  )
    access.fail('VERIFICATION_LIMIT_EXCEEDED', 413, '证据合计超过50 MiB');
  for (const row of rows) {
    const old = refs.find((r) => r.id === row.public_id);
    if (old?.hash && old.hash !== row.hash)
      access.fail(
        'VERIFICATION_EVIDENCE_UNAVAILABLE',
        409,
        '证据摘要变化：' + row.public_id,
      );
    try {
      await require('../files/local-files').read(x.tenantId, row.hash);
    } catch {
      access.fail(
        'VERIFICATION_EVIDENCE_UNAVAILABLE',
        409,
        '证据原件不可读：' + row.public_id,
      );
    }
  }
  return rows;
}
async function ownerEvidence(c, d, x, q, kind, id, required = true) {
  const refs = await repo.refs(c, d, x, q, kind, id);
  await evidence(c, d, x, q, refs, required);
  return refs;
}
async function activeRuns(c, d, x, q) {
  return repo.activeRun(c, d, x, q);
}
async function inspect(c, d, x, q, { files = true } = {}) {
  let upstream;
  const blockers = [];
  try {
    upstream = await impact.inspect(c, d, x, q, { files });
  } catch (e) {
    if (
      !['FILE_CORRUPT', 'FILE_UNAVAILABLE', 'INVALID_FILE_REFERENCE'].includes(
        e.code,
      )
    )
      throw e;
    upstream = await impact.inspect(c, d, x, q);
    blockers.push('上游材料原件不可用');
  }
  blockers.push(...upstream.blockers);
  if (upstream.questions.length) blockers.push('仍有待决定问题');
  if (!upstream.business) blockers.push('业务方案尚未有效确认');
  if (!upstream.design) blockers.push('实施设计尚未有效确认');
  const suite = q.current_test_suite_id
    ? await repo.find(c, d, x, q, 'test_suites', q.current_test_suite_id, true)
    : null;
  const baseline = q.current_delivery_baseline_id
    ? await repo.find(
        c,
        d,
        x,
        q,
        'delivery_baselines',
        q.current_delivery_baseline_id,
        true,
      )
    : null;
  if (
    !suite ||
    suite.status !== 'READY' ||
    suite.group_id !== upstream.group?.id
  )
    blockers.push('尚未采用当前完整测试套件');
  if (!baseline) blockers.push('尚未登记交付');
  else {
    if (
      baseline.verification_epoch !== q.verification_epoch ||
      baseline.suite_id !== suite?.id ||
      baseline.group_id !== upstream.group?.id ||
      baseline.dev_version_id !== upstream.latest('dev')?.id ||
      upstream.latest('dev')?.stale ||
      baseline.business_confirmation_id !== upstream.business?.id ||
      baseline.design_confirmation_id !== upstream.design?.id ||
      baseline.input_fingerprint !== upstream.inputs.fingerprint
    )
      blockers.push('交付基线已变化，请重新提测');
    const author = await repo.member(c, d, x, baseline.created_by);
    if (!author?.active || !['owner', 'executor'].includes(author.role))
      blockers.push('交付登记者已无权限');
    if (files)
      try {
        await ownerEvidence(c, d, x, q, 'baseline_id', baseline.id);
      } catch (e) {
        if (e.code !== 'VERIFICATION_EVIDENCE_UNAVAILABLE') throw e;
        blockers.push(e.message);
      }
  }
  return { upstream, suite, baseline, blockers, ready: !blockers.length };
}
async function ready(c, d, x, q) {
  const state = await inspect(c, d, x, q);
  if (!state.ready)
    access.fail('TEST_BASELINE_STALE', 409, state.blockers.join('；'));
  return state;
}
async function validResults(c, d, x, q, batch) {
  const results = await require('../persistence/test-executions').latest(
    c,
    d,
    x,
    q,
    batch,
  );
  for (const r of results) {
    const author = await repo.member(c, d, x, r.registered_by);
    if (!author?.active || !['owner', 'executor'].includes(author.role))
      access.fail(
        'TEST_RESULT_REQUIRED',
        409,
        '结果登记者已无权限：' + r.public_id,
      );
    await ownerEvidence(
      c,
      d,
      x,
      q,
      'result_id',
      r.id,
      ['PASS', 'FAIL'].includes(r.status),
    );
  }
  return results;
}
async function testComplete(c, d, x, q, state, batch) {
  if (!batch || batch.baseline_id !== state.baseline?.id)
    access.fail('TEST_RESULT_REQUIRED', 409, '缺少当前交付的测试批次');
  const cases = (
      await require('../persistence/test-suites').cases(c, d, x, q, state.suite)
    ).map((r) => r.content),
    results = await validResults(c, d, x, q, batch),
    defects = await require('../persistence/defects').unclosed(c, d, x, q);
  policy.complete(cases, results, defects);
  for (const event of await require('../persistence/defects').latestProofs(
    c,
    d,
    x,
    q,
  )) {
    const author = await repo.member(c, d, x, event.member_id);
    if (!author?.active || !['owner', 'executor'].includes(author.role))
      access.fail('DEFECT_RETEST_REQUIRED', 409, '缺陷回归登记者已无权限');
    await ownerEvidence(c, d, x, q, 'defect_event_id', event.id);
  }
  return results;
}
async function workspace(c, d, x, q) {
  const s = await inspect(c, d, x, q),
    history = {};
  for (const [key, name] of Object.entries({
    suites: 'test_suites',
    deliveries: 'delivery_baselines',
    batches: 'test_batches',
    defects: 'defects',
    acceptances: 'product_acceptances',
  })) {
    const r = await repo.list(c, d, x, q, name);
    history[key] = { ...r, items: r.items.map(dto.summary) };
  }
  const batch =
    await require('../persistence/test-executions').currentCompleted(
      c,
      d,
      x,
      q,
      s.baseline,
    );
  const value = {
    reqId: q.public_id,
    revision: q.revision,
    stage: q.stage,
    groupId: s.upstream.group?.public_id || null,
    currentSuite: await dto.suite(c, d, x, q, s.suite),
    currentDelivery: await dto.baseline(c, d, x, q, s.baseline),
    currentTest: await dto.batch(c, d, x, q, batch),
    blockers: s.blockers,
    ready: s.ready,
    history,
    actions: {
      canWrite: ['owner', 'executor'].includes(x.role),
      canPrepare: !!s.upstream.group && q.stage !== 'observe',
      canHandoff: q.stage === 'dev',
      canAccept: x.role === 'owner' && q.stage === 'accept',
    },
    source: 'USER_REPORTED',
  };
  if (
    Buffer.byteLength(JSON.stringify(value)) > policy.limits.jsonBytes &&
    value.currentSuite
  ) {
    value.currentSuite.caseCount = value.currentSuite.cases.length;
    value.currentSuite.cases = [];
    value.currentSuite.casesPartial = true;
  }
  policy.size(value);
  return value;
}
async function releaseInputs(c, d, x, q) {
  const s = await inspect(c, d, x, q),
    blockers = [...s.blockers],
    a = await require('../persistence/product-acceptances').current(
      c,
      d,
      x,
      q,
      s.baseline,
    ),
    batch = await require('../persistence/test-executions').currentCompleted(
      c,
      d,
      x,
      q,
      s.baseline,
    );
  if (
    !a ||
    a.decision !== 'ACCEPTED' ||
    !a.member_active ||
    a.current_role !== 'owner' ||
    a.batch_id !== batch?.id ||
    q.stage !== 'release'
  )
    blockers.push('缺少当前Owner有效产品验收');
  if (s.ready)
    try {
      await testComplete(c, d, x, q, s, batch);
      if (a) await ownerEvidence(c, d, x, q, 'acceptance_id', a.id);
    } catch (e) {
      if (!e.status) throw e;
      blockers.push(e.message);
    }
  return {
    schemaVersion: 1,
    scope: 'PREPARATION_ONLY',
    inputsReady: !blockers.length,
    blockers,
    delivery: await dto.baseline(c, d, x, q, s.baseline),
    test: await dto.batch(c, d, x, q, batch),
    acceptance: await dto.acceptance(c, d, x, q, a),
    risk: a?.risks || '',
    source: 'USER_REPORTED',
    executionAvailable: false,
  };
}
async function stageInputs(id, stage) {
  return read(id, async (c, d, x, q) => {
    if (stage === 'release')
      return { stage, ...(await releaseInputs(c, d, x, q)) };
    const s = await inspect(c, d, x, q);
    const blockers = [...s.blockers];
    let batch = null;
    if (stage === 'accept') {
      batch = await require('../persistence/test-executions').currentCompleted(
        c,
        d,
        x,
        q,
        s.baseline,
      );
      if (s.ready)
        try {
          await testComplete(c, d, x, q, s, batch);
        } catch (e) {
          if (!e.status) throw e;
          blockers.push(e.message);
        }
    }
    return {
      stage,
      ready: !blockers.length,
      blockers,
      delivery: await dto.baseline(c, d, x, q, s.baseline),
      test: await dto.batch(c, d, x, q, batch),
    };
  });
}
async function guardVersion(c, d, x, q, v) {
  if (
    ['test', 'accept', 'release'].includes(v.stage) ||
    (v.stage === 'dev' && (await repo.referencedDev(c, d, x, q, v.id)))
  )
    access.fail(
      'VERIFICATION_WRITE_REQUIRED',
      409,
      '冻结报告不能修改，请登记新版本并重新交接',
    );
}
module.exports = {
  read,
  mutate,
  evidence,
  ownerEvidence,
  activeRuns,
  inspect,
  ready,
  validResults,
  testComplete,
  workspace,
  releaseInputs,
  stageInputs,
  guardVersion,
  getWorkspace: (id) => read(id, workspace),
  getReleaseInputs: (id) => read(id, releaseInputs),
};
