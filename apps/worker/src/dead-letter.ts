import type { Job } from "bullmq";
import * as Sentry from "@sentry/node";
import { getQueue, QUEUE_NAMES, type DeadLetterJob, type Logger } from "@slotkeep/infra";

/**
 * Called on every failed attempt. Only once a job has exhausted all retries is it copied to the
 * dead-letter queue (kept 30 days for inspection/replay) and reported to Sentry.
 */
export async function handleFailure(
  queueName: string,
  job: Job | undefined,
  err: Error,
  log: Logger,
): Promise<boolean> {
  if (!job) return false;
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < attempts) {
    log.warn(
      { queue: queueName, jobId: job.id, attempt: job.attemptsMade, err: err.message },
      "job attempt failed; will retry",
    );
    return false;
  }
  const entry: DeadLetterJob = {
    queue: queueName,
    jobId: job.id,
    name: job.name,
    data: job.data,
    failedReason: err.message,
    attemptsMade: job.attemptsMade,
    failedAt: new Date().toISOString(),
  };
  await getQueue<DeadLetterJob>(QUEUE_NAMES.deadLetter).add("dead", entry, {
    jobId: `dlq-${queueName}-${job.id}`,
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  });
  Sentry.captureException(err, {
    tags: { queue: queueName, job: job.name },
    extra: { jobId: job.id, data: job.data },
  });
  log.error(
    { queue: queueName, jobId: job.id, err: err.message, attempts: job.attemptsMade },
    "job moved to dead-letter queue",
  );
  return true;
}
