'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
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
module.exports = {
  run,
  current,
  fail,
  revision,
  text,
  raw: () => scope.getStore(),
};
