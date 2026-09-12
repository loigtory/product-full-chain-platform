import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const derivedKeyLength = 64;

export type PasswordDerivation = Readonly<{
  hash: string;
  salt: string;
}>;

function assertPasswordPolicy(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error('PASSWORD_POLICY_VIOLATION');
  }
}

export async function hashPassword(
  password: string,
): Promise<PasswordDerivation> {
  assertPasswordPolicy(password);
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, derivedKeyLength)) as Buffer;
  return {
    hash: derived.toString('base64url'),
    salt: salt.toString('base64url'),
  };
}

export async function verifyPassword(
  password: string,
  derivation: PasswordDerivation,
): Promise<boolean> {
  if (password.length > 128) return false;
  const expected = Buffer.from(derivation.hash, 'base64url');
  const salt = Buffer.from(derivation.salt, 'base64url');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
