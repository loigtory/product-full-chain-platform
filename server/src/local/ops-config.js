'use strict';
const fs = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');
const { layout, repo, read, fault, noLinks } = require('./profile');
const { validateTarget } = require('../persistence/connection');
function connection(target) {
  let url;
  try {
    if (target.scope === 'restore') {
      const p = resolve(target.root, 'pg-connection.json');
      noLinks(p);
      url = require('./ops-files').readJson(p).connectionString;
    } else
      url = parseEnv(
        fs.readFileSync(resolve(repo, '.env.local'), 'utf8'),
      ).DATABASE_URL;
  } catch {
    throw fault('PG_CONFIG_REQUIRED');
  }
  const options = {
    mode: 'pg',
    connectionString: url,
    schema: target.schema,
    authorizedSchema: target.schema,
    targetVersion: '006',
  };
  const validated = validateTarget(options);
  if (validated.pg.port !== target.dbPort)
    throw fault('LOCAL_TARGET_NOT_AUTHORIZED');
  return { options, pg: validated.pg };
}
function environment(p) {
  const { options } = connection(p);
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^PFC_|^PG|^DATABASE_URL$|^JWT_SECRET$|^PORT$/.test(key),
      ),
    ),
    PFC_DB: 'pg',
    DATABASE_URL: options.connectionString,
    PFC_DB_SCHEMA: p.schema,
    PFC_AUTHORIZED_SCHEMA: p.schema,
    PFC_LOCAL_PROFILE_FILE: p.profileFile,
    PFC_LOCAL_USERS_FILE: p.usersFile,
    PFC_FILES_ROOT: p.filesRoot,
    PFC_FILE_QUOTA_BYTES: '104857600',
    JWT_SECRET: p.jwtSecret,
    PORT: String(p.apiPort),
  };
}
function runtimeTarget(p) {
  const expected = environment(p);
  for (const key of [
    'PFC_DB',
    'DATABASE_URL',
    'PFC_DB_SCHEMA',
    'PFC_AUTHORIZED_SCHEMA',
    'PFC_LOCAL_USERS_FILE',
    'PFC_FILES_ROOT',
    'PFC_FILE_QUOTA_BYTES',
    'JWT_SECRET',
    'PORT',
  ])
    if (process.env[key] !== expected[key])
      throw fault('LOCAL_RUNTIME_TARGET_MISMATCH');
  require('./ops-files').assertPrivate(p.root);
  require('./ops-files').assertPrivate(p.profileFile);
  return p;
}
function targetFromArgs(args) {
  if (!args.length) return layout();
  if (args.length !== 2 || args[0] !== '--profile')
    throw fault('LOCAL_ARGUMENTS_INVALID', 400);
  return read(args[1], false);
}
module.exports = { connection, environment, runtimeTarget, targetFromArgs };
