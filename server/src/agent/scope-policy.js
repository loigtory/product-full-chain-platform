'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const control = require('./exec-control');
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function relativeFile(value) {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !value ||
    Array.from(value).some(
      (c) => c.charCodeAt(0) < 32 || c === '\\' || c === ':',
    ) ||
    path.isAbsolute(value)
  )
    fail('TOOL_PATH_INVALID');
  const parts = value.split('/');
  if (
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        /[. ]$/.test(p) ||
        /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p) ||
        /^(?:\.git|node_modules|\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|\.codex|\.ssh)$/i.test(
          p,
        ),
    )
  )
    fail('TOOL_PATH_INVALID');
  return value;
}
function exactArgs(args, keys) {
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(args, k))
  )
    fail('TOOL_ARGUMENTS_INVALID');
}
function createScope(workspace, inputPlan) {
  const root = control.checkedWorkspace(workspace),
    plan = control.validatePlan({ control: inputPlan });
  const before = control.scanWorkspace(root, plan.maxFiles, plan.maxBytes),
    owned = new Map();
  let expected = control.baselineHash(before),
    closed = false;
  if (plan.baselineHash !== expected) fail('PLAN_BASELINE_CHANGED');
  function check() {
    if (closed) fail('TURN_CANCELLED');
    control.validatePlan({ control: plan });
    const current = control.scanWorkspace(root, plan.maxFiles, plan.maxBytes);
    if (control.baselineHash(current) !== expected)
      fail('PLAN_BASELINE_CHANGED');
    return current;
  }
  function inspect(tool, args) {
    const write = tool === 'pfc_write_file';
    if (!write && tool !== 'pfc_read_file') fail('TOOL_NOT_ALLOWED');
    exactArgs(args, write ? ['path', 'content', 'expectedHash'] : ['path']);
    const rel = relativeFile(args.path);
    const current = check();
    if (
      plan.forbidden.some((p) => control.matchGlob(p, rel)) ||
      !plan.allowedFiles.some((p) => control.matchGlob(p, rel)) ||
      (write && plan.mode === 'readonly')
    )
      fail('TOOL_OUT_OF_SCOPE');
    const previous = current.get(rel);
    if (write) {
      if (
        typeof args.content !== 'string' ||
        Buffer.byteLength(args.content) > plan.maxBytes ||
        (args.expectedHash !== null &&
          !/^[a-f0-9]{64}$/.test(args.expectedHash))
      )
        fail('TOOL_ARGUMENTS_INVALID');
      if ((previous?.sha256 ?? null) !== args.expectedHash)
        fail('FILE_BASELINE_CHANGED');
      const bytes =
        [...current.values()].reduce((n, f) => n + f.size, 0) -
        (previous?.size ?? 0) +
        Buffer.byteLength(args.content);
      if (
        current.size + (previous ? 0 : 1) > plan.maxFiles ||
        bytes > plan.maxBytes
      )
        fail('PLAN_BASELINE_TOO_LARGE');
    } else if (!previous) fail('FILE_NOT_FOUND');
    return { rel, previous, current, write };
  }
  function read(args) {
    const { previous, rel } = inspect('pfc_read_file', args);
    if (previous.content.includes(0)) fail('FILE_ENCODING_UNSUPPORTED');
    const text = previous.content.toString('utf8');
    if (!Buffer.from(text).equals(previous.content))
      fail('FILE_ENCODING_UNSUPPORTED');
    return { path: rel, sha256: previous.sha256, content: text };
  }
  function write(args) {
    const { rel, previous } = inspect('pfc_write_file', args),
      full = path.join(root, ...rel.split('/'));
    // There is no async yield between the last complete-tree check and file access.
    // Refuse links/hardlinks and compare the opened file identity before truncation.
    require('../local/profile').noLinks(full);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const fd = fs.openSync(full, previous ? 'r+' : 'wx');
    try {
      const stat = fs.fstatSync(fd),
        atPath = fs.lstatSync(full);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        atPath.isSymbolicLink() ||
        stat.ino !== atPath.ino ||
        stat.dev !== atPath.dev
      )
        fail('WORKSPACE_LINK_DENIED');
      if (previous && hash(fs.readFileSync(fd)) !== previous.sha256)
        fail('FILE_BASELINE_CHANGED');
      const bytes = Buffer.from(args.content);
      let offset = 0;
      while (offset < bytes.length)
        offset += fs.writeSync(
          fd,
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
      fs.ftruncateSync(fd, bytes.length);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const after = control.scanWorkspace(root, plan.maxFiles, plan.maxBytes);
    const currentHash = after.get(rel)?.sha256;
    owned.set(rel, hash(args.content));
    if (currentHash !== owned.get(rel)) fail('FILE_WRITE_UNVERIFIED');
    expected = control.baselineHash(after);
    return {
      path: rel,
      sha256: currentHash,
      bytes: Buffer.byteLength(args.content),
    };
  }
  return {
    root,
    plan,
    inspect,
    read,
    write,
    check,
    stop() {
      closed = true;
    },
    diff: () => control.reviewDiff(plan, root, before),
    rollback() {
      const result = control.revert(root, before, owned);
      expected = control.baselineHash(control.scanWorkspace(root));
      owned.clear();
      return result;
    },
    fingerprint: () => expected,
  };
}
module.exports = { createScope, relativeFile, exactArgs };
