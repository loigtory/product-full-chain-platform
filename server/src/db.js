'use strict';
// Legacy whole-state storage exists only in explicit memory mode.
const runtime = require('./runtime');
const STATE_KEY = 'pfc.state',
  mem = new Map();
async function connect() {
  await runtime.start();
}
async function getState() {
  return runtime.isPg() ? null : mem.get(STATE_KEY) || null;
}
async function saveState(value) {
  if (runtime.isPg()) require('./access').fail('DOMAIN_WRITE_REQUIRED', 409);
  mem.set(STATE_KEY, JSON.parse(JSON.stringify(value)));
}
async function removeState() {
  if (runtime.isPg()) require('./access').fail('DOMAIN_WRITE_REQUIRED', 409);
  mem.delete(STATE_KEY);
}
function storageMode() {
  return runtime.isPg() ? 'pg' : 'memory';
}
module.exports = {
  connect,
  getState,
  saveState,
  removeState,
  storageMode,
  STATE_KEY,
};
