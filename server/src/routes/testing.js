'use strict';
const router = require('express').Router(),
  suites = require('../domain/test-suite-service'),
  delivery = require('../domain/delivery-baseline-service'),
  tests = require('../domain/test-execution-service'),
  defects = require('../domain/defect-service'),
  read = require('../domain/verification-read-service');
const handler =
  (fn, status = 200) =>
  async (req, res, next) => {
    try {
      if (!require('../runtime').isPg())
        require('../access').fail(
          'CAPABILITY_UNAVAILABLE',
          409,
          '当前模式未接入测试验收存储',
        );
      res.status(status).json(await fn(req));
    } catch (e) {
      next(e);
    }
  };
router.get(
  '/:id/verification-workspace',
  handler((r) => read.getWorkspace(r.params.id)),
);
router.get(
  '/:id/release-inputs',
  handler((r) => read.getReleaseInputs(r.params.id)),
);
router.get(
  '/:id/test-suites',
  handler((r) => suites.list(r.params.id, r.query)),
);
router.get(
  '/:id/test-suites/:sid',
  handler((r) => suites.get(r.params.id, r.params.sid)),
);
router.post(
  '/:id/test-suites',
  handler((r) => suites.create(r.params.id, r.body || {}), 201),
);
router.post(
  '/:id/test-suites/:sid/adopt',
  handler((r) => suites.adopt(r.params.id, r.params.sid, r.body || {})),
);
router.get(
  '/:id/delivery-baselines',
  handler((r) => delivery.list(r.params.id, r.query)),
);
router.get(
  '/:id/delivery-baselines/:bid',
  handler((r) => delivery.get(r.params.id, r.params.bid)),
);
router.post(
  '/:id/delivery-baselines',
  handler((r) => delivery.create(r.params.id, r.body || {}), 201),
);
router.get(
  '/:id/test-batches',
  handler((r) => tests.list(r.params.id, r.query)),
);
router.get(
  '/:id/test-batches/:bid',
  handler((r) => tests.get(r.params.id, r.params.bid, r.query)),
);
router.post(
  '/:id/test-batches',
  handler((r) => tests.create(r.params.id, r.body || {}), 201),
);
router.post(
  '/:id/test-batches/:bid/results',
  handler(
    (r) => tests.addResults(r.params.id, r.params.bid, r.body || {}),
    201,
  ),
);
router.post(
  '/:id/test-batches/:bid/complete',
  handler((r) => tests.complete(r.params.id, r.params.bid, r.body || {})),
);
router.post(
  '/:id/test-batches/:bid/cancel',
  handler((r) => tests.cancel(r.params.id, r.params.bid, r.body || {})),
);
router.get(
  '/:id/defects',
  handler((r) => defects.list(r.params.id, r.query)),
);
router.get(
  '/:id/defects/:did',
  handler((r) => defects.get(r.params.id, r.params.did, r.query)),
);
router.post(
  '/:id/defects',
  handler((r) => defects.create(r.params.id, r.body || {}), 201),
);
router.post(
  '/:id/defects/:did/resolve',
  handler((r) => defects.resolve(r.params.id, r.params.did, r.body || {})),
);
router.post(
  '/:id/defects/:did/retest',
  handler((r) => defects.retest(r.params.id, r.params.did, r.body || {})),
);
module.exports = router;
