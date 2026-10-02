import { Queue, type JobsOptions } from "bullmq";
import type { JobMeta } from "./logger";
import { redis } from "./redis";

export const QUEUE_NAMES = {
  email: "email",
  holds: "holds",
  payments: "payments",
  maintenance: "maintenance",
  deadLetter: "dead-letter",
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type BookingEmailKind =
  | "booking-confirmed"
  | "booking-cancelled"
  | "booking-rescheduled"
  | "booking-reminder"
  | "payment-conflict";

export type EmailJob =
  | { kind: BookingEmailKind; bookingId: string; meta?: JobMeta; refundCents?: number }
  | { kind: "daily-summary"; tenantId: string; localDate: string; meta?: JobMeta };

export interface HoldJob {
  bookingId: string;
  meta?: JobMeta;
}

export interface RefundJob {
  kind: "refund";
  bookingId: string;
  amountCents: number;
  /** Email to send once the refund succeeds. */
  notify: "booking-cancelled" | "payment-conflict";
  meta?: JobMeta;
}

export type MaintenanceJob = { kind: "sweep-holds" } | { kind: "daily-summaries" };

export interface DeadLetterJob {
  queue: string;
  jobId: string | undefined;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

/**
 * Retry policy shared by every queue: 5 attempts with exponential backoff (2s, 4s, 8s, 16s).
 * Jobs that exhaust their attempts are copied to the dead-letter queue by the worker.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 7 * 86_400, count: 5_000 },
  removeOnFail: { age: 30 * 86_400 },
};

const globalForQueues = globalThis as unknown as { __slotkeepQueues?: Map<string, Queue> };

export function getQueue<T = unknown>(name: QueueName): Queue<T> {
  globalForQueues.__slotkeepQueues ??= new Map();
  let q = globalForQueues.__slotkeepQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    globalForQueues.__slotkeepQueues.set(name, q);
  }
  return q as Queue<T>;
}

export async function closeQueues(): Promise<void> {
  const qs = globalForQueues.__slotkeepQueues;
  if (!qs) return;
  await Promise.all([...qs.values()].map((q) => q.close()));
  qs.clear();
}

// Job ids make enqueues idempotent: adding a job whose id already exists is a no-op in BullMQ.
// (BullMQ forbids ':' in custom ids, hence the dashes.)

export async function enqueueHoldExpiry(
  bookingId: string,
  holdExpiresAt: Date,
  meta?: JobMeta,
  now = new Date(),
) {
  const delay = Math.max(0, holdExpiresAt.getTime() - now.getTime());
  return getQueue<HoldJob>(QUEUE_NAMES.holds).add(
    "expire-hold",
    { bookingId, meta },
    { delay, jobId: `hold-${bookingId}` },
  );
}

export async function enqueueBookingEmail(
  kind: BookingEmailKind,
  bookingId: string,
  opts: { meta?: JobMeta; dedupe?: string; refundCents?: number; delay?: number } = {},
) {
  return getQueue<EmailJob>(QUEUE_NAMES.email).add(
    kind,
    { kind, bookingId, meta: opts.meta, refundCents: opts.refundCents },
    { jobId: `${kind}-${bookingId}${opts.dedupe ? `-${opts.dedupe}` : ""}`, delay: opts.delay },
  );
}

/** Schedules the 24h reminder. Skipped when the booking is less than 24h away. */
export async function enqueueReminder(
  bookingId: string,
  startAt: Date,
  meta?: JobMeta,
  now = new Date(),
) {
  const sendAt = startAt.getTime() - 24 * 3_600_000;
  if (sendAt <= now.getTime()) return null;
  return getQueue<EmailJob>(QUEUE_NAMES.email).add(
    "booking-reminder",
    { kind: "booking-reminder", bookingId, meta },
    // Keyed by start time: a rescheduled booking gets a fresh reminder; the old one sees the
    // start time no longer matches and does nothing.
    { delay: sendAt - now.getTime(), jobId: `booking-reminder-${bookingId}-${startAt.getTime()}` },
  );
}

export async function enqueueRefund(
  bookingId: string,
  amountCents: number,
  notify: RefundJob["notify"],
  meta?: JobMeta,
  opts: { delay?: number } = {},
) {
  return getQueue<RefundJob>(QUEUE_NAMES.payments).add(
    "refund",
    { kind: "refund", bookingId, amountCents, notify, meta },
    { jobId: `refund-${bookingId}`, delay: opts.delay },
  );
}
