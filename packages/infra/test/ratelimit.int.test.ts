import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { rateLimit, rateLimitHeaders } from "../src/ratelimit";

const client = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
const policy = { name: "test", limit: 3, windowMs: 1_000 };

beforeEach(async () => {
  await client.flushdb();
});
afterAll(async () => {
  await client.quit();
});

describe("redis sliding-window rate limiter", () => {
  it("allows up to the limit then blocks with a retry-after", async () => {
    const t = 1_000_000;
    const results = [];
    for (let i = 0; i < 4; i++)
      results.push(await rateLimit(policy, "ip1", { client, now: t + i, force: true }));
    expect(results.map((r) => r.success)).toEqual([true, true, true, false]);
    expect(results[2]!.remaining).toBe(0);
    expect(results[3]!.retryAfterMs).toBe(997); // oldest hit at t, now t+3
    expect(rateLimitHeaders(results[3]!)["Retry-After"]).toBe("1");
  });

  it("slides: old hits fall out of the window", async () => {
    for (let i = 0; i < 3; i++) await rateLimit(policy, "ip2", { client, now: 0 + i, force: true });
    expect((await rateLimit(policy, "ip2", { client, now: 500, force: true })).success).toBe(false);
    expect((await rateLimit(policy, "ip2", { client, now: 1_001, force: true })).success).toBe(
      true,
    );
  });

  it("isolates identifiers", async () => {
    for (let i = 0; i < 3; i++) await rateLimit(policy, "a", { client, now: i, force: true });
    expect((await rateLimit(policy, "b", { client, now: 3, force: true })).success).toBe(true);
  });

  it("is atomic under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        rateLimit({ ...policy, limit: 5 }, "burst", { client, now: 42, force: true }),
      ),
    );
    expect(results.filter((r) => r.success)).toHaveLength(5);
  });

  it("fails open when redis is unavailable", async () => {
    const dead = new Redis("redis://localhost:6390", {
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    dead.on("error", () => undefined);
    const r = await rateLimit(policy, "x", { client: dead, force: true });
    expect(r.success).toBe(true);
    dead.disconnect();
  });
});
