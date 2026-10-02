import { Redis, type RedisOptions } from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as { __slotkeepRedis?: Redis };

/** BullMQ requires maxRetriesPerRequest: null on connections it uses for blocking commands. */
export function createRedis(opts: RedisOptions = {}): Redis {
  return new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...opts,
  });
}

/** Shared connection for non-blocking commands (rate limiting, queue producers, health). */
export function redis(): Redis {
  if (!globalForRedis.__slotkeepRedis) {
    globalForRedis.__slotkeepRedis = createRedis({ lazyConnect: false });
    globalForRedis.__slotkeepRedis.on("error", () => {
      /* surfaced through health checks and command errors; avoid unhandled 'error' crashes */
    });
  }
  return globalForRedis.__slotkeepRedis;
}

export async function closeRedis(): Promise<void> {
  if (globalForRedis.__slotkeepRedis) {
    await globalForRedis.__slotkeepRedis.quit().catch(() => undefined);
    globalForRedis.__slotkeepRedis = undefined;
  }
}
