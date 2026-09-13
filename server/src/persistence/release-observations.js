'use strict';
const repo = require('./release-plans');
async function latestEntries(c, d, x, q, o) {
  return (
    await c.query(
      `SELECT DISTINCT ON (stream_key) * FROM ${repo.table(d, 'release_metric_events')} WHERE tenant_id=$1 AND req_id=$2 AND observation_id=$3 ORDER BY stream_key,event_sequence DESC`,
      [x.tenantId, q.id, o.id],
    )
  ).rows;
}
async function eventBound(c, d, x, q, o) {
  const r = await c.query(
    `SELECT (SELECT count(*) FROM ${repo.table(d, 'release_metric_events')} WHERE tenant_id=$1 AND req_id=$2 AND observation_id=$3)+(SELECT count(*) FROM ${repo.table(d, 'release_followup_events')} WHERE tenant_id=$1 AND req_id=$2 AND observation_id=$3)+(SELECT count(*) FROM ${repo.table(d, 'release_followups')} WHERE tenant_id=$1 AND req_id=$2 AND observation_id=$3) n`,
    [x.tenantId, q.id, o.id],
  );
  if (Number(r.rows[0].n) >= 2000)
    require('../access').fail(
      'RELEASE_LIMIT_EXCEEDED',
      413,
      '本观察记录数达到上限',
    );
}
async function stop(c, d, x, q, o, reason, state = 'STOPPED') {
  Object.assign(
    o,
    (
      await c.query(
        `UPDATE ${repo.table(d, 'release_observations')} SET state=$4,stop_reason=$5 WHERE tenant_id=$1 AND req_id=$2 AND id=$3 RETURNING *`,
        [x.tenantId, q.id, o.id, state, reason],
      )
    ).rows[0],
  );
}
async function followups(c, d, x, q, o) {
  const headers = await repo.all(c, d, x, q, 'release_followups', {
      observation_id: o.id,
    }),
    events = await repo.all(c, d, x, q, 'release_followup_events', {
      observation_id: o.id,
    });
  return headers.map((h) => {
    const e = events.find((e) => e.followup_id === h.id);
    return {
      ...h.content,
      ...e?.content,
      id: h.public_id,
      internalId: h.id,
      status: e?.content.status || 'OPEN',
      eventId: e?.id || null,
      previousRecordId: e?.public_id || null,
      sequence: e?.event_sequence || 0,
    };
  });
}
module.exports = { stop, followups, latestEntries, eventBound };
