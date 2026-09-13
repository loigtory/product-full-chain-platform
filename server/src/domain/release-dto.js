'use strict';
const repo = require('../persistence/release-plans'),
  ev = require('../persistence/release-evidence');
const iso = (v) => (v ? new Date(v).toISOString() : null);
function summary(r) {
  return {
    id: r.public_id,
    version: r.version,
    status: r.status || r.state || r.review_state || r.decision,
    completeness: r.completeness,
    createdAt: iso(r.created_at),
    source: 'USER_REPORTED',
    executionAvailable: false,
  };
}
async function actor(c, d, x, id, frozenName) {
  const m = await require('../persistence/verification-baselines').member(
    c,
    d,
    x,
    id,
  );
  return m
    ? {
        id: m.public_id,
        name: frozenName || m.name,
        currentName: m.name,
        active: m.active,
        role: m.role,
      }
    : null;
}
async function plan(c, d, x, q, r) {
  const review = await require('../persistence/release-records').review(
      c,
      d,
      x,
      q,
      r,
    ),
    reviewer =
      review && (await actor(c, d, x, review.created_by, review.created_name));
  return {
    ...summary(r),
    content: r.content,
    snapshot: r.snapshot,
    fingerprint: r.fingerprint,
    missingFields: r.missing_fields,
    reviewState: r.review_state,
    submittedAt: iso(r.submitted_at),
    expiresAt: iso(r.expires_at),
    createdBy: await actor(c, d, x, r.created_by, r.created_name),
    evidence: await ev.availability(c, d, x, q, 'plan_id', r.id),
    current: q.current_release_id === r.id,
    stale: r.release_epoch !== q.release_epoch,
    canReReview:
      !q.closed_at &&
      q.current_release_id === r.id &&
      r.release_epoch === q.release_epoch &&
      r.review_state === 'APPROVED' &&
      (!reviewer?.active || reviewer.role !== 'owner'),
  };
}
async function event(c, d, x, q, r, kind = 'result_id') {
  return {
    ...summary(r),
    ...r.content,
    createdBy: await actor(c, d, x, r.created_by, r.created_name),
    evidence: await ev.availability(c, d, x, q, kind, r.id),
    previousRecordId: r.previous_event_id
      ? (
          await repo.required(
            c,
            d,
            x,
            q,
            {
              metric_event_id: 'release_metric_events',
              followup_event_id: 'release_followup_events',
            }[kind] || 'release_result_events',
            r.previous_event_id,
            true,
          )
        ).public_id
      : null,
  };
}
async function observation(c, d, x, q, r) {
  const p = await repo.required(c, d, x, q, 'release_plans', r.plan_id, true);
  return {
    ...summary(r),
    releaseId: p.public_id,
    startedAt: iso(r.started_at),
    endsAt: iso(r.ends_at),
    stopReason: r.stop_reason,
    plan: p.content,
    basis: p.snapshot,
    state: r.state,
    remainingSeconds: Math.max(
      0,
      Math.ceil((new Date(r.ends_at).getTime() - Date.now()) / 1000),
    ),
    latestEntries: (
      await require('../persistence/release-observations').latestEntries(
        c,
        d,
        x,
        q,
        r,
      )
    ).map((v) => ({
      id: v.public_id,
      kind: v.content.kind,
      metricId: v.content.metricId,
      issueId: v.content.issueId,
      sequence: v.event_sequence,
      status: v.content.status,
      ...(v.content.kind === 'METRIC'
        ? { actual: v.content.actual, sampledTo: v.content.sampledTo }
        : {}),
    })),
    blockers: await require('./observation-service').blockers(c, d, x, q, r, p),
  };
}
module.exports = { summary, plan, event, observation, actor, iso };
