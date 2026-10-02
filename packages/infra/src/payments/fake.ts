import { randomBytes } from "node:crypto";
import { env } from "../env";
import { logger } from "../logger";
import { redis } from "../redis";
import { signWebhookPayload } from "./stripe";
import type { CheckoutSessionResult, DepositCheckoutInput, PaymentGateway } from "./types";

/**
 * Offline stand-in for Stripe used in local dev and CI when no Stripe keys are present.
 *
 * It does NOT bypass the webhook path: "paying" on the fake checkout page builds a Stripe-shaped
 * event, signs it with STRIPE_WEBHOOK_SECRET exactly like Stripe does, and POSTs it to
 * /api/webhooks/stripe. Signature verification, idempotency and confirmation logic are the same
 * code that runs against real Stripe.
 */

export interface FakeSession {
  id: string;
  mode: "payment" | "subscription";
  status: "open" | "complete" | "expired";
  amountCents: number;
  currency: string;
  customerEmail: string;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  clientReferenceId: string;
  customerId: string | null;
}

const KEY = (id: string) => `fakestripe:session:${id}`;
const rid = (prefix: string) => `${prefix}_fake_${randomBytes(9).toString("hex")}`;

async function save(s: FakeSession) {
  await redis().set(KEY(s.id), JSON.stringify(s), "EX", 86_400);
}

export async function getFakeSession(id: string): Promise<FakeSession | null> {
  const raw = await redis().get(KEY(id));
  return raw ? (JSON.parse(raw) as FakeSession) : null;
}

function baseUrl() {
  return env().INTERNAL_APP_URL ?? env().APP_URL;
}

export async function postSignedEvent(
  type: string,
  object: Record<string, unknown>,
): Promise<Response> {
  const event = {
    id: rid("evt"),
    object: "event",
    api_version: "fake",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
  };
  const payload = JSON.stringify(event);
  const res = await fetch(`${baseUrl()}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signWebhookPayload(payload),
    },
    body: payload,
  });
  logger.info({ type, eventId: event.id, status: res.status }, "fake stripe webhook delivered");
  return res;
}

/** Simulates the customer completing payment on the hosted page. */
export async function completeFakeSession(
  id: string,
): Promise<{ ok: boolean; redirectTo: string; reason?: string }> {
  const s = await getFakeSession(id);
  if (!s) return { ok: false, redirectTo: "/", reason: "Unknown session" };
  if (s.status !== "open")
    return { ok: false, redirectTo: s.cancelUrl, reason: `Session is ${s.status}` };
  s.status = "complete";
  await save(s);

  if (s.mode === "payment") {
    const res = await postSignedEvent("checkout.session.completed", {
      id: s.id,
      object: "checkout.session",
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      amount_total: s.amountCents,
      currency: s.currency,
      customer_email: s.customerEmail,
      client_reference_id: s.clientReferenceId,
      payment_intent: rid("pi"),
      metadata: s.metadata,
    });
    if (!res.ok)
      return { ok: false, redirectTo: s.cancelUrl, reason: `Webhook failed (${res.status})` };
  } else {
    const customer = s.customerId ?? rid("cus");
    const subscription = rid("sub");
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
    const r1 = await postSignedEvent("checkout.session.completed", {
      id: s.id,
      object: "checkout.session",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      customer,
      subscription,
      client_reference_id: s.clientReferenceId,
      metadata: s.metadata,
    });
    const r2 = await postSignedEvent("customer.subscription.created", {
      id: subscription,
      object: "subscription",
      customer,
      status: "active",
      cancel_at_period_end: false,
      metadata: s.metadata,
      items: {
        object: "list",
        data: [{ id: rid("si"), current_period_end: periodEnd, price: { id: "price_fake_pro" } }],
      },
    });
    if (!r1.ok || !r2.ok) return { ok: false, redirectTo: s.cancelUrl, reason: "Webhook failed" };
  }
  return { ok: true, redirectTo: s.successUrl.replace("{CHECKOUT_SESSION_ID}", s.id) };
}

/** Simulates cancelling from the Stripe billing portal. */
export async function cancelFakeSubscription(input: {
  tenantId: string;
  customerId: string;
  subscriptionId: string;
}) {
  return postSignedEvent("customer.subscription.deleted", {
    id: input.subscriptionId,
    object: "subscription",
    customer: input.customerId,
    status: "canceled",
    cancel_at_period_end: false,
    metadata: { tenantId: input.tenantId },
    items: {
      object: "list",
      data: [
        {
          id: rid("si"),
          current_period_end: Math.floor(Date.now() / 1000),
          price: { id: "price_fake_pro" },
        },
      ],
    },
  });
}

export class FakeGateway implements PaymentGateway {
  readonly mode = "fake" as const;

  async createDepositCheckout(input: DepositCheckoutInput): Promise<CheckoutSessionResult> {
    const s: FakeSession = {
      id: rid("cs"),
      mode: "payment",
      status: "open",
      amountCents: input.amountCents,
      currency: input.currency,
      customerEmail: input.customerEmail,
      productName: input.productName,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      metadata: { bookingId: input.bookingId, tenantId: input.tenantId, kind: "deposit" },
      clientReferenceId: input.bookingId,
      customerId: null,
    };
    await save(s);
    return { id: s.id, url: `${env().APP_URL}/dev/checkout/${s.id}` };
  }

  async expireCheckout(sessionId: string): Promise<void> {
    const s = await getFakeSession(sessionId);
    if (s && s.status === "open") {
      s.status = "expired";
      await save(s);
    }
  }

  async refund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string }) {
    // Mirror Stripe idempotency keys: the same key always returns the same refund.
    const key = `fakestripe:refund:${input.idempotencyKey}`;
    const existing = await redis().get(key);
    if (existing) return { id: existing };
    const id = rid("re");
    await redis().set(key, id, "EX", 86_400 * 7);
    return { id };
  }

  async createSubscriptionCheckout(input: {
    tenantId: string;
    customerId: string | null;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSessionResult> {
    const s: FakeSession = {
      id: rid("cs"),
      mode: "subscription",
      status: "open",
      amountCents: 2900,
      currency: "usd",
      customerEmail: input.email,
      productName: "SlotKeep Pro (monthly)",
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      metadata: { tenantId: input.tenantId, kind: "subscription" },
      clientReferenceId: input.tenantId,
      customerId: input.customerId,
    };
    await save(s);
    return { id: s.id, url: `${env().APP_URL}/dev/checkout/${s.id}` };
  }

  async createBillingPortal(input: { customerId: string; returnUrl: string }) {
    return {
      url: `${env().APP_URL}/dev/billing-portal?customer=${encodeURIComponent(input.customerId)}&return=${encodeURIComponent(input.returnUrl)}`,
    };
  }
}
