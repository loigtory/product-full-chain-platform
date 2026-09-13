'use strict';
const repo = require('./release-plans');
async function close(c, d, x, q, o) {
  await require('./release-observations').stop(
    c,
    d,
    x,
    q,
    o,
    '最终验收通过',
    'CLOSED',
  );
  await repo.pointers(c, d, x, q, { closed_at: new Date(), stage: 'observe' });
}
async function returnToRepair(c, d, x, q, p, stage, comment) {
  const o = q.current_observation_id
    ? await repo.required(
        c,
        d,
        x,
        q,
        'release_observations',
        q.current_observation_id,
        true,
      )
    : null;
  if (o) await require('./release-observations').stop(c, d, x, q, o, comment);
  await repo.insert(c, d, x, q, 'release_returns', {
    plan_id: p.id,
    return_stage: stage,
    comment,
    release_epoch: q.release_epoch,
  });
  await repo.reviewState(c, d, x, q, p, 'SUPERSEDED');
  await require('./verification-baselines').invalidate(c, d, x, q);
  await require('./requirements').staleAfter(c, d, x, q.id, stage);
  await repo.pointers(c, d, x, q, {
    stage,
    release_epoch: q.release_epoch + 1,
    current_release_id: null,
    current_release_plan_id: null,
    current_observation_id: null,
  });
}
module.exports = { close, returnToRepair };
