'use strict';
const express = require('express');
const svc = require('../domain/service');
const router = express.Router();

/* ============ 租约（控制端切换，原子冲突返回持有者） ============ */

/* POST /api/leases/acquire —— 抢占设备租约 */
router.post('/acquire', async (req, res, next) => {
  try {
    const r = await svc.acquireLease({
      runId: req.body?.runId,
      controller: req.body?.controller,
      bridgeId: req.body?.bridgeId,
    });
    if (r.error === 'LEASE_HELD')
      return res.status(409).json({ error: { code: 'LEASE_HELD', msg: '已被 ' + r.lease.deviceName + ' 持有' }, lease: r.lease });
    res.json({ lease: r.lease });
  } catch (e) {
    next(e);
  }
});

/* POST /api/leases/handoff —— 控制转移（Web ↔ Agent） */
router.post('/handoff', async (req, res, next) => {
  try {
    const r = await svc.handoffLease({ runId: req.body?.runId, to: req.body?.to });
    res.json({ lease: r.lease });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
