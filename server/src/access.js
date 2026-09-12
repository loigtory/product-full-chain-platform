'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
const internalContexts = new WeakSet();
function internalContext(tenantId, actor) {
  const ctx = { tenantId, actor, role: 'bridge' };
  internalContexts.add(ctx);
  return ctx;
}
function fail(code, status = 409, msg = code) {
  throw Object.assign(new Error(msg), { code, status });
}
function current(write = false) {
  const ctx = scope.getStore();
  if (
    !ctx?.tenantId ||
    !ctx?.actor ||
    !['owner', 'executor', 'viewer', 'bridge'].includes(ctx.role)
  )
    fail('UNAUTHORIZED', 401);
  if (
    ctx.role === 'bridge' ||
    (write && !['owner', 'executor'].includes(ctx.role))
  )
    fail('FORBIDDEN', 403);
  return ctx;
}
function run(ctx, callback) {
  return scope.run(ctx, callback);
}
function revision(row, expected) {
  if (!Number.isInteger(expected))
    fail('REVISION_REQUIRED', 400, '缺少版本基线，请重新读取');
  if (row.revision !== expected)
    fail('REVISION_CONFLICT', 409, '服务端已有更新，保留当前草稿并重新比较');
}
function text(value, max, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    fail('INVALID_INPUT', 400);
  return value.trim();
}
function page(input = {}) {
  const number = (v, fallback, min, max) => {
    if (v === undefined) return fallback;
    if (
      !/^[0-9]+$/.test(String(v)) ||
      !Number.isSafeInteger(Number(v)) ||
      Number(v) < min ||
      Number(v) > max
    )
      fail('INVALID_PAGINATION', 400);
    return Number(v);
  };
  return {
    limit: number(input.limit, 20, 1, 100),
    offset: number(input.offset, 0, 0, 10000),
  };
}
function stage(value) {
  if (
    ![
      'idea',
      'req',
      'design',
      'dev',
      'test',
      'accept',
      'release',
      'observe',
    ].includes(value)
  )
    fail('INVALID_STAGE', 400);
  return value;
}
function safeEndpoint(value, max = 2048) {
  const s = text(value ?? '', max);
  let inspected = s;
  try {
    inspected = decodeURIComponent(s);
  } catch {
    /* Commands may contain literal percent signs. */
  }
  if (
    /\b(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]/i.test(
      inspected,
    ) ||
    /:\/\/[^/\s]*@/.test(inspected)
  )
    fail('CREDENTIALS_NOT_ALLOWED', 400, '连接信息不能包含凭据');
  return s;
}
module.exports = {
  run,
  current,
  fail,
  revision,
  text,
  page,
  stage,
  safeEndpoint,
  raw: () => scope.getStore(),
  internalContext,
  isInternal: (ctx) => internalContexts.has(ctx),
};
