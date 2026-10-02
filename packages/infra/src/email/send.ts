import { prisma } from "@slotkeep/db";
import { env } from "../env";
import { logger } from "../logger";
import type { RenderedEmail } from "./templates";

export interface SendEmailInput extends RenderedEmail {
  to: string;
  template: string;
  tenantId?: string | null;
  bookingId?: string | null;
  /** Unique key; if an email with this key was already sent, sending is skipped. */
  dedupeKey?: string;
}

export interface SendEmailResult {
  status: "sent" | "logged" | "skipped";
  providerId?: string;
}

/**
 * Sends a transactional email via Resend's HTTP API, or (without RESEND_API_KEY) just records it.
 * Every email lands in EmailLog; in non-production the body is stored too, which powers the dev
 * mailbox page and lets e2e tests click magic links.
 *
 * Idempotency: callers pass a dedupeKey for anything a retried job might send twice.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const e = env();
  if (input.dedupeKey) {
    const existing = await prisma.emailLog.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing && existing.status !== "failed") {
      logger.info({ dedupeKey: input.dedupeKey }, "email already sent; skipping");
      return { status: "skipped" };
    }
  }

  let status: SendEmailResult["status"] = "logged";
  let providerId: string | undefined;
  if (e.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: e.EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      // Throw so the job retries with backoff; log row records the failure.
      await upsertLog(input, "failed");
      throw new Error(`Resend responded ${res.status}: ${body.slice(0, 200)}`);
    }
    providerId = ((await res.json()) as { id?: string }).id;
    status = "sent";
  } else {
    logger.info(
      { to: input.to, subject: input.subject, template: input.template },
      "email (dev transport)",
    );
  }
  await upsertLog(input, status, providerId);
  return { status, providerId };
}

async function upsertLog(input: SendEmailInput, status: string, providerId?: string) {
  const body =
    env().NODE_ENV === "production" ? null : `${input.text}\n\n<!--html-->\n${input.html}`;
  const data = {
    tenantId: input.tenantId ?? null,
    bookingId: input.bookingId ?? null,
    to: input.to,
    subject: input.subject,
    template: input.template,
    status,
    providerId: providerId ?? null,
    body,
  };
  if (input.dedupeKey) {
    await prisma.emailLog.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: { ...data, dedupeKey: input.dedupeKey },
      update: data,
    });
  } else {
    await prisma.emailLog.create({ data });
  }
}
