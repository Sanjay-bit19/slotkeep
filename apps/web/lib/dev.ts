export const fakePaymentsEnabled = () => (process.env.PAYMENTS_MODE ?? "fake") === "fake";

/**
 * The dev mailbox shows every email body, magic links included. It must never be reachable on a
 * public deployment: off in production unless explicitly enabled for local/CI runs.
 */
export const devMailboxEnabled = () =>
  process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_MAILBOX === "true";
