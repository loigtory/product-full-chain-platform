'use strict';
const router = require('express').Router(),
  service = require('../domain/observation-service'),
  final = require('../domain/final-acceptance-service');
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
router.get('/:id/stage-inputs', (r, s, n) =>
  r.query.stage === 'observe'
    ? handler(async (r) => ({
        stage: 'observe',
        ...(await require('../domain/release-read-service').getWorkspace(
          r.params.id,
        )),
      }))(r, s, n)
    : n(),
);
router.get(
  '/:id/observations',
  handler((r) => service.list(r.params.id, r.query)),
);
router.get(
  '/:id/observations/:oid',
  handler((r) => service.get(r.params.id, r.params.oid)),
);
for (const [path, get, post] of [
  ['entries', service.entries, service.addEntry],
  ['followups', service.followups, service.addFollowup],
  ['final-acceptances', final.list, final.create],
]) {
  router.get(
    '/:id/observations/:oid/' + path,
    handler((r) => get(r.params.id, r.params.oid, r.query)),
  );
  router.post(
    '/:id/observations/:oid/' + path,
    handler((r) => post(r.params.id, r.params.oid, r.body || {}), 201),
  );
}
router.get(
  '/:id/observations/:oid/followups/:fid/events',
  handler((r) =>
    service.followupEvents(r.params.id, r.params.oid, r.params.fid, r.query),
  ),
);
router.post(
  '/:id/observations/:oid/followups/:fid/events',
  handler(
    (r) =>
      service.followupEvent(
        r.params.id,
        r.params.oid,
        r.params.fid,
        r.body || {},
      ),
    201,
  ),
);
module.exports = router;
