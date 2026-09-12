'use strict';
const router = require('express').Router(),
  service = require('../domain/capability-service');
router.get('/', async (req, res, next) => {
  try {
    res.json(await service.listBindings());
  } catch (e) {
    next(e);
  }
});
router.put('/', async (req, res, next) => {
  try {
    res.json(await service.saveBindings(req.body || {}));
  } catch (e) {
    next(e);
  }
});
module.exports = router;
