'use strict';
const express = require('express');
const { issue, PERMISSIONS } = require('../auth');
const router = express.Router();

/* POST /api/auth/dev-login —— M1 开发账号登录（M3 换 SSO 回调） */
router.post('/dev-login', (req, res) => {
  const name = String(req.body?.name || '').trim() || '陈立';
  const role = req.body?.role === 'viewer' ? 'viewer' : 'owner';
  const user = { name, role };
  res.json({ token: issue(user), user: { ...user, permissions: PERMISSIONS[role] } });
});

/* GET /api/auth/me —— 当前用户 + 权限（需登录） */
const { authMiddleware } = require('../auth');
router.get('/me', authMiddleware, (req, res) => {
  const role = req.user.role || 'owner';
  res.json({
    user: { name: req.user.sub, role, permissions: PERMISSIONS[role] || [] },
  });
});

module.exports = router;
