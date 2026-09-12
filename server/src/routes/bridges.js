'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const ws = require('../ws');
const router = express.Router();

/* ============ Bridge 协议（M2b：配对 + 心跳 + 状态） ============ */
const SECRET = process.env.JWT_SECRET || 'pfc-dev-secret-change-me';

/* POST /api/bridges/pair —— 配对码换 bridge_token（配对码哈希校验后置空）
 * M2b 简化：直接以配对码为身份签发 bridge_token（真实实现：一次性配对码 → 设备注册） */
router.post('/pair', (req, res) => {
  const name = String(req.body?.name || '').trim() || '本地 Bridge';
  const bridgeId = 'BR-' + Date.now().toString(36);
  const token = jwt.sign({ sub: bridgeId, name, role: 'bridge' }, SECRET, { expiresIn: '12h' });
  res.json({ bridgeId, bridgeToken: token, pairCode: bridgeId, name, expiresIn: '12h' });
});

/* POST /api/bridges/heartbeat —— REST 备选心跳（主要走 WS heartbeat） */
router.post('/heartbeat', (req, res) => {
  const bridgeId = req.body?.bridgeId;
  if (!bridgeId) return res.status(400).json({ error: { code: 'BAD_REQUEST', msg: 'bridgeId 必填' } });
  res.json({ ok: true, at: new Date().toISOString() });
});

/* GET /api/bridges —— Bridge 列表（工作台 Bridge 状态页） */
router.get('/', (req, res) => {
  res.json({ items: ws.bridgeList() });
});

module.exports = router;
