'use strict';
const fs = require('node:fs/promises');
const {
  resolve,
  relative,
  isAbsolute,
  basename,
  extname,
} = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { fail } = require('../access');
const runtime = require('../runtime');
const extensions = new Set([
  '.txt',
  '.md',
  '.pdf',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.csv',
  '.xlsx',
  '.json',
]);
let active = 0;
function pathFor(tenantId, hash) {
  if (!/^[a-f0-9-]{36}$/.test(tenantId) || !/^[a-f0-9]{64}$/.test(hash))
    fail('INVALID_FILE_REFERENCE', 400);
  const root = runtime.config().filesRoot,
    path = resolve(root, tenantId, hash),
    rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel))
    fail('INVALID_FILE_REFERENCE', 400);
  return path;
}
function decode(file) {
  if (
    !file ||
    file.encoding !== 'base64' ||
    typeof file.content !== 'string' ||
    typeof file.name !== 'string' ||
    !file.name ||
    file.name !== basename(file.name) ||
    /[\\/:]/.test(file.name) ||
    !extensions.has(extname(file.name).toLowerCase())
  )
    fail('INVALID_FILE', 400);
  if (file.content.length > 13981016) fail('FILE_TOO_LARGE', 413);
  const bytes = Buffer.from(file.content, 'base64');
  if (bytes.length > 10485760) fail('FILE_TOO_LARGE', 413);
  if (bytes.toString('base64') !== file.content) fail('INVALID_FILE', 400);
  return {
    bytes,
    size: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex'),
    name: file.name,
    mimeType:
      typeof file.mimeType === 'string'
        ? file.mimeType.slice(0, 120)
        : 'application/octet-stream',
  };
}
async function save(tenantId, decoded) {
  if (active >= 2) fail('UPLOAD_BUSY', 429);
  active++;
  const path = pathFor(tenantId, decoded.hash),
    directory = resolve(path, '..'),
    temp = path + '.' + randomUUID() + '.tmp';
  let created = false;
  try {
    if ((await fs.lstat(runtime.config().filesRoot)).isSymbolicLink())
      fail('INVALID_FILE_REFERENCE', 400);
    await fs.mkdir(directory, { recursive: true });
    // Test roots are owned and never contain links. Refuse symlink/junction redirection.
    if ((await fs.lstat(directory)).isSymbolicLink())
      fail('INVALID_FILE_REFERENCE', 400);
    try {
      const existing = await fs.readFile(path);
      if (createHash('sha256').update(existing).digest('hex') !== decoded.hash)
        fail('FILE_CORRUPT', 503);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      await fs.writeFile(temp, decoded.bytes, { flag: 'wx' });
      await fs.rename(temp, path);
      created = true;
    }
    return {
      hash: decoded.hash,
      size: decoded.size,
      ref: tenantId + '/' + decoded.hash,
      created,
      path,
    };
  } catch (e) {
    await fs.unlink(temp).catch(() => {});
    if (e.status) throw e;
    fail('FILE_STORAGE_UNAVAILABLE', 503);
  } finally {
    active--;
  }
}
async function read(tenantId, hash) {
  try {
    const path = pathFor(tenantId, hash);
    if ((await fs.lstat(path)).isSymbolicLink())
      fail('INVALID_FILE_REFERENCE', 400);
    const bytes = await fs.readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      fail('FILE_CORRUPT', 503);
    return bytes;
  } catch (e) {
    if (e.status) throw e;
    fail('FILE_UNAVAILABLE', 503);
  }
}
async function rollback(client, db, ctx, stored) {
  if (!stored.created) return;
  // ROLLBACK released the upload lock. Reacquire it before checking ownership so
  // another request cannot adopt the same hash between the check and unlink.
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      ctx.tenantId + ':files',
    ]);
    const refs = await client.query(
      `SELECT 1 FROM "${db.schema}".file_objects WHERE tenant_id=$1 AND hash=$2`,
      [ctx.tenantId, stored.hash],
    );
    if (!refs.rowCount && stored.path === pathFor(ctx.tenantId, stored.hash))
      await fs.unlink(stored.path).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}
module.exports = { decode, save, read, rollback, pathFor };
