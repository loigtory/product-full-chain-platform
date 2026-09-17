'use strict';
const fs = require('node:fs');
const net = require('node:net');
const { Pool } = require('pg');
const { repo, layout, read, noLinks, fault } = require('./profile');
const { connection } = require('./ops-config');
const { openDatabase } = require('../persistence/connection');
async function portFree(port) {
  // A connection probe observes listeners without binding or stopping a port.
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (e) => {
      socket.destroy();
      e.code === 'ECONNREFUSED'
        ? resolve(true)
        : reject(fault('PORT_CHECK_FAILED'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(fault('PORT_CHECK_FAILED'));
    });
  });
}
async function metadata(target) {
  const { pg } = connection(target);
  const pool = new Pool({
    ...pg,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  try {
    const c = await pool.connect();
    try {
      await c.query('BEGIN READ ONLY');
      const identity = (
        await c.query(
          "SELECT current_database() db,current_user role,current_setting('listen_addresses') listen,current_setting('server_version_num')::int version,inet_server_port() port",
        )
      ).rows[0];
      if (
        identity.db !== 'pfc_local' ||
        identity.role !== 'pfc_app_local' ||
        identity.listen !== '127.0.0.1' ||
        identity.version < 180000 ||
        identity.version >= 190000 ||
        identity.port !== target.dbPort
      )
        throw fault('PG_TARGET_NOT_AUTHORIZED');
      const row = (
        await c.query(
          "SELECT oid,nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) owned,obj_description(oid,'pg_namespace') marker FROM pg_namespace WHERE nspname=$1",
          [target.schema],
        )
      ).rows[0];
      await c.query('ROLLBACK');
      return row || null;
    } finally {
      c.release();
    }
  } finally {
    await pool.end();
  }
}
async function preflight(target = layout()) {
  let db;
  try {
    if (!process.versions.node.startsWith('24.'))
      throw fault('NODE24_REQUIRED');
    for (const name of ['express', 'ws', 'pg', 'jsonwebtoken'])
      require.resolve(name);
    for (const name of ['pg_dump', 'pg_restore', 'pg_ctl', 'initdb'])
      if (
        !fs.existsSync(
          require('node:path').resolve(
            repo,
            '.tools/postgresql-18.6/bin',
            name + '.exe',
          ),
        )
      )
        throw fault('PG_TOOL_MISSING');
    for (const p of [target.root, target.filesRoot, target.backupsRoot])
      noLinks(p);
    const disk = fs.statfsSync(repo);
    if (disk.bavail * disk.bsize < 3 * 1073741824)
      throw fault('LOCAL_DISK_SPACE_REQUIRED');
    const row = await metadata(target);
    if (!fs.existsSync(target.profileFile)) {
      if (row || fs.existsSync(target.root) || fs.existsSync(target.filesRoot))
        throw fault('LOCAL_TARGET_EXISTS');
      return {
        status: 'INITIALIZATION_REQUIRED',
        schemaExists: false,
        fileRootExists: false,
        apiPortFree: await portFree(target.apiPort),
      };
    }
    const p = read(target.profileFile, false);
    if (p.state !== 'READY')
      return { status: 'INITIALIZATION_INCOMPLETE', phase: p.state };
    if (!row || !row.owned || row.oid !== p.ownedOid || row.marker !== p.marker)
      throw fault('LOCAL_OWNERSHIP_MISMATCH');
    require('./ops-files').assertPrivate(p.root);
    require('./ops-files').assertPrivate(p.profileFile);
    if (!fs.existsSync(p.filesRoot) || !fs.lstatSync(p.filesRoot).isDirectory())
      throw fault('FILES_ROOT_REQUIRED');
    db = await openDatabase(connection(p).options);
    const users = require('./ops-files').readJson(p.usersFile);
    if (
      !Array.isArray(users) ||
      users.length !== 1 ||
      users[0].name !== p.ownerName ||
      users[0].tenantId !== p.tenantId ||
      users[0].role !== 'owner'
    )
      throw fault('LOCAL_USERS_CONFIG_REQUIRED');
    await require('../domain/membership-policy').assertOwners(db, users);
    return {
      status: 'READY',
      schemaVersion: db.targetVersion,
      mode: 'personal',
      apiPortFree: await portFree(p.apiPort),
    };
  } catch (e) {
    return {
      status: 'BLOCKED',
      code: /^[A-Z_0-9]+$/.test(e.code || '')
        ? e.code
        : 'LOCAL_PREFLIGHT_FAILED',
    };
  } finally {
    await db?.close();
  }
}
async function statusInfo(p) {
  const db = require('../runtime').db();
  const rows = (
    await db.pool.query(
      'SELECT file_ref path,size::int,hash sha256 FROM "' +
        db.schema +
        '".file_objects ORDER BY file_ref',
    )
  ).rows;
  let files;
  try {
    const result = require('./backup').filesMatch(p.filesRoot, rows);
    files = {
      readable: true,
      count: result.files.length,
      bytes: result.bytes,
      quota: 104857600,
    };
  } catch {
    files = { readable: false, code: 'FILES_UNAVAILABLE', quota: 104857600 };
  }
  const lastBackup = require('./backup').latest(p);
  const instance = require('./ops-files').readJson(p.instanceFile);
  return {
    storage: 'pg',
    schemaVersion: '006',
    sourceCommit: instance.sourceCommit,
    sourceDirty: instance.sourceDirty,
    files,
    lastBackup,
    realTools: false,
  };
}
module.exports = { preflight, metadata, portFree, statusInfo };
