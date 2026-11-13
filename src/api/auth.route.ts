/**
 * Auth API Routes
 *
 * POST /api/optIn/Auth — validate username/password, issue an HMAC auth token.
 */

import express, { Request, Response } from 'express';
import { validateCredentialsRequest, verifyCredentials } from '@auth/credentials';
import { generateToken } from '@auth/tokenGenerator';
import config from '@config/env';
import logger from '@utils/logger';

const router = express.Router();

router.post('/optIn/Auth', async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};

  const requestValidation = validateCredentialsRequest({ username, password });
  if (!requestValidation.valid) {
    logger.warn('Auth request rejected: invalid payload', {
      component: 'api.auth',
      status: 'at-risk',
      tags: ['auth', 'validation', 'rejected'],
    });
    return res.status(400).json({ error: 'Invalid request', details: requestValidation.errors });
  }

  try {
    const matchedEnv = verifyCredentials(username as string, password as string);

    if (!matchedEnv) {
      logger.warn('Auth request rejected: invalid credentials', {
        component: 'api.auth',
        status: 'at-risk',
        tags: ['auth', 'rejected'],
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const { token, expiresAt } = generateToken(matchedEnv);

    logger.info('Auth token issued', {
      component: 'api.auth',
      status: 'success',
      tags: ['auth', 'token-issued', matchedEnv],
    });

    return res.status(200).json({
      token,
      tokenType: 'HMAC',
      expiresIn: config.auth.tokenTtlSeconds,
      expiresAt,
    });
  } catch (err) {
    logger.error('Failed to generate auth token', {
      component: 'api.auth',
      error_message: err instanceof Error ? err.message : String(err),
      tags: ['auth', 'token', 'error'],
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
