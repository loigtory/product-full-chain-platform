'use strict';
const access = require('../access'),
  s = require('./release-read-service'),
  policy = require('./release-policy'),
  repo = require('../persistence/release-plans'),
  obs = require('../persistence/release-observations'),
  ev = require('../persistence/release-evidence'),
  dto = require('./release-dto');
async function blockers(c, d, x, q, o, p) {
  const reasons = [];
  if (
    o.state !== 'OPEN' ||
    q.current_observation_id !== o.id ||
    q.release_epoch !== p.release_epoch
  )
    reasons.push('OBSERVATION_INCOMPLETE');
  if (await require('../persistence/release-records').unknown(c, d, x, q))
    reasons.push('RELEASE_RESULT_UNKNOWN');
  const results = await require('../persistence/release-records').latest(
    c,
    d,
    x,
    q,
    p.id,
  );
  if (
    results.some((r) => r.content.kind === 'ROLLBACK') ||
    !results.some(
      (r) =>
        r.id === o.result_id && r.status === 'SUCCESS' && r.content.smokePassed,
    )
  )
    reasons.push('RELEASE_RECORD_REQUIRED');
  const entries = await repo.all(c, d, x, q, 'release_metric_events', {
      observation_id: o.id,
    }),
    followups = await obs.followups(c, d, x, q, o);
  reasons.push(
    ...policy.observationBlockers(
      { startedAt: o.started_at, endsAt: o.ends_at, plan: p.content },
      entries.map((r) => r.content),
      followups,
    ),
  );
  try {
    await ev.verify(c, d, x, q, 'plan_id', p.id);
    await ev.verify(c, d, x, q, 'result_id', o.result_id);
    const owner = (
      await require('../persistence/release-records').review(c, d, x, q, p)
    )?.created_by;
    const m =
      owner &&
      (await require('../persistence/verification-baselines').member(
        c,
        d,
        x,
        owner,
      ));
    if (!m?.active || m.role !== 'owner')
      reasons.push('RELEASE_APPROVAL_REQUIRED');
    const seen = new Set();
    for (const r of entries) {
      const key =
        r.content.kind + ':' + (r.content.metricId || r.content.issueId);
      if (!seen.has(key)) {
        seen.add(key);
        await ev.verify(c, d, x, q, 'metric_event_id', r.id);
      }
    }
    for (const f of followups) {
      await s.activeMember(c, d, x, f.owner);
      if (f.status === 'DONE')
        await ev.verify(c, d, x, q, 'followup_event_id', f.eventId);
    }
  } catch (e) {
    if (!e.status) throw e;
    reasons.push(e.code);
  }
  return [...new Set(reasons)];
}
async function editable(c, d, x, q, oid, allowClosed = false) {
  const o = await repo.required(c, d, x, q, 'release_observations', oid),
    p = await repo.required(c, d, x, q, 'release_plans', o.plan_id, true);
  if (
    q.current_observation_id !== o.id ||
    q.release_epoch !== p.release_epoch ||
    o.state === 'STOPPED' ||
    (!allowClosed && (q.closed_at || o.state !== 'OPEN'))
  )
    access.fail('RELEASE_PHASE_LOCKED', 409);
  return { o, p };
}
function addEntry(id, oid, input) {
  return s.mutate(
    id,
    { ...input, observationId: oid },
    'observation.entry',
    async (c, d, x, q) => {
      const { o, p } = await editable(c, d, x, q, oid),
        value = policy.entry(input, {
          startedAt: o.started_at,
          endsAt: o.ends_at,
          plan: p.content,
        });
      await obs.eventBound(c, d, x, q, o);
      const streamKey = value.kind + ':' + (value.metricId || value.issueId),
        prior = (await obs.latestEntries(c, d, x, q, o)).find(
          (r) => r.stream_key === streamKey,
        ),
        chain = policy.sequence(
          input,
          prior
            ? { id: prior.public_id, sequence: prior.event_sequence }
            : null,
        );
      Object.assign(value, chain);
      if (value.kind === 'ISSUE')
        await s.activeMember(c, d, x, value.responsible);
      const checked = await ev.check(c, d, x, q, value.evidence),
        row = await repo.insert(c, d, x, q, 'release_metric_events', {
          observation_id: o.id,
          stream_key: streamKey,
          event_sequence: chain.sequence,
          previous_event_id: prior?.id || null,
          content: JSON.stringify(value),
        });
      await ev.save(c, d, x, q, 'metric_event_id', row.id, checked);
      return { entry: await dto.event(c, d, x, q, row, 'metric_event_id') };
    },
  );
}
function addFollowup(id, oid, input) {
  return s.mutate(
    id,
    { ...input, observationId: oid },
    'observation.followup',
    async (c, d, x, q) => {
      const { o, p } = await editable(c, d, x, q, oid),
        value = policy.followup(input);
      await obs.eventBound(c, d, x, q, o);
      await s.activeMember(c, d, x, value.owner);
      if (
        value.metricId &&
        !p.content.metrics.some((m) => m.metricId === value.metricId)
      )
        access.fail('INVALID_INPUT', 400);
      if (
        value.issueId &&
        !(
          await repo.all(c, d, x, q, 'release_metric_events', {
            observation_id: o.id,
          })
        ).some((e) => e.content.issueId === value.issueId)
      )
        access.fail('INVALID_INPUT', 400);
      await repo.bound(c, d, x, q, 'release_followups', 50, {
        observation_id: o.id,
      });
      const row = await repo.insert(c, d, x, q, 'release_followups', {
        observation_id: o.id,
        content: JSON.stringify(value),
      });
      return { followup: { ...value, id: row.public_id, status: 'OPEN' } };
    },
  );
}
function followupEvent(id, oid, fid, input) {
  return s.mutate(
    id,
    { ...input, observationId: oid, followupId: fid },
    'observation.followupEvent',
    async (c, d, x, q) => {
      const { o } = await editable(c, d, x, q, oid, true),
        f = await repo.required(c, d, x, q, 'release_followups', fid);
      if (f.observation_id !== o.id) access.fail('NOT_FOUND', 404);
      if (q.closed_at && f.content.blocking)
        access.fail('RELEASE_PHASE_LOCKED', 409);
      const value = policy.followupEvent(input);
      await s.activeMember(c, d, x, value.owner);
      await obs.eventBound(c, d, x, q, o);
      const prior = (
          await repo.all(c, d, x, q, 'release_followup_events', {
            followup_id: f.id,
          })
        )[0],
        chain = policy.sequence(
          input,
          prior
            ? { id: prior.public_id, sequence: prior.event_sequence }
            : null,
        );
      Object.assign(value, chain);
      const checked = await ev.check(
          c,
          d,
          x,
          q,
          value.evidence,
          value.status === 'DONE',
        ),
        row = await repo.insert(c, d, x, q, 'release_followup_events', {
          observation_id: o.id,
          followup_id: f.id,
          event_sequence: chain.sequence,
          previous_event_id: prior?.id || null,
          content: JSON.stringify(value),
        });
      await ev.save(c, d, x, q, 'followup_event_id', row.id, checked);
      return { event: await dto.event(c, d, x, q, row, 'followup_event_id') };
    },
  );
}
const get = (id, oid) =>
  s.read(id, async (c, d, x, q) => ({
    observation: await dto.observation(
      c,
      d,
      x,
      q,
      await repo.required(c, d, x, q, 'release_observations', oid),
    ),
  }));
const list = (id, query) =>
  s.read(id, async (c, d, x, q) => {
    const v = await repo.page(c, d, x, q, 'release_observations', query);
    return { ...v, items: v.items.map(dto.summary) };
  });
const entries = (id, oid, query) =>
  s.read(id, async (c, d, x, q) => {
    const o = await repo.required(c, d, x, q, 'release_observations', oid),
      v = await repo.page(c, d, x, q, 'release_metric_events', query, {
        observation_id: o.id,
      });
    return {
      ...v,
      items: await Promise.all(
        v.items.map((r) => dto.event(c, d, x, q, r, 'metric_event_id')),
      ),
    };
  });
const followups = (id, oid, query) =>
  s.read(id, async (c, d, x, q) => {
    const o = await repo.required(c, d, x, q, 'release_observations', oid),
      v = await obs.followups(c, d, x, q, o),
      { limit, offset } = access.page(query);
    return {
      items: v
        .slice(offset, offset + limit)
        .map(({ internalId, eventId, ...r }) => r),
      total: v.length,
      limit,
      offset,
    };
  });
const followupEvents = (id, oid, fid, query) =>
  s.read(id, async (c, d, x, q) => {
    const o = await repo.required(c, d, x, q, 'release_observations', oid),
      f = await repo.required(c, d, x, q, 'release_followups', fid);
    if (f.observation_id !== o.id) access.fail('NOT_FOUND', 404);
    const v = await repo.page(c, d, x, q, 'release_followup_events', query, {
      followup_id: f.id,
    });
    return {
      ...v,
      items: await Promise.all(
        v.items.map((r) => dto.event(c, d, x, q, r, 'followup_event_id')),
      ),
    };
  });
module.exports = {
  blockers,
  editable,
  addEntry,
  addFollowup,
  followupEvent,
  get,
  list,
  entries,
  followups,
  followupEvents,
};
