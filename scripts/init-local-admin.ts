import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';

import { PostgresIdentityRepository, createDatabase } from '@pfc/persistence';
import { normalizeLoginName } from '@pfc/domain';
import { hashPassword } from '../apps/server/src/identity/security.ts';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`ADMIN_ARGUMENT_REQUIRED name=${name}`);
  return value;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('LOCAL_ADMIN_TARGET_INVALID');
}

const loginName = normalizeLoginName(argument('--login'));
const displayName = argument('--display');
const teamName = argument('--team');
if (displayName.length > 120 || teamName.length > 160) {
  throw new Error('LOCAL_ADMIN_ARGUMENT_INVALID');
}

async function readHiddenPassword(): Promise<string> {
  stdout.write('Local admin password (input hidden): ');
  stdin.setEncoding('utf8');
  const interactive = Boolean(stdin.isTTY && stdin.setRawMode);
  if (interactive) stdin.setRawMode!(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      stdin.off('data', onData);
      if (interactive) stdin.setRawMode!(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          finish();
          reject(new Error('LOCAL_ADMIN_INPUT_CANCELLED'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
        if (interactive) stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

const password = await readHiddenPassword();

const database = createDatabase({ connectionString, maxConnections: 1 });
try {
  const identity = new PostgresIdentityRepository(database, 'pfc');
  if ((await identity.countAccounts()) !== 0) {
    throw new Error('LOCAL_ADMIN_ALREADY_INITIALIZED');
  }
  const derivation = await hashPassword(password);
  const accountId = `account-${randomUUID()}`;
  const teamId = `team-${randomUUID()}`;
  const now = new Date().toISOString();
  await database.transaction().execute(async (transaction) => {
    await transaction
      .withSchema('pfc')
      .insertInto('accounts')
      .values({
        id: accountId,
        login_name: loginName,
        display_name: displayName,
        password_hash: derivation.hash,
        password_salt: derivation.salt,
        status: 'ACTIVE',
        row_version: 0,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await transaction
      .withSchema('pfc')
      .insertInto('teams')
      .values({
        id: teamId,
        name: teamName,
        status: 'ACTIVE',
        owner_account_id: accountId,
        row_version: 0,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await transaction
      .withSchema('pfc')
      .insertInto('team_memberships')
      .values({
        team_id: teamId,
        account_id: accountId,
        role: 'TEAM_ADMIN',
        status: 'ACTIVE',
        joined_at: now,
        created_at: now,
      })
      .execute();
  });
  console.log(
    `LOCAL_ADMIN_INITIALIZED login=${loginName} account=${accountId} team=${teamId}`,
  );
} finally {
  await database.destroy();
}
