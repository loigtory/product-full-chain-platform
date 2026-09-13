'use strict';
const repo = require('./release-plans');
async function latest(c, d, x, q, planId) {
  const rows = await repo.all(
      c,
      d,
      x,
      q,
      'release_result_events',
      planId ? { plan_id: planId } : {},
    ),
    seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.attempt_id)) return false;
    seen.add(r.attempt_id);
    return true;
  });
}
async function unknown(c, d, x, q) {
  return (await latest(c, d, x, q)).find((r) => r.status === 'UNKNOWN') || null;
}
async function attempt(c, d, x, q, id) {
  return repo.required(c, d, x, q, 'release_attempts', id, true);
}
async function review(c, d, x, q, p) {
  return (
    (await repo.all(c, d, x, q, 'release_reviews', { plan_id: p.id }))[0] ||
    null
  );
}
module.exports = { latest, unknown, attempt, review };
