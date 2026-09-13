'use strict';
const { fault } = require('./profile');
function checkRequest(req, profile, websocket = false) {
  const h = req.headers || {},
    host = '127.0.0.1:' + profile.apiPort,
    origin = 'http://' + host;
  if (h.host !== host || (h.origin !== undefined && h.origin !== origin))
    throw fault('LOCAL_ORIGIN_REQUIRED', 403);
  if (websocket) {
    if (h.origin !== origin || req.url !== '/ws/web')
      throw fault('LOCAL_WEBSOCKET_FORBIDDEN', 403);
  } else if (!['GET', 'HEAD'].includes(req.method)) {
    if (
      h.origin !== origin ||
      !/^application\/json(?:\s*;|$)/i.test(h['content-type'] || '')
    )
      throw fault('LOCAL_ORIGIN_REQUIRED', 403);
  }
  if (
    h['sec-fetch-site'] &&
    !['same-origin', 'none'].includes(h['sec-fetch-site'])
  )
    throw fault('LOCAL_ORIGIN_REQUIRED', 403);
}
function middleware(req, res, next) {
  const profile = require('./profile').current();
  if (!profile) return next();
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  try {
    checkRequest(req, profile);
    next();
  } catch (e) {
    next(e);
  }
}
module.exports = { checkRequest, middleware };
