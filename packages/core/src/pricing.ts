/** Money is always integer minor units (cents). Floats never touch an amount. */

/** Stripe's minimum charge for USD; deposits are either 0 (none) or at least this. */
export const MIN_CHARGE_CENTS = 50;

export function assertCents(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of cents, got ${value}`);
  }
  return value;
}

export function formatMoney(cents: number, currency = "usd", locale = "en-US"): string {
  assertCents(cents);
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );
}

/** Parses a user-entered decimal amount ("25", "25.5", "25.50") into cents without float math. */
export function parseMoneyToCents(input: string): number {
  const trimmed = input.trim();
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!m) throw new RangeError(`Invalid amount: "${input}"`);
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  return whole * 100 + frac;
}

export type PricingError = "DEPOSIT_EXCEEDS_PRICE" | "DEPOSIT_BELOW_MINIMUM";

export function validateServicePricing(p: { priceCents: number; depositCents: number }): PricingError | null {
  assertCents(p.priceCents, "priceCents");
  assertCents(p.depositCents, "depositCents");
  if (p.depositCents > p.priceCents) return "DEPOSIT_EXCEEDS_PRICE";
  if (p.depositCents > 0 && p.depositCents < MIN_CHARGE_CENTS) return "DEPOSIT_BELOW_MINIMUM";
  return null;
}

/** Amount the customer still owes at the appointment. */
export function balanceDueCents(priceCents: number, depositPaidCents: number): number {
  return Math.max(0, assertCents(priceCents) - assertCents(depositPaidCents));
}

export interface RefundInput {
  depositPaidCents: number;
  alreadyRefundedCents: number;
  startAt: Date;
  now: Date;
  /** Customer cancellations at least this many hours before start get a full refund. */
  cancellationWindowHours: number;
  initiatedBy: "OWNER" | "CUSTOMER";
}

/**
 * Refund policy: an owner cancellation refunds whatever has not been refunded yet. A customer
 * cancellation refunds in full only outside the tenant's cancellation window; inside it the
 * deposit is kept. Never returns more than the refundable remainder.
 */
export function computeRefundCents(input: RefundInput): number {
  const remaining = assertCents(input.depositPaidCents) - assertCents(input.alreadyRefundedCents);
  if (remaining <= 0) return 0;
  if (input.initiatedBy === "OWNER") return remaining;
  const cutoff = input.startAt.getTime() - input.cancellationWindowHours * 3_600_000;
  return input.now.getTime() <= cutoff ? remaining : 0;
}
