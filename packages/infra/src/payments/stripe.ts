import Stripe from "stripe";
import { env } from "../env";
import type { CheckoutSessionResult, DepositCheckoutInput, PaymentGateway } from "./types";

let client: Stripe | undefined;

/**
 * Stripe SDK instance. Signature verification needs no API key, so an inert placeholder key is
 * used when none is configured (fake mode); it is never sent anywhere.
 */
export function stripeClient(): Stripe {
  client ??= new Stripe(env().STRIPE_SECRET_KEY || "sk_test_placeholder_not_used", {
    maxNetworkRetries: 2,
    appInfo: { name: "SlotKeep" },
  });
  return client;
}

/** Verifies the Stripe-Signature header against the raw body. Throws on mismatch or replay. */
export function constructWebhookEvent(rawBody: string, signature: string | null): Stripe.Event {
  if (!signature) throw new Error("Missing Stripe-Signature header");
  return stripeClient().webhooks.constructEvent(
    rawBody,
    signature,
    env().STRIPE_WEBHOOK_SECRET,
    300,
  );
}

export function signWebhookPayload(payload: string): string {
  return stripeClient().webhooks.generateTestHeaderString({
    payload,
    secret: env().STRIPE_WEBHOOK_SECRET,
  });
}

/** Stripe Checkout sessions must live at least 30 minutes; our 10-minute hold is shorter, so the
 * hold-expiry job explicitly expires the session (see expireCheckout). */
const CHECKOUT_MIN_LIFETIME_S = 30 * 60 + 60;

export class StripeGateway implements PaymentGateway {
  readonly mode = "stripe" as const;

  async createDepositCheckout(input: DepositCheckoutInput): Promise<CheckoutSessionResult> {
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        customer_email: input.customerEmail,
        client_reference_id: input.bookingId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amountCents,
              product_data: { name: input.productName, description: input.description },
            },
          },
        ],
        metadata: { bookingId: input.bookingId, tenantId: input.tenantId, kind: "deposit" },
        payment_intent_data: { metadata: { bookingId: input.bookingId, tenantId: input.tenantId } },
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MIN_LIFETIME_S,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: `checkout-${input.bookingId}` },
    );
    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    return { id: session.id, url: session.url };
  }

  async expireCheckout(sessionId: string): Promise<void> {
    try {
      await stripeClient().checkout.sessions.expire(sessionId);
    } catch (err) {
      // Already expired or completed: both fine. Anything else bubbles up for a job retry.
      if (err instanceof Stripe.errors.StripeInvalidRequestError) return;
      throw err;
    }
  }

  async refund(input: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
    bookingId: string;
  }) {
    const refund = await stripeClient().refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
        metadata: { bookingId: input.bookingId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: refund.id };
  }

  async createSubscriptionCheckout(input: {
    tenantId: string;
    customerId: string | null;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSessionResult> {
    const price = env().STRIPE_PRO_PRICE_ID;
    if (!price) throw new Error("STRIPE_PRO_PRICE_ID is not configured");
    const session = await stripeClient().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
      client_reference_id: input.tenantId,
      metadata: { tenantId: input.tenantId, kind: "subscription" },
      subscription_data: { metadata: { tenantId: input.tenantId } },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    return { id: session.id, url: session.url };
  }

  async createBillingPortal(input: { customerId: string; returnUrl: string }) {
    const portal = await stripeClient().billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: portal.url };
  }
}
