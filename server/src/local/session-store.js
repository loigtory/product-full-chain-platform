'use strict';
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { fault } = require('./profile');
const derive = promisify(scrypt);
const cookieName = 'pfc_local_session';
async function createVerifier(key, salt = randomBytes(16).toString('hex')) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key || '') || !/^[a-f0-9]{32}$/.test(salt))
    throw fault('LOCAL_KEY_INVALID', 400);
  const digest = (await derive(key, salt, 32)).toString('hex');
  return { salt, digest };
}
function cookieId(header = '') {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const values = header
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.startsWith(cookieName + '='));
  if (values.length !== 1) return null;
  const id = values[0].slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : null;
}
function createStore({ verifier, identity, now = Date.now }) {
  const sessions = new Map();
  let windowStart = now(),
    failures = 0,
    busy = false,
    closed = false;
  function remove(id) {
    const s = sessions.get(id);
    sessions.delete(id);
    for (const close of s?.sockets || []) {
      try {
        close();
      } catch {}
    }
  }
  function get(id, touch = false) {
    const s = sessions.get(id);
    if (!s) return null;
    if (now() - s.created >= 8 * 3600000 || now() - s.last >= 30 * 60000) {
      remove(id);
      return null;
    }
    if (touch) s.last = now();
    return s;
  }
  function sweep() {
    for (const id of sessions.keys()) get(id);
  }
  return {
    get,
    remove,
    sweep,
    attach(id, close) {
      const s = get(id);
      if (!s) {
        close();
        return () => {};
      }
      s.sockets.add(close);
      return () => s.sockets.delete(close);
    },
    async login(key) {
      if (closed) throw fault('LOCAL_SESSION_CLOSED');
      if (now() - windowStart >= 60000) {
        windowStart = now();
        failures = 0;
      }
      if (failures >= 5) throw fault('LOGIN_RATE_LIMIT', 429);
      if (busy) throw fault('LOGIN_BUSY', 429);
      sweep();
      if (sessions.size >= 4) throw fault('SESSION_LIMIT', 429);
      busy = true;
      try {
        const valid =
          typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key);
        const digest = await derive(valid ? key : 'invalid', verifier.salt, 32);
        if (closed) throw fault('LOCAL_SESSION_CLOSED');
        if (
          !valid ||
          !timingSafeEqual(digest, Buffer.from(verifier.digest, 'hex'))
        ) {
          failures++;
          throw fault('LOCAL_LOGIN_FAILED', 401);
        }
        const id = randomBytes(32).toString('base64url');
        const s = {
          id,
          created: now(),
          last: now(),
          sockets: new Set(),
          claims: {
            sub: identity.name,
            role: identity.role,
            tenant: identity.tenantId,
            exp: Math.floor((now() + 8 * 3600000) / 1000),
          },
        };
        sessions.set(id, s);
        return s;
      } finally {
        busy = false;
      }
    },
    close() {
      closed = true;
      for (const id of sessions.keys()) remove(id);
    },
  };
}
let live;
function current() {
  if (!live) {
    const p = require('./profile').current();
    if (!p) return null;
    live = createStore({
      verifier: p.verifier,
      identity: { name: p.ownerName, role: 'owner', tenantId: p.tenantId },
    });
  }
  return live;
}
module.exports = { createVerifier, createStore, cookieId, cookieName, current };
