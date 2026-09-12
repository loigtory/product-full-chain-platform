'use strict';
const router = require('express').Router(),
  service = require('../domain/member-service');
router.get('/', async (req, res, next) => {
  try {
    res.json(await service.list(req.query));
  } catch (e) {
    next(e);
  }
});
router.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.body || {}));
  } catch (e) {
    next(e);
  }
});
router.patch('/:uid/role', async (req, res, next) => {
  try {
    res.json(await service.update(req.params.uid, req.body || {}));
  } catch (e) {
    next(e);
  }
});
router.delete('/:uid', async (req, res, next) => {
  try {
    res.json(await service.update(req.params.uid, req.body || {}, true));
  } catch (e) {
    next(e);
  }
});
module.exports = router;
