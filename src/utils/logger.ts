/**
 * Minimal structured logger — JSON lines to stdout, also shipped to AWS
 * CloudWatch Logs (see utils/cloudwatch.ts).
 * Redacts sensitive field names/patterns before anything is printed or shipped.
 */

import { ship } from './cloudwatch';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'client_secret',
  'clientsecret',
  'access_token',
  'accesstoken',
  'token',
  'bearer_token',
  'authorization',
  'x-authorization',
  'secret',
  'api_key',
  'apikey',
  'private_key',
  'privatekey',
  'hmacsecretkey',
  'passwordhash',
]);

const SENSITIVE_STRING_PATTERNS: RegExp[] = [
  /(?:password|passwd|client_secret|clientsecret|access_token|accesstoken|bearer|api_key|apikey|private_key|secret)\s*[:=]\s*\S+/gi,
];

function sanitizeString(str: string): string {
  let result = str;
  for (const pattern of SENSITIVE_STRING_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : sanitizeForLog(val, depth + 1);
  }
  return result;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  component?: string;
  request_id?: string;
  status?: string;
  error_code?: string;
  error_message?: string;
  duration_ms?: number;
  tags?: string[];
  [extra: string]: unknown;
}

function write(level: Level, message: string, meta: LogMeta = {}): void {
  const entry = sanitizeForLog({
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'flying-flea-sfmc-doi-integration',
    ...meta,
  });
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  ship(line);
}

export const logger = {
  debug(message: string, meta: LogMeta = {}): void {
    if (process.env.NODE_ENV !== 'production') write('debug', message, meta);
  },
  info(message: string, meta: LogMeta = {}): void {
    write('info', message, meta);
  },
  warn(message: string, meta: LogMeta = {}): void {
    write('warn', message, meta);
  },
  error(message: string, meta: LogMeta | Error = {}): void {
    if (meta instanceof Error) {
      write('error', message, { error_message: meta.message, stack_trace: meta.stack });
    } else {
      write('error', message, meta);
    }
  },
};

export default logger;
