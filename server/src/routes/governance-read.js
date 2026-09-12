'use strict';
const router = require('express').Router(),
  service = require('../domain/governance-read-service');
router.get('/audit', async (req, res, next) => {
  try {
    res.json(await service.audit(req.query));
  } catch (e) {
    next(e);
  }
});
router.get('/audit/export', async (req, res, next) => {
  try {
    const r = await service.exportAudit(req.query);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="pfc-audit.csv"',
        'X-Content-Type-Options': 'nosniff',
        'X-Export-Count': String(r.count),
        'X-Export-Snapshot': r.snapshotAt,
        'X-Request-ID': r.requestId,
      })
      .send(r.csv);
  } catch (e) {
    next(e);
  }
});
router.get('/budgets/me', async (req, res, next) => {
  try {
    res.json(await service.budget());
  } catch (e) {
    next(e);
  }
});
module.exports = router;
