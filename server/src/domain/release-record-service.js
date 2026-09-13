'use strict';
const access = require('../access'),
  policy = require('./release-policy'),
  s = require('./release-read-service'),
  repo = require('../persistence/release-plans'),
  records = require('../persistence/release-records'),
  ev = require('../persistence/release-evidence'),
  dto = require('./release-dto');
function create(id, pid, input, kind = 'DEPLOY') {
  return s.mutate(
    id,
    { ...input, releaseId: pid },
    'releaseResult.' + kind.toLowerCase(),
    async (c, d, x, q) => {
      const p = await repo.required(c, d, x, q, 'release_plans', pid),
        unknown = await records.unknown(c, d, x, q),
        previous = input.previousRecordId
          ? await repo.required(
              c,
              d,
              x,
              q,
              'release_result_events',
              input.previousRecordId,
            )
          : null,
        latest = await records.latest(c, d, x, q, p.id);
      if (previous && previous.plan_id !== p.id) access.fail('NOT_FOUND', 404);
      if (unknown && unknown.id !== previous?.id)
        access.fail('RELEASE_RESULT_UNKNOWN', 409);
      if (
        previous &&
        (previous.status !== 'UNKNOWN' ||
          !latest.some((r) => r.id === previous.id))
      )
        access.fail('RELEASE_RESULT_UNKNOWN', 409, '只能核验同一未知尝试');
      const hasSuccess = latest.some(
        (r) => r.status === 'SUCCESS' && r.content.kind === 'DEPLOY',
      );
      await s.current(c, d, x, q, p, { approved: true, live: !hasSuccess });
      if (q.closed_at) access.fail('RELEASE_PHASE_LOCKED', 409);
      if (kind === 'ROLLBACK' && !hasSuccess)
        access.fail('RELEASE_RECORD_REQUIRED', 409, '先登记成功发布');
      if (!previous && kind === 'DEPLOY' && latest.length)
        access.fail(
          'RELEASE_APPROVAL_REQUIRED',
          409,
          '本计划已尝试，请新建计划重新评审',
        );
      if (
        !previous &&
        kind === 'ROLLBACK' &&
        latest.some((r) => r.content.kind === 'ROLLBACK')
      )
        access.fail('RELEASE_RETURN_REQUIRED', 409, '已有回退记录，请返回修复');
      const value = policy.result(input, p.content, kind);
      if (kind === 'ROLLBACK') {
        const deployed = latest.find(
          (r) => r.content.kind === 'DEPLOY' && r.status === 'SUCCESS',
        );
        if (Date.parse(value.startedAt) < Date.parse(deployed.content.endedAt))
          access.fail('INVALID_INPUT', 400, '回退开始时间不能早于本次发布结束');
      }
      if (
        previous &&
        (previous.content.kind !== kind ||
          previous.content.startedAt !== value.startedAt)
      )
        access.fail(
          'RELEASE_RESULT_UNKNOWN',
          409,
          '核验不得更换原尝试及开始时间',
        );
      await repo.bound(c, d, x, q, 'release_result_events', 200);
      const checked = await ev.check(
        c,
        d,
        x,
        q,
        value.evidence,
        value.status !== 'UNKNOWN',
      );
      const review = await records.review(c, d, x, q, p);
      const attempt = previous
        ? await records.attempt(c, d, x, q, previous.attempt_id)
        : await repo.insert(c, d, x, q, 'release_attempts', {
            plan_id: p.id,
            review_id: review.id,
            kind,
            previous_attempt_id: latest[0]?.attempt_id || null,
          });
      let report = null;
      if (kind === 'DEPLOY' && value.status === 'SUCCESS' && value.smokePassed)
        report = await require('../persistence/requirements').appendVersion(
          c,
          d,
          x,
          q,
          'release',
          {
            title: '发布结果 · 人工登记',
            fields: [
              { name: '批准计划', value: p.public_id },
              {
                name: '目标版本',
                value: value.target + ' / ' + value.versionRef,
              },
              { name: '实际结果', value: value.actual },
              { name: '来源', value: 'USER_REPORTED' },
            ],
          },
        );
      if (report)
        await require('../persistence/verification-baselines').confirmVersion(
          c,
          d,
          x,
          q,
          report.id,
        );
      const row = await repo.insert(c, d, x, q, 'release_result_events', {
        attempt_id: attempt.id,
        plan_id: p.id,
        previous_event_id: previous?.id || null,
        status: value.status,
        content: JSON.stringify(value),
        report_version_id: report?.id || null,
      });
      await ev.save(c, d, x, q, 'result_id', row.id, checked);
      let observation = null;
      if (report) {
        observation = await repo.insert(c, d, x, q, 'release_observations', {
          plan_id: p.id,
          attempt_id: attempt.id,
          result_id: row.id,
          started_at: value.endedAt,
          ends_at: new Date(
            Date.parse(value.endedAt) + p.content.hours * 3600000,
          ),
        });
        await repo.pointers(c, d, x, q, {
          stage: 'observe',
          current_observation_id: observation.id,
        });
      }
      if (kind === 'ROLLBACK' && q.current_observation_id) {
        const o = await repo.required(
          c,
          d,
          x,
          q,
          'release_observations',
          q.current_observation_id,
          true,
        );
        await require('../persistence/release-observations').stop(
          c,
          d,
          x,
          q,
          o,
          '回退记录：' + value.status,
        );
      }
      return {
        record: await dto.event(c, d, x, q, row),
        observation: observation
          ? await dto.observation(c, d, x, q, observation)
          : null,
      };
    },
  );
}
const list = (id, pid, query) =>
  s.read(id, async (c, d, x, q) => {
    const p = await repo.required(c, d, x, q, 'release_plans', pid),
      v = await repo.page(c, d, x, q, 'release_result_events', query, {
        plan_id: p.id,
      });
    return {
      ...v,
      items: await Promise.all(v.items.map((r) => dto.event(c, d, x, q, r))),
    };
  });
module.exports = { create, list };
