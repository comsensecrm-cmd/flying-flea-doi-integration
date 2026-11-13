/**
 * Application Entry Point
 *
 * POST /api/optIn/Auth — validate username/password, issue an HMAC auth token.
 */

import express from 'express';
import config from '@config/env';
import logger from '@utils/logger';
import * as cloudwatch from '@utils/cloudwatch';
import authRouter from '@api/auth.route';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.path} -> ${res.statusCode}`, {
      component: 'express.middleware',
      duration_ms: Date.now() - start,
      tags: ['request'],
    });
  });
  next();
});

// Auth API  (POST /api/optIn/Auth)
app.use('/api', authRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'flying-flea-sfmc-doi-integration',
    version: '1.0.0',
    status: 'running',
  });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled express error', {
    component: 'express.error_handler',
    error_message: err.message,
    tags: ['express', 'unhandled'],
  });
  res.status(500).json({ error: 'Internal server error' });
});

async function start(): Promise<void> {
  try {
    await cloudwatch.connect();
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Connected to AWS CloudWatch Logs',
        component: 'server.startup',
        status: 'success',
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Failed to connect to AWS CloudWatch Logs',
        component: 'server.startup',
        status: 'error',
        error_message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    process.kill(process.pid, 'SIGINT');
    return;
  }

  app.listen(config.port, config.host, () => {
    logger.info('Server started', {
      component: 'server.startup',
      status: 'success',
      tags: ['startup'],
    });
    logger.info(`Auth endpoint ready: http://${config.host}:${config.port}/api/optIn/Auth`, {
      component: 'server.startup',
      tags: ['startup'],
    });
  });
}

start();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
