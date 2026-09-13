'use strict';
const access = require('../access'),
  policy = require('./release-policy'),
  s = require('./release-read-service'),
  repo = require('../persistence/release-plans'),
  dto = require('./release-dto'),
  ev = require('../persistence/release-evidence');
function create(id, input) {
  return s.mutate(id, input, 'releasePlan.create', async (c, d, x, q) => {
    if (q.closed_at || q.stage === 'observe')
      access.fail('RELEASE_PHASE_LOCKED', 409);
    const value = policy.plan(input),
      snap = await s.snapshot(c, d, x, q);
    if (!snap.state.ready)
      access.fail(
        'RELEASE_BASELINE_STALE',
        409,
        snap.state.blockers.join('；'),
      );
    if (
      value.content.versionRef &&
      value.content.versionRef !== snap.state.baseline.subject.versionRef
    )
      access.fail(
        'RELEASE_BASELINE_STALE',
        409,
        '发布版本必须对应当前交付版本',
      );
    await repo.bound(c, d, x, q, 'release_plans', 100);
    const parent = input.basePlanId
        ? await repo.required(c, d, x, q, 'release_plans', input.basePlanId)
        : null,
      rows = await repo.all(c, d, x, q, 'release_plans');
    if (parent && parent.id !== rows[0]?.id)
      access.fail('RELEASE_BASELINE_STALE', 409);
    const refs = [
      ...value.content.evidence,
      ...value.content.authorization.evidence,
    ].filter(
      (r, i, a) =>
        a.findIndex((v) => v.id === r.id && v.version === r.version) === i,
    );
    const checked = await ev.check(c, d, x, q, refs, false);
    if (value.complete)
      for (const name of [
        value.content.releaseOwner,
        value.content.alertOwner,
        ...value.content.metrics.map((m) => m.owner),
      ])
        await s.activeMember(c, d, x, name);
    const row = await repo.insert(c, d, x, q, 'release_plans', {
      version: rows.length + 1,
      parent_id: parent?.id || null,
      release_epoch: q.release_epoch,
      baseline_id: snap.state.baseline.id,
      content: JSON.stringify(value.content),
      snapshot: JSON.stringify(snap.value),
      fingerprint: require('../persistence/commands').fingerprint(snap.value),
      completeness: value.complete ? 'READY' : 'DRAFT',
      missing_fields: JSON.stringify(value.missingFields),
    });
    await ev.save(c, d, x, q, 'plan_id', row.id, checked);
    await repo.pointers(c, d, x, q, { current_release_plan_id: row.id });
    return { plan: await dto.plan(c, d, x, q, row) };
  });
}
function submit(id, input) {
  return s.mutate(id, input, 'releasePlan.submit', async (c, d, x, q) => {
    const p = await repo.required(c, d, x, q, 'release_plans', input.planId);
    if (p.completeness !== 'READY' || p.review_state !== 'NOT_SUBMITTED')
      access.fail('RELEASE_PREPARATION_REQUIRED', 409);
    if (await require('../persistence/release-records').unknown(c, d, x, q))
      access.fail('RELEASE_RESULT_UNKNOWN', 409);
    await s.current(c, d, x, q, p);
    const until = Date.parse(p.content.authorization.until);
    if (until <= Date.now())
      access.fail('RELEASE_APPROVAL_REQUIRED', 409, '授权声明已过期');
    await repo.reviewState(c, d, x, q, p, 'PENDING', {
      submitted_at: new Date(),
      expires_at: new Date(until),
    });
    await require('../persistence/notices').append(
      c,
      d,
      x,
      q,
      '发布准备 ' + p.public_id + ' 待Owner评审',
    );
    return { release: await dto.plan(c, d, x, q, p) };
  });
}
function review(id, pid, input, decision) {
  return s.mutate(
    id,
    { ...input, releaseId: pid },
    'releaseReview.' + decision.toLowerCase(),
    async (c, d, x, q) => {
      if (x.role !== 'owner') access.fail('FORBIDDEN', 403);
      const p = await repo.required(c, d, x, q, 'release_plans', pid);
      const reReview = (await dto.plan(c, d, x, q, p)).canReReview,
        unknown = await require('../persistence/release-records').unknown(
          c,
          d,
          x,
          q,
        );
      if (p.review_state !== 'PENDING' && !reReview)
        access.fail('RELEASE_APPROVAL_REQUIRED', 409);
      const comment = policy.field(input.comment, true);
      const reconcile =
        !!unknown &&
        reReview &&
        unknown.plan_id === p.id &&
        decision === 'APPROVED';
      await s.current(c, d, x, q, p, {
        live: q.stage !== 'observe',
        historicalMembers: reconcile,
      });
      if (
        Date.now() > new Date(p.expires_at).getTime() &&
        !unknown &&
        q.stage !== 'observe'
      )
        access.fail('RELEASE_APPROVAL_REQUIRED', 409);
      if (
        unknown &&
        (!reReview || unknown.plan_id !== p.id || decision !== 'APPROVED')
      )
        access.fail('RELEASE_RESULT_UNKNOWN', 409);
      await repo.bound(c, d, x, q, 'release_reviews', 20, { plan_id: p.id });
      if (decision === 'APPROVED') {
        for (const old of await repo.all(c, d, x, q, 'release_plans', {
          review_state: 'APPROVED',
        }))
          if (old.id !== p.id)
            await repo.reviewState(c, d, x, q, old, 'SUPERSEDED');
        await repo.pointers(c, d, x, q, { current_release_id: p.id });
      }
      await repo.insert(c, d, x, q, 'release_reviews', {
        plan_id: p.id,
        decision,
        comment: policy.field(
          reconcile
            ? '沿用冻结验收 ' +
                p.snapshot.acceptanceId +
                ' 核实原记录 ' +
                unknown.public_id +
                '；' +
                comment
            : comment,
          true,
        ),
      });
      await repo.reviewState(c, d, x, q, p, decision);
      return { release: await dto.plan(c, d, x, q, p) };
    },
  );
}
async function globalReview(pid, input, decision) {
  const accessCtx = access.current(),
    d = require('../runtime').db();
  const id = await require('./membership-policy').read(
    d,
    accessCtx,
    true,
    async (c) => {
      const row = await repo.requirementForPlan(c, d, accessCtx, pid);
      if (!row) access.fail('NOT_FOUND', 404);
      return row.public_id;
    },
  );
  return review(id, pid, input, decision);
}
const get = (id, pid) =>
  s.read(id, async (c, d, x, q) => ({
    release: await dto.plan(
      c,
      d,
      x,
      q,
      await repo.required(c, d, x, q, 'release_plans', pid),
    ),
  }));
const list = (id, query, submittedOnly = false) =>
  s.read(id, async (c, d, x, q) => {
    const v = await repo.page(c, d, x, q, 'release_plans', {
      ...query,
      submittedOnly,
    });
    return { ...v, items: v.items.map(dto.summary) };
  });
const reviews = (id, pid, query) =>
  s.read(id, async (c, d, x, q) => {
    const p = await repo.required(c, d, x, q, 'release_plans', pid),
      v = await repo.page(c, d, x, q, 'release_reviews', query, {
        plan_id: p.id,
      });
    return {
      ...v,
      items: await Promise.all(
        v.items.map(async (r) => ({
          ...dto.summary(r),
          decision: r.decision,
          comment: r.comment,
          actor: await dto.actor(c, d, x, r.created_by, r.created_name),
        })),
      ),
    };
  });
module.exports = { create, submit, review, globalReview, get, list, reviews };
