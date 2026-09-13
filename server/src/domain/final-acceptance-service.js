'use strict';
const access = require('../access'),
  s = require('./release-read-service'),
  policy = require('./release-policy'),
  repo = require('../persistence/release-plans'),
  obs = require('./observation-service'),
  dto = require('./release-dto');
function create(id, oid, input) {
  return s.mutate(
    id,
    { ...input, observationId: oid },
    'finalAcceptance.create',
    async (c, d, x, q) => {
      if (x.role !== 'owner') access.fail('FINAL_ACCEPTANCE_FORBIDDEN', 403);
      await repo.bound(c, d, x, q, 'final_acceptances', 200);
      const { o, p } = await obs.editable(c, d, x, q, oid),
        value = policy.final(input),
        blockers = await obs.blockers(c, d, x, q, o, p);
      if (value.decision === 'ACCEPTED' && blockers.length)
        access.fail(blockers[0], 409, blockers.join('；'));
      const followups =
          await require('../persistence/release-observations').followups(
            c,
            d,
            x,
            q,
            o,
          ),
        entries = await repo.all(c, d, x, q, 'release_metric_events', {
          observation_id: o.id,
        });
      const snapshot = {
        releaseId: p.public_id,
        plan: p.content,
        basis: p.snapshot,
        observationId: o.public_id,
        startedAt: dto.iso(o.started_at),
        endsAt: dto.iso(o.ends_at),
        entryIds: entries.map((r) => r.public_id),
        followups: followups.map(({ internalId, eventId, ...r }) => r),
        blockers,
        source: 'USER_REPORTED',
      };
      policy.size(snapshot);
      const version =
        await require('../persistence/requirements').appendVersion(
          c,
          d,
          x,
          q,
          'observe',
          {
            title:
              '最终验收与复盘 · ' +
              (value.decision === 'ACCEPTED' ? '通过' : '驳回'),
            fields: [
              { name: '目标实际对照', value: value.actual },
              { name: '最终结论', value: value.conclusion },
              { name: '复盘', value: value.retrospective },
              { name: '遗留风险', value: value.risks },
            ],
          },
        );
      if (value.decision === 'ACCEPTED')
        await require('../persistence/verification-baselines').confirmVersion(
          c,
          d,
          x,
          q,
          version.id,
        );
      const row = await repo.insert(c, d, x, q, 'final_acceptances', {
        observation_id: o.id,
        decision: value.decision,
        content: JSON.stringify(value),
        snapshot: JSON.stringify(snapshot),
        report_version_id: version.id,
      });
      if (value.decision === 'ACCEPTED')
        await require('../persistence/release-closure').close(c, d, x, q, o);
      return {
        acceptance: { ...dto.summary(row), ...value, snapshot },
        closedAt: q.closed_at,
      };
    },
  );
}
function repair(id, pid, input) {
  return s.mutate(
    id,
    { ...input, releaseId: pid },
    'releaseReturn.create',
    async (c, d, x, q) => {
      if (x.role !== 'owner') access.fail('FORBIDDEN', 403);
      if (q.closed_at) access.fail('RELEASE_PHASE_LOCKED', 409);
      if (await require('../persistence/release-records').unknown(c, d, x, q))
        access.fail('RELEASE_RESULT_UNKNOWN', 409);
      const p = await repo.required(c, d, x, q, 'release_plans', pid);
      if (p.release_epoch !== q.release_epoch || q.current_release_id !== p.id)
        access.fail('RELEASE_BASELINE_STALE', 409);
      const comment = policy.field(input.comment, true);
      if (!['req', 'design', 'dev'].includes(input.returnStage))
        access.fail('INVALID_INPUT', 400);
      await require('../persistence/release-closure').returnToRepair(
        c,
        d,
        x,
        q,
        p,
        input.returnStage,
        comment,
      );
      return { nextStage: q.stage };
    },
  );
}
const list = (id, oid, query) =>
  s.read(id, async (c, d, x, q) => {
    const o = await repo.required(c, d, x, q, 'release_observations', oid),
      v = await repo.page(c, d, x, q, 'final_acceptances', query, {
        observation_id: o.id,
      });
    return {
      ...v,
      items: await Promise.all(
        v.items.map(async (r) => ({
          ...dto.summary(r),
          ...r.content,
          snapshot: r.snapshot,
          actor: await dto.actor(c, d, x, r.created_by, r.created_name),
        })),
      ),
    };
  });
module.exports = { create, repair, list };
