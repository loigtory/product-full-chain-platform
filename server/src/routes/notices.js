'use strict';
const router = require('express').Router(),
  svc = require('../domain/service');
router.get('/', async (req, res, next) => {
  try {
    res.json(await svc.listNotices());
  } catch (e) {
    next(e);
  }
});
router.post('/:id/read', async (req, res, next) => {
  try {
    res.json(await svc.readNotice(req.params.id, req.body || {}));
  } catch (e) {
    next(e);
  }
});
router.post('/read-all', async (req, res, next) => {
  try {
    res.json(await svc.readAllNotices(req.body || {}));
  } catch (e) {
    next(e);
  }
});
module.exports = router;
