/**
 * AWS CloudWatch Logs integration.
 *
 * `connect()` is called once at startup (see index.ts) and must succeed before
 * the app starts accepting traffic — it attempts a single connection, with no
 * retry or wait, and throws immediately on failure, causing the process to
 * exit rather than run without shipped logs.
 *
 * `ship()` is called by utils/logger.ts for every log line once connected; it
 * queues events and flushes them in order, carrying the sequence token
 * CloudWatch requires between successive PutLogEvents calls on a stream.
 */

import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  DescribeLogStreamsCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';
import config from '@config/env';

let client: CloudWatchLogsClient | undefined;
let sequenceToken: string | undefined;
let connected = false;

// Serializes ship() calls so events are sent to CloudWatch in the order
// they were logged, and so concurrent PutLogEvents calls don't race on
// sequenceToken.
let sendQueue: Promise<void> = Promise.resolve();

async function ensureLogGroupAndStream(cwClient: CloudWatchLogsClient): Promise<string | undefined> {
  const { logGroup, logStream } = config.aws;

  try {
    await cwClient.send(new CreateLogGroupCommand({ logGroupName: logGroup }));
  } catch (err) {
    if (!(err instanceof ResourceAlreadyExistsException)) throw err;
  }

  try {
    await cwClient.send(new CreateLogStreamCommand({ logGroupName: logGroup, logStreamName: logStream }));
  } catch (err) {
    if (!(err instanceof ResourceAlreadyExistsException)) throw err;
  }

  const described = await cwClient.send(
    new DescribeLogStreamsCommand({
      logGroupName: logGroup,
      logStreamNamePrefix: logStream,
    }),
  );
  const stream = described.logStreams?.find((s) => s.logStreamName === logStream);
  return stream?.uploadSequenceToken;
}

/**
 * Verifies CloudWatch connectivity by ensuring the configured log group and
 * stream exist. Makes a single attempt — no retry, no wait. Throws
 * immediately on failure — callers should treat that as fatal.
 */
export async function connect(): Promise<void> {
  const { region, accessKeyId, secretAccessKey, logGroup, logStream } = config.aws;

  if (!region || !accessKeyId || !secretAccessKey || !logGroup || !logStream) {
    throw new Error(
      'AWS CloudWatch Logs is not fully configured — AWS_REGION, AWS_ACCESS_KEY_ID, ' +
        'AWS_SECRET_ACCESS_KEY, AWS_LOG_GROUP and AWS_LOG_STREAM are all required.',
    );
  }

  const cwClient = new CloudWatchLogsClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    sequenceToken = await ensureLogGroupAndStream(cwClient);
    client = cwClient;
    connected = true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not connect to AWS CloudWatch Logs (group="${logGroup}", stream="${logStream}"): ${reason}`);
  }
}

export function isConnected(): boolean {
  return connected;
}

/** Queues a single log line for delivery to CloudWatch. Fire-and-forget. */
export function ship(line: string): void {
  if (!connected || !client) return;

  sendQueue = sendQueue
    .then(async () => {
      if (!client) return;
      const result = await client.send(
        new PutLogEventsCommand({
          logGroupName: config.aws.logGroup,
          logStreamName: config.aws.logStream,
          logEvents: [{ message: line, timestamp: Date.now() }],
          sequenceToken,
        }),
      );
      sequenceToken = result.nextSequenceToken;
    })
    .catch((err) => {
      // Avoid recursing into logger.ts (which calls ship()) — write directly.
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Failed to ship log line to CloudWatch',
          error_message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    });
}
