import { NextResponse } from "next/server";
import { prisma } from "@slotkeep/db";
import { redis } from "@slotkeep/infra";

export const dynamic = "force-dynamic";

async function timed(check: () => Promise<unknown>, timeoutMs = 2_000) {
  const start = performance.now();
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: (err as Error).message,
    };
  }
}

/** Liveness + dependency check for load balancers and uptime monitors. 503 if anything is down. */
export async function GET() {
  const [database, cache] = await Promise.all([
    timed(() => prisma.$queryRaw`SELECT 1`),
    timed(() => redis().ping()),
  ]);
  const ok = database.ok && cache.ok;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "dev",
      checks: { database, redis: cache },
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
