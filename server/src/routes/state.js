'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

/* GET /api/state —— 读取整棵状态树（前端 api 模式首次加载）
 * 首次返回 { state: null }，由前端用原型工厂生成种子并 PUT 提交（诚实标注：种子来源=前端工厂）。 */
router.get('/', async (req, res, next) => {
  try {
    const state = await db.getState();
    res.json({
      state,
      storage: db.storageMode(),
      domainPersistence: db.storageMode() === 'pg',
    });
  } catch (e) {
    next(e);
  }
});

/* PUT /api/state —— 全量保存状态树（M1 桥接：前端 flush 的最终落点之一） */
router.put('/', async (req, res, next) => {
  try {
    const state = req.body?.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res
        .status(400)
        .json({ error: { code: 'BAD_STATE', msg: 'body.state 必须是对象' } });
    }
    const revision = Number(req.body?.revision || 0) || 0;
    await db.saveState(state, revision);
    res.json({ ok: true, revision, storage: db.storageMode() });
  } catch (e) {
    next(e);
  }
});

/* DELETE /api/state —— 重置（对齐原型 reset） */
router.delete('/', async (req, res, next) => {
  try {
    await db.removeState();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
