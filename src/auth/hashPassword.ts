/**
 * Offline CLI — generates a scrypt password hash to paste into
 * AUTH_PASSWORD_HASH / UAT_AUTH_PASSWORD_HASH.
 *
 * Usage: npm run hash-password -- "yourPassword"
 */

import { hashPassword } from '@auth/password';

const plainPassword = process.argv[2];

if (!plainPassword) {
  console.error('Usage: npm run hash-password -- "yourPassword"');
  process.exit(1);
}

console.log(hashPassword(plainPassword));
