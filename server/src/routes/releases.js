'use strict';
const router = require('express').Router(),
  plans = require('../domain/release-plan-service'),
  records = require('../domain/release-record-service');
const handler =
  (fn, status = 200) =>
  async (req, res, next) => {
    try {
      if (!require('../runtime').isPg())
        require('../access').fail('CAPABILITY_UNAVAILABLE', 409);
      res.status(status).json(await fn(req));
    } catch (e) {
      next(e);
    }
  };
router.get(
  '/reqs/:id/release-workspace',
  handler((r) =>
    require('../domain/release-read-service').getWorkspace(r.params.id),
  ),
);
for (const path of ['release-plans', 'releases']) {
  router.get(
    '/reqs/:id/' + path,
    handler((r) => plans.list(r.params.id, r.query, path === 'releases')),
  );
  router.get(
    '/reqs/:id/' + path + '/:rid',
    handler((r) => plans.get(r.params.id, r.params.rid)),
  );
}
router.post(
  '/reqs/:id/release-plans',
  handler((r) => plans.create(r.params.id, r.body || {}), 201),
);
router.post(
  '/reqs/:id/releases',
  handler((r) => plans.submit(r.params.id, r.body || {}), 201),
);
router.get(
  '/reqs/:id/releases/:rid/reviews',
  handler((r) => plans.reviews(r.params.id, r.params.rid, r.query)),
);
for (const [action, decision] of [
  ['approve', 'APPROVED'],
  ['reject', 'REJECTED'],
])
  router.post(
    '/releases/:rid/' + action,
    handler((r) => plans.globalReview(r.params.rid, r.body || {}, decision)),
  );
router.get(
  '/reqs/:id/releases/:rid/reported-results',
  handler((r) => records.list(r.params.id, r.params.rid, r.query)),
);
router.post(
  '/reqs/:id/releases/:rid/reported-results',
  handler((r) => records.create(r.params.id, r.params.rid, r.body || {}), 201),
);
router.post(
  '/reqs/:id/releases/:rid/reported-rollbacks',
  handler(
    (r) => records.create(r.params.id, r.params.rid, r.body || {}, 'ROLLBACK'),
    201,
  ),
);
router.post(
  '/reqs/:id/releases/:rid/return-to-repair',
  handler((r) =>
    require('../domain/final-acceptance-service').repair(
      r.params.id,
      r.params.rid,
      r.body || {},
    ),
  ),
);
for (const path of ['execute', 'rollback', 'cicd'])
  router.post(
    '/releases/:rid/' + path,
    handler(() =>
      require('../access').fail(
        'CAPABILITY_UNAVAILABLE',
        409,
        '仅记录人工结果，平台不执行发布或回退',
      ),
    ),
  );
module.exports = router;
