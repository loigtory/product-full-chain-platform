'use strict';
const runtime = require('../runtime');
const groups = [
  'requirement',
  'material',
  'conversation',
  'execution',
  'notification',
];
for (const group of groups) {
  const adapter = require('./' + group + '-service');
  for (const name of new Set([
    ...Object.keys(adapter.memory || {}),
    ...Object.keys(adapter).filter((k) => k !== 'memory'),
  ]))
    if (typeof (adapter[name] || adapter.memory?.[name]) === 'function')
      module.exports[name] = (...args) => {
        const handler = runtime.isPg() ? adapter[name] : adapter.memory?.[name];
        if (!handler) require('../access').fail('CAPABILITY_UNAVAILABLE', 409);
        return handler(...args);
      };
}
