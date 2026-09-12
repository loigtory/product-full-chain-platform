'use strict';
const express = require('express');
const { S, seedFromState } = require('../domain/store');
const router = express.Router();

/* ============ 通知域（M2a：领域存储为权威，事件触发点写入） ============ */

/* GET /api/notices —— 通知列表 + 未读计数 */
router.get('/', async (req, res, next) => {
  try {
    await seedFromState();
    res.json({ items: S.notices, unread: S.notices.filter((n) => !n.read).length });
  } catch (e) {
    next(e);
  }
});

/* POST /api/notices/:id/read —— 单条已读 */
router.post('/:id/read', async (req, res, next) => {
  try {
    await seedFromState();
    const hit = S.notices.find((n) => n.id === req.params.id);
    if (!hit)
      return res.status(404).json({ error: { code: 'NOT_FOUND', msg: '通知不存在' } });
    hit.read = true;
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* POST /api/notices/read-all —— 全部已读 */
router.post('/read-all', async (req, res, next) => {
  try {
    await seedFromState();
    for (const n of S.notices) n.read = true;
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
