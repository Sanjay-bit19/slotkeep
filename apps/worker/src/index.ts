import { createServer } from "node:http";
import * as Sentry from "@sentry/node";
import { Worker, type Job } from "bullmq";
import { prisma } from "@slotkeep/db";
import {
  closeQueues,
  closeRedis,
  createRedis,
  getQueue,
  logger,
  QUEUE_NAMES,
  redis,
  type EmailJob,
  type HoldJob,
  type JobMeta,
  type MaintenanceJob,
  type RefundJob,
} from "@slotkeep/infra";
import { handleFailure } from "./dead-letter";
import { processEmailJob } from "./processors/email";
import { processHoldJob } from "./processors/holds";
import { processMaintenanceJob } from "./processors/maintenance";
import { processRefundJob } from "./processors/payments";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE || undefined,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

/** Every job runs with a logger carrying the originating HTTP request id. */
function jobLogger(queue: string, job: Job<{ meta?: JobMeta }>) {
  return logger.child({
    queue,
    jobId: job.id,
    jobName: job.name,
    requestId: job.data?.meta?.requestId,
    attempt: job.attemptsMade + 1,
  });
}

function makeWorker<T>(
  name: string,
  concurrency: number,
  fn: (data: T, log: ReturnType<typeof jobLogger>) => Promise<unknown>,
) {
  const worker = new Worker<T>(
    name,
    async (job) => {
      const log = jobLogger(name, job as Job<{ meta?: JobMeta }>);
      const started = Date.now();
      const result = await fn(job.data, log);
      log.info({ durationMs: Date.now() - started }, "job completed");
      return result;
    },
    // Each Worker needs its own blocking connection.
    { connection: createRedis(), concurrency },
  );
  worker.on("failed", (job, err) => {
    void handleFailure(name, job, err, logger.child({ queue: name }));
  });
  worker.on("error", (err) => logger.error({ err, queue: name }, "worker error"));
  return worker;
}

async function main() {
  const workers = [
    makeWorker<EmailJob>(QUEUE_NAMES.email, 10, processEmailJob),
    makeWorker<HoldJob>(QUEUE_NAMES.holds, 10, (d, log) => processHoldJob(d, log)),
    makeWorker<RefundJob>(QUEUE_NAMES.payments, 5, processRefundJob),
    makeWorker<MaintenanceJob>(QUEUE_NAMES.maintenance, 1, (d, log) =>
      processMaintenanceJob(d, log),
    ),
  ];

  // Repeatable schedules. upsertJobScheduler is idempotent across restarts and replicas.
  const maintenance = getQueue<MaintenanceJob>(QUEUE_NAMES.maintenance);
  await maintenance.upsertJobScheduler(
    "sweep-holds",
    { every: 60_000 },
    { name: "sweep-holds", data: { kind: "sweep-holds" } },
  );
  await maintenance.upsertJobScheduler(
    "daily-summaries",
    { pattern: "0 * * * *" },
    { name: "daily-summaries", data: { kind: "daily-summaries" } },
  );

  // Minimal health endpoint for Railway/Render.
  const port = Number(process.env.PORT ?? process.env.WORKER_HEALTH_PORT ?? 3001);
  const server = createServer(async (req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    try {
      await Promise.all([prisma.$queryRaw`SELECT 1`, redis().ping()]);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ status: "ok", workers: workers.length }));
    } catch (err) {
      res
        .writeHead(503, { "content-type": "application/json" })
        .end(JSON.stringify({ status: "degraded", error: (err as Error).message }));
    }
  });
  server.listen(port, () =>
    logger.info({ port, queues: workers.map((w) => w.name) }, "worker started"),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down: finishing in-flight jobs");
    server.close();
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await closeRedis();
    await prisma.$disconnect();
    await Sentry.flush(2_000);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "worker failed to start");
  Sentry.captureException(err);
  process.exit(1);
});
