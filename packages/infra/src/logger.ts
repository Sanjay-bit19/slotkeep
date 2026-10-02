import pino, { type Logger } from "pino";

/**
 * Structured JSON logs to stdout. No transports (they spawn worker threads, which break in
 * serverless bundles); pretty-print locally with `| pino-pretty`.
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: {
    service: process.env.SERVICE_NAME ?? "slotkeep",
    release: process.env.SENTRY_RELEASE || undefined,
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
