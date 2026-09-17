'use strict';
const { randomUUID } = require('node:crypto');
const fault = (code) => Object.assign(new Error(code), { code });

// A stop request is distinct from evidence that the owned process exited.
function createControl() {
  let session = null,
    stopping = null,
    resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const control = {
    ownerId: randomUUID(),
    reason: null,
    exitConfirmed: false,
    done,
    attach(value) {
      session = value;
      if (control.reason) void control.stop(control.reason);
    },
    check() {
      if (control.reason) throw fault(control.reason);
    },
    async stop(reason = 'TURN_CANCELLED') {
      control.reason ??= reason;
      if (!session) return;
      if (!stopping)
        stopping = Promise.resolve()
          .then(() => session.close())
          .then((result) => {
            control.exitConfirmed = result?.childExited === true;
            return result;
          })
          .catch(() => {
            control.exitConfirmed = false;
          });
      return stopping;
    },
    terminalState(code = control.reason) {
      if (control.reason && session && !control.exitConfirmed) return 'UNKNOWN';
      if (code === 'TURN_CANCELLED') return 'CANCELLED';
      if (code === 'TURN_TIMED_OUT') return 'TIMED_OUT';
      if (
        [
          'AGENT_LEASE_LOST',
          'TURN_CONNECTION_LOST',
          'PROCESS_EXIT_UNCONFIRMED',
          'TOOL_EFFECT_UNCONFIRMED',
        ].includes(code)
      )
        return 'UNKNOWN';
      return 'FAILED';
    },
    complete(result) {
      resolveDone(result);
    },
  };
  return control;
}
module.exports = { createControl };
