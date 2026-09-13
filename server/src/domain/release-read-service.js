'use strict';
const access = require('../access'),
  runtime = require('../runtime'),
  policy = require('./release-policy'),
  repo = require('../persistence/release-plans'),
  evidence = require('../persistence/release-evidence'),
  verification = require('./verification-read-service');
const read = (id, work) =>
  verification.read(id, async (...args) => {
    const value = await work(...args);
    policy.size(value);
    return value;
  });
async function mutate(id, input, operation, work) {
  policy.size(input);
  const x = access.current(true),
    d = runtime.db();
  return require('../persistence/commands').command(
    d,
    x,
    operation,
    { ...input, _reqTarget: id },
    async (c) => {
      const q = await require('../persistence/requirements').lock(c, d, x, id);
      access.revision(q, input.expectedRevision);
      const value = await work(c, d, x, q);
      const updated = await require('../persistence/requirements').touch(
        c,
        d,
        x,
        q,
        operation,
      );
      const response = {
        ...value,
        req: require('./dto').req(updated),
        reqId: id,
        revision: updated.revision,
        source: 'USER_REPORTED',
        executionAvailable: false,
      };
      policy.size(response);
      return response;
    },
  );
}
async function snapshot(c, d, x, q) {
  const s = await verification.inspect(c, d, x, q),
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
  if (!s.baseline)
    access.fail('RELEASE_PREPARATION_REQUIRED', 409, '先登记有效交付基线');
  return {
    state: s,
    value: {
      reqId: q.public_id,
      projectId: q.project_id,
      baselineId: s.baseline.public_id,
      baselineFingerprint: s.baseline.fingerprint,
      groupId: s.upstream.group?.public_id,
      inputFingerprint: s.upstream.inputs.fingerprint,
      verificationEpoch: q.verification_epoch,
      acceptanceId: a?.public_id || null,
      testId: batch?.public_id || null,
      goal: q.goal,
      scope: q.scope,
      acceptanceCriteria: s.upstream.group?.acceptance?.content?.items || [],
    },
  };
}
async function current(c, d, x, q, p, { approved = false, live = true } = {}) {
  if (q.closed_at || p.release_epoch !== q.release_epoch)
    access.fail('RELEASE_BASELINE_STALE', 409);
  if (
    approved &&
    (p.review_state !== 'APPROVED' || q.current_release_id !== p.id)
  )
    access.fail('RELEASE_APPROVAL_REQUIRED', 409);
  if (live) {
    const inputs = await verification.releaseInputs(c, d, x, q);
    if (!inputs.inputsReady)
      access.fail(
        'RELEASE_PREPARATION_REQUIRED',
        409,
        inputs.blockers.join('；'),
      );
    const s = await snapshot(c, d, x, q);
    if (
      require('../persistence/commands').fingerprint(s.value) !== p.fingerprint
    )
      access.fail('RELEASE_BASELINE_STALE', 409);
    if (
      await require('../persistence/verification-baselines').activeRun(
        c,
        d,
        x,
        q,
      )
    )
      access.fail('RELEASE_PHASE_LOCKED', 409, '先处理活动或结果未知作业');
  }
  if (approved) {
    const review = await require('../persistence/release-records').review(
        c,
        d,
        x,
        q,
        p,
      ),
      owner =
        review &&
        (await require('../persistence/verification-baselines').member(
          c,
          d,
          x,
          review.created_by,
        ));
    if (
      !owner?.active ||
      owner.role !== 'owner' ||
      review.decision !== 'APPROVED'
    )
      access.fail('RELEASE_APPROVAL_REQUIRED', 409, '发布评审已失效');
  }
  await evidence.verify(c, d, x, q, 'plan_id', p.id);
}
async function activeMember(c, d, x, name, ownerOnly = false) {
  const r = await repo.memberNamed(c, d, x, name);
  if (
    !r?.active ||
    !(ownerOnly ? ['owner'] : ['owner', 'executor']).includes(r.role)
  )
    access.fail('INVALID_INPUT', 400, '负责人须为当前有效成员');
  return r;
}
async function workspace(c, d, x, q) {
  const dto = require('./release-dto'),
    plans = await repo.page(c, d, x, q, 'release_plans'),
    observations = await repo.page(c, d, x, q, 'release_observations');
  let inputs = null,
    blockers = [];
  if (q.stage !== 'observe' && !q.closed_at) {
    inputs = await verification.releaseInputs(c, d, x, q);
    blockers = inputs.blockers;
  }
  const p = q.current_release_id
      ? await repo.find(c, d, x, q, 'release_plans', q.current_release_id, true)
      : null,
    o = q.current_observation_id
      ? await repo.find(
          c,
          d,
          x,
          q,
          'release_observations',
          q.current_observation_id,
          true,
        )
      : null;
  const value = {
    schemaVersion: 1,
    scope: 'RELEASE_RECORDS_ONLY',
    reqId: q.public_id,
    revision: q.revision,
    stage: q.stage,
    closedAt: q.closed_at,
    source: 'USER_REPORTED',
    executionAvailable: false,
    inputs,
    blockers,
    currentRelease: p ? await dto.plan(c, d, x, q, p) : null,
    currentObservation: o ? await dto.observation(c, d, x, q, o) : null,
    plans: { ...plans, items: plans.items.map(dto.summary) },
    observations: {
      ...observations,
      items: observations.items.map(dto.summary),
    },
    actions: {
      canWrite: ['owner', 'executor'].includes(x.role),
      canReview: x.role === 'owner',
      canPrepare:
        !!q.current_delivery_baseline_id &&
        !q.closed_at &&
        q.stage !== 'observe',
      canFinalize: x.role === 'owner' && q.stage === 'observe' && !q.closed_at,
    },
  };
  policy.size(value);
  return value;
}
module.exports = {
  read,
  mutate,
  snapshot,
  current,
  activeMember,
  workspace,
  getWorkspace: (id) => read(id, workspace),
};
