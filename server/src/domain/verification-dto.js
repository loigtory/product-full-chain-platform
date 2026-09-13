'use strict';
const repo = require('../persistence/verification-baselines');
const iso = (v) => (v ? new Date(v).toISOString() : null);
const summary = (r) => ({
  id: r.public_id,
  title: r.title,
  state: r.state || r.status || r.decision,
  version: r.version,
  createdAt: iso(r.created_at),
});
async function suite(c, d, x, q, r) {
  if (!r) return null;
  return {
    ...summary(r),
    status: r.status,
    groupId: await repo.publicId(c, d, x, q, 'artifact_groups', r.group_id),
    parentId: await repo.publicId(c, d, x, q, 'test_suites', r.parent_id),
    fingerprint: r.fingerprint,
    gaps: r.gaps,
    cases: (
      await require('../persistence/test-suites').cases(c, d, x, q, r)
    ).map((v) => v.content),
  };
}
async function baseline(c, d, x, q, r) {
  if (!r) return null;
  return {
    ...summary(r),
    snapshot: r.snapshot,
    subject: r.subject,
    fingerprint: r.fingerprint,
    evidence: await repo.refs(c, d, x, q, 'baseline_id', r.id),
  };
}
async function batch(c, d, x, q, r) {
  if (!r) return null;
  return {
    ...summary(r),
    baselineId: await repo.publicId(
      c,
      d,
      x,
      q,
      'delivery_baselines',
      r.baseline_id,
    ),
    suiteId: await repo.publicId(c, d, x, q, 'test_suites', r.suite_id),
    environment: r.environment,
    source: r.source,
    cancelReason: r.cancel_reason || null,
    reportVersionId: await repo.publicId(
      c,
      d,
      x,
      q,
      'req_versions',
      r.report_version_id,
    ),
    finalizedAt: iso(r.finalized_at),
  };
}
async function result(c, d, x, q, r) {
  return {
    id: r.public_id,
    caseId: r.case_id,
    status: r.status,
    sequence: r.sequence,
    previousResultId: await repo.publicId(
      c,
      d,
      x,
      q,
      'test_results',
      r.previous_result_id,
    ),
    actual: r.actual,
    reason: r.reason,
    source: r.source,
    executedAt: iso(r.executed_at),
    registeredAt: iso(r.registered_at),
    registeredBy: (await repo.member(c, d, x, r.registered_by))?.name,
    evidence: await repo.refs(c, d, x, q, 'result_id', r.id),
  };
}
async function defect(c, d, x, q, r) {
  return {
    ...summary(r),
    caseId: r.case_id,
    description: r.description,
    sourceResultId: await repo.publicId(
      c,
      d,
      x,
      q,
      'test_results',
      r.source_result_id,
    ),
    resolvedDevVersionId: await repo.publicId(
      c,
      d,
      x,
      q,
      'req_versions',
      r.resolved_dev_version_id,
    ),
  };
}
async function acceptance(c, d, x, q, r) {
  if (!r) return null;
  return {
    ...summary(r),
    decision: r.decision,
    checks: r.checks,
    comment: r.comment,
    risks: r.risks,
    snapshot: r.snapshot,
    member: (await repo.member(c, d, x, r.member_id))?.name,
    reportVersionId: await repo.publicId(
      c,
      d,
      x,
      q,
      'req_versions',
      r.report_version_id,
    ),
  };
}
module.exports = {
  summary,
  suite,
  baseline,
  batch,
  result,
  defect,
  acceptance,
};
