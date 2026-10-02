import * as Sentry from "@sentry/nextjs";

const release = () => process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.SERVICE_NAME ??= "web";
    if (process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        release: release(),
        environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      });
    }
  }
  if (process.env.NEXT_RUNTIME === "edge" && process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release: release(),
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
