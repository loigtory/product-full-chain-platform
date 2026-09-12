'use strict';
/* =====================================================================
 * 鉴权：M1 开发登录（dev-login 签发 JWT）+ 中间件
 * M3 由 SSO/SCIM 替换身份源（见《12-正式平台服务端设计蓝图》第五节）。
 * ===================================================================== */
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'pfc-dev-secret-change-me';
const EXPIRES = '12h';

/* M1 角色权限集：对齐原型角色矩阵（owner / executor / viewer） */
const PERMISSIONS = {
  owner: ['run.control', 'run.approve', 'release.approve', 'release.execute', 'gov.configure', 'knowledge.write'],
  executor: ['run.control', 'run.approve', 'knowledge.write'],
  viewer: [],
};

function issue(user) {
  return jwt.sign(
    { sub: user.name, role: user.role || 'owner', tenant: 'pfc-dev' },
    SECRET,
    { expiresIn: EXPIRES },
  );
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', msg: '缺少 Bearer token' } });
  }
  try {
    req.user = jwt.verify(h.slice(7), SECRET);
    return next();
  } catch {
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', msg: 'token 无效或已过期' } });
  }
}

module.exports = { issue, authMiddleware, PERMISSIONS };
