import dotenv from 'dotenv';

dotenv.config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',

  port: parseInt(process.env.PORT || '3500', 10),
  host: process.env.HOST || '0.0.0.0',

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Inbound auth — POST /api/optIn/Auth.
  // Two credential sets (prod + UAT) are accepted by the same running process.
  // Each set's token is signed with that set's own HMAC secret key, so a UAT
  // token can never be produced with the prod secret or vice versa.
  auth: {
    hmacAlgorithm: process.env.API_HMAC_ALGORITHM || 'sha256',
    tokenTtlSeconds: parseInt(process.env.API_HMAC_TOKEN_TTL_SECONDS || '300', 10),

    prod: {
      username: process.env.AUTH_USERNAME || '',
      passwordHash: process.env.AUTH_PASSWORD_HASH || '',
      hmacSecretKey: process.env.API_HMAC_SECRET_KEY || '',
    },

    uat: {
      username: process.env.UAT_AUTH_USERNAME || '',
      passwordHash: process.env.UAT_AUTH_PASSWORD_HASH || '',
      hmacSecretKey: process.env.UAT_API_HMAC_SECRET_KEY || '',
    },
  },

  // AWS CloudWatch Logs — the app ships every log line here in addition to
  // stdout, and refuses to start until connectivity is confirmed with a
  // single immediate attempt (see utils/cloudwatch.ts). Required in all
  // environments.
  aws: {
    region: process.env.AWS_REGION || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    logGroup: process.env.AWS_LOG_GROUP || '',
    logStream: process.env.AWS_LOG_STREAM || '',
  },
};

export default config;
