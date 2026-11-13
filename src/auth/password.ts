/**
 * Password Hashing — scrypt (Node built-in crypto, no extra dependency)
 *
 * Hash format stored in AUTH_PASSWORD_HASH: "{saltHex}:{derivedKeyHex}"
 */

import crypto from 'crypto';

const KEY_LENGTH = 64;

/** Hashes a plaintext password. Use this offline to produce AUTH_PASSWORD_HASH. */
export function hashPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(plainPassword, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/** Verifies a plaintext password against a stored "salt:hash" string. */
export function verifyPassword(plainPassword: string, storedHash: string): boolean {
  if (!plainPassword || !storedHash) return false;

  const [salt, hashHex] = storedHash.split(':');
  if (!salt || !hashHex) return false;

  const derivedKey = crypto.scryptSync(plainPassword, salt, KEY_LENGTH);
  const stored = Buffer.from(hashHex, 'hex');

  if (stored.length !== derivedKey.length) return false;

  return crypto.timingSafeEqual(stored, derivedKey);
}
