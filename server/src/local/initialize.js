'use strict';
const fs = require('node:fs');
const { resolve } = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { read, layout, fault, prefix } = require('./profile');
const { preflight, metadata } = require('./preflight');
const { connection } = require('./ops-config');
const { privateDirectory, atomicJson, assertPrivate } = require('./ops-files');
const { acquire } = require('./workspace-lock');
const { openDatabase } = require('../persistence/connection');
const { withTransaction } = require('../persistence/transaction');
const { migrate } = require('../persistence/migrations');
const { createVerifier } = require('./session-store');
async function initialize(target = layout(), { failAfter } = {}) {
  if (target.scope === 'restore' || (failAfter && target.scope === 'personal'))
    throw fault('LOCAL_OPERATION_FORBIDDEN');
  let lock, db;
  try {
    lock = await acquire(target);
    let p;
    if (fs.existsSync(target.profileFile)) {
      p = read(target.profileFile, false);
      assertPrivate(p.root);
      if (p.state === 'READY') {
        const result = await preflight(p);
        if (result.status !== 'READY')
          throw fault(result.code || 'LOCAL_PROFILE_INVALID');
        return { status: 'ALREADY_INITIALIZED', schemaVersion: '006' };
      }
    } else {
      const before = await preflight(target);
      if (before.status !== 'INITIALIZATION_REQUIRED')
        throw fault(before.code || 'LOCAL_TARGET_EXISTS');
      privateDirectory(target.root);
      const key = randomBytes(32).toString('base64url');
      const attemptId = randomUUID();
      p = {
        format: 1,
        scope: target.scope,
        runId: target.runId,
        attemptId,
        state: 'PREPARED',
        tenantId: randomUUID(),
        memberId: randomUUID(),
        ownerName: target.scope === 'personal' ? '陈立' : prefix + '_owner',
        verifier: await createVerifier(key),
        jwtSecret: randomBytes(32).toString('base64url'),
        marker:
          target.scope === 'personal'
            ? 'PFC_WORKBENCH_M2C_002'
            : prefix + ':' + attemptId,
      };
      fs.writeFileSync(resolve(target.root, 'access-key.txt'), key, {
        flag: 'wx',
      });
      assertPrivate(resolve(target.root, 'access-key.txt'));
      atomicJson(target.profileFile, p);
      p = read(target.profileFile, false);
    }
    const save = (state, extra = {}) => {
      p = { ...p, ...extra, state };
      // Only configuration facts are stored; canonical paths are recomputed by profile.read.
      const stored = Object.fromEntries(
        [
          'format',
          'scope',
          'runId',
          'attemptId',
          'state',
          'tenantId',
          'memberId',
          'ownerName',
          'verifier',
          'jwtSecret',
          'marker',
          'ownedOid',
        ]
          .filter((k) => p[k] !== undefined)
          .map((k) => [k, p[k]]),
      );
      atomicJson(p.profileFile, stored);
    };
    let row = await metadata(p);
    db = await openDatabase({ ...connection(p).options, requireReady: false });
    if (!row) {
      if (p.ownedOid || p.state !== 'PREPARED')
        throw fault('LOCAL_OWNERSHIP_MISMATCH');
      await withTransaction(db, async (c) => {
        await c.query('CREATE SCHEMA "' + p.schema + '"');
        await c.query(
          'COMMENT ON SCHEMA "' + p.schema + '" IS \'' + p.marker + "'",
        );
      });
      row = await metadata(p);
    }
    if (
      !row?.owned ||
      row.marker !== p.marker ||
      (p.ownedOid && p.ownedOid !== row.oid)
    )
      throw fault('LOCAL_OWNERSHIP_MISMATCH');
    save('SCHEMA_CREATED', { ownedOid: row.oid });
    if (failAfter === 'schema')
      throw fault('SYNTHETIC_INITIALIZATION_INTERRUPTED');
    await migrate(db, { targetVersion: '006' });
    save('MIGRATED');
    if (failAfter === 'migration')
      throw fault('SYNTHETIC_INITIALIZATION_INTERRUPTED');
    await withTransaction(db, async (c) => {
      const tenants = (
        await c.query('SELECT id,name FROM "' + p.schema + '".tenants')
      ).rows;
      const tenantName =
        p.scope === 'personal' ? '陈立的工作空间' : prefix + '_workspace';
      if (tenants.some((r) => r.id !== p.tenantId || r.name !== tenantName))
        throw fault('LOCAL_INITIAL_DATA_MISMATCH');
      if (!tenants.length)
        await c.query(
          'INSERT INTO "' + p.schema + '".tenants(id,name) VALUES($1,$2)',
          [p.tenantId, tenantName],
        );
      const members = (
        await c.query('SELECT * FROM "' + p.schema + '".members')
      ).rows;
      if (
        members.some(
          (r) =>
            r.id !== p.memberId ||
            r.tenant_id !== p.tenantId ||
            r.name !== p.ownerName ||
            r.role !== 'owner' ||
            !r.active,
        )
      )
        throw fault('LOCAL_INITIAL_DATA_MISMATCH');
      if (!members.length)
        await c.query(
          'INSERT INTO "' +
            p.schema +
            '".members(id,tenant_id,public_id,name,role) VALUES($1,$2,$3,$4,$5)',
          [p.memberId, p.tenantId, 'M-1', p.ownerName, 'owner'],
        );
    });
    save('OWNER_CREATED');
    if (failAfter === 'owner')
      throw fault('SYNTHETIC_INITIALIZATION_INTERRUPTED');
    privateDirectory(p.filesRoot);
    atomicJson(p.usersFile, [
      { name: p.ownerName, tenantId: p.tenantId, role: 'owner' },
    ]);
    save('READY');
    const final = await preflight(read(p.profileFile));
    if (final.status !== 'READY')
      throw fault(final.code || 'INITIALIZATION_INCOMPLETE');
    return {
      status: 'INITIALIZED',
      schemaVersion: '006',
      tenants: 1,
      owners: 1,
      requirements: 0,
      attemptId: p.attemptId,
    };
  } finally {
    await db?.close();
    await lock?.release();
  }
}
module.exports = { initialize };
