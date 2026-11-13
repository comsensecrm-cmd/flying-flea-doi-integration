/**
 * HMAC Auth Token Generator
 *
 * Produces the `{timestamp}.{signature}` token format used for HMAC-authenticated
 * requests:
 *
 *   1. Take the current Unix timestamp (seconds).
 *   2. Sign it with HMAC using API_HMAC_ALGORITHM and the secret key for the
 *      matched environment (prod or UAT — see config.auth.prod/.uat).
 *   3. Base64-encode the signature.
 *   4. Concatenate as `${timestamp}.${base64Signature}`.
 *
 * The token is valid for config.auth.tokenTtlSeconds (default 300s / 5 min)
 * from the timestamp it was generated with. A prod-signed token will never
 * verify against the UAT secret and vice versa.
 */

import crypto from 'crypto';
import config from '@config/env';
import logger from '@utils/logger';
import type { AuthEnvironment } from '@auth/credentials';

export interface GeneratedToken {
  token: string; // "{timestamp}.{signature}"
  timestamp: number; // Unix seconds the token was signed with
  expiresAt: number; // Unix seconds after which the token is no longer valid
}

function secretKeyFor(env: AuthEnvironment): string {
  return config.auth[env].hmacSecretKey;
}

function computeHmac(env: AuthEnvironment, data: string): string {
  const secretKey = secretKeyFor(env);
  if (!secretKey) {
    throw new Error(`HMAC secret key is not configured for environment "${env}"`);
  }

  return crypto.createHmac(config.auth.hmacAlgorithm, secretKey).update(data).digest('base64');
}

/**
 * Generates a fresh HMAC auth token in `{timestamp}.{signature}` format,
 * signed over the current Unix timestamp (seconds) using the given
 * environment's secret key.
 */
export function generateToken(env: AuthEnvironment): GeneratedToken {
  const timestamp = Math.floor(Date.now() / 1000);

  try {
    const signature = computeHmac(env, String(timestamp));
    return {
      token: `${timestamp}.${signature}`,
      timestamp,
      expiresAt: timestamp + config.auth.tokenTtlSeconds,
    };
  } catch (err) {
    logger.error('Failed to generate HMAC auth token', {
      component: 'auth.tokenGenerator',
      error_message: err instanceof Error ? err.message : String(err),
      tags: ['auth', 'token', 'hmac', env],
    });
    throw err;
  }
}
