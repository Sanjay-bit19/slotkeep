import { afterAll, describe, expect, it } from "vitest";
import { Queue, Worker } from "bullmq";
import { createRedis, getQueue, logger, QUEUE_NAMES, redis, closeQueues } from "@slotkeep/infra";
import { handleFailure } from "../../src/dead-letter";

afterAll(async () => {
  await closeQueues();
});

describe("BullMQ retry policy (real Redis, real Worker)", () => {
  it("retries with exponential backoff, then dead-letters", async () => {
    await redis().flushdb();
    const name = "retry-test";
    const queue = new Queue(name, { connection: createRedis() });
    const attemptsAt: number[] = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));

    const worker = new Worker(
      name,
      async () => {
        attemptsAt.push(Date.now());
        throw new Error("always fails");
      },
      { connection: createRedis() },
    );
    worker.on("failed", async (job, err) => {
      if (await handleFailure(name, job, err, logger)) resolveDone();
    });

    await queue.add(
      "x",
      { hello: 1 },
      { jobId: "flaky", attempts: 4, backoff: { type: "exponential", delay: 100 } },
    );
    await done;
    await worker.close();
    await queue.close();

    expect(attemptsAt).toHaveLength(4);
    const gaps = attemptsAt.slice(1).map((t, i) => t - attemptsAt[i]!);
    // Exponential: ~100ms, ~200ms, ~400ms (allow scheduling slack).
    expect(gaps[0]).toBeGreaterThanOrEqual(95);
    expect(gaps[1]).toBeGreaterThanOrEqual(190);
    expect(gaps[2]).toBeGreaterThanOrEqual(380);
    expect(gaps[2]!).toBeGreaterThan(gaps[0]!);
    const dlq = await getQueue(QUEUE_NAMES.deadLetter).getJob(`dlq-${name}-flaky`);
    expect(dlq?.data).toMatchObject({ queue: name, attemptsMade: 4, failedReason: "always fails" });
  });
});
