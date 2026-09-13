'use strict';
const router = require('express').Router(),
  svc = require('../domain/product-acceptance-service');
const handler =
  (fn, status = 200) =>
  async (req, res, next) => {
    try {
      if (!require('../runtime').isPg())
        require('../access').fail('CAPABILITY_UNAVAILABLE');
      res.status(status).json(await fn(req));
    } catch (e) {
      next(e);
    }
  };
router.get(
  '/:id/product-acceptances',
  handler((r) => svc.list(r.params.id, r.query)),
);
router.get(
  '/:id/product-acceptances/:aid',
  handler((r) => svc.get(r.params.id, r.params.aid)),
);
router.post(
  '/:id/product-acceptances',
  handler((r) => svc.create(r.params.id, r.body || {}), 201),
);
module.exports = router;
