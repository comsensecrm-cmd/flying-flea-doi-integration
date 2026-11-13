/**
 * Credential Validation for POST /api/optIn/Auth
 *
 * The same running process accepts two independent credential sets — prod and
 * UAT (see config.auth.prod / config.auth.uat) — each with its own username,
 * password hash, and HMAC secret key. verifyCredentials() reports which set
 * matched so the route can sign the token with that environment's own secret.
 */

import config from '@config/env';
import { verifyPassword } from '@auth/password';

export type AuthEnvironment = 'prod' | 'uat';

export interface CredentialsInput {
  username?: unknown;
  password?: unknown;
}

export interface RequestValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validates request body shape — both fields present and non-empty strings. */
export function validateCredentialsRequest(body: CredentialsInput): RequestValidationResult {
  const errors: string[] = [];

  if (typeof body?.username !== 'string' || body.username.trim() === '') {
    errors.push('username is required and must be a non-empty string');
  }

  if (typeof body?.password !== 'string' || body.password.trim() === '') {
    errors.push('password is required and must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Checks username + password against both configured credential sets
 * (prod, then UAT). Returns the matching environment, or null if neither
 * matches (including when a set is not configured).
 */
export function verifyCredentials(username: string, password: string): AuthEnvironment | null {
  for (const env of ['prod', 'uat'] as const) {
    const set = config.auth[env];
    if (!set.username || !set.passwordHash) continue;
    if (username !== set.username) continue;
    if (verifyPassword(password, set.passwordHash)) return env;
  }

  return null;
}
