import pino, { type Logger } from "pino";

/**
 * Release identifier shared by logs and Sentry: explicit SENTRY_RELEASE, else the commit SHA the
 * hosting platform exposes (Vercel, Railway, Render, GitHub Actions).
 */
export function releaseName(): string | undefined {
  const e = process.env;
  return (
    e.SENTRY_RELEASE ||
    e.VERCEL_GIT_COMMIT_SHA ||
    e.RAILWAY_GIT_COMMIT_SHA ||
    e.RENDER_GIT_COMMIT ||
    e.GITHUB_SHA ||
    undefined
  );
}

/**
 * Structured JSON logs to stdout. No transports (they spawn worker threads, which break in
 * serverless bundles); pretty-print locally with `| pino-pretty`.
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: {
    service: process.env.SERVICE_NAME ?? "slotkeep",
    release: releaseName(),
  },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.secret"],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type { Logger };

/** Metadata carried from an HTTP request into every job it enqueues. */
export interface JobMeta {
  requestId?: string;
}

export function requestLogger(
  requestId: string | null | undefined,
  extra: Record<string, unknown> = {},
): Logger {
  return logger.child({ requestId: requestId ?? undefined, ...extra });
}
