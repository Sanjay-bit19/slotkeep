import type Stripe from "stripe";

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

export interface DepositCheckoutInput {
  bookingId: string;
  tenantId: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  productName: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentGateway {
  readonly mode: "stripe" | "fake";
  createDepositCheckout(input: DepositCheckoutInput): Promise<CheckoutSessionResult>;
  /** Makes an open Checkout session unpayable. No-op if it is already expired or complete. */
  expireCheckout(sessionId: string): Promise<void>;
  refund(input: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
    bookingId: string;
  }): Promise<{ id: string }>;
  createSubscriptionCheckout(input: {
    tenantId: string;
    customerId: string | null;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSessionResult>;
  createBillingPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
}

export type { Stripe };
