'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

/* POST /api/batch —— 批量变更队列（前端 PFCAPI.api.flush 的提交端点）
 * body: { ops: [{ op: 'set', k, v }, { op: 'remove', k }] }
 * M1 语义：ops 应用到状态树快照（k 为状态树 key，通常是 pfc.state），整体落库。 */
router.post('/', async (req, res, next) => {
  try {
    const ops = req.body?.ops;
    if (!Array.isArray(ops) || !ops.length) {
      return res
        .status(400)
        .json({ error: { code: 'BAD_OPS', msg: 'body.ops 必须是非空数组' } });
    }
    let state = (await db.getState()) || {};
    let applied = 0;
    for (const op of ops) {
      if (op.op === 'set' && typeof op.k === 'string') {
        if (op.k === db.STATE_KEY) state = op.v || {};
        else state[op.k] = op.v;
        applied++;
      } else if (op.op === 'remove' && typeof op.k === 'string') {
        if (op.k === db.STATE_KEY) state = {};
        else delete state[op.k];
        applied++;
      }
    }
    await db.saveState(state);
    res.json({ ok: true, applied, storage: db.storageMode() });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
