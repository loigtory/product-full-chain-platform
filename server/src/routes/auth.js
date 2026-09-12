'use strict';
const express = require('express');
const { issue, PERMISSIONS } = require('../auth');
const router = express.Router();

/* POST /api/auth/dev-login —— M1 开发账号登录（M3 换 SSO 回调） */
router.post('/dev-login', (req, res) => {
  const name = String(req.body?.name || '').trim() || '陈立';
  if (require('../runtime').isPg()) {
    const configured = require('../runtime')
      .config()
      .users.find((u) => u.name === name);
    if (!configured)
      return res
        .status(403)
        .json({ error: { code: 'UNKNOWN_LOCAL_USER', msg: '本地账号未配置' } });
    return res.json({
      token: issue(configured),
      user: {
        name: configured.name,
        role: configured.role,
        permissions: PERMISSIONS[configured.role],
      },
    });
  }
  const role = req.body?.role === 'viewer' ? 'viewer' : 'owner';
  const user = { name, role };
  res.json({
    token: issue(user),
    user: { ...user, permissions: PERMISSIONS[role] },
  });
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
