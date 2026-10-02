import { describe, expect, it } from "vitest";
import {
  assertCents,
  balanceDueCents,
  computeRefundCents,
  formatMoney,
  parseMoneyToCents,
  validateServicePricing,
} from "../src/pricing";

describe("pricing", () => {
  it("asserts integer cents", () => {
    expect(assertCents(0)).toBe(0);
    expect(() => assertCents(1.5)).toThrow(RangeError);
    expect(() => assertCents(-1)).toThrow(RangeError);
    expect(() => assertCents(Number.NaN)).toThrow(RangeError);
  });

  it("formats money", () => {
    expect(formatMoney(2550)).toBe("$25.50");
    expect(formatMoney(0, "usd")).toBe("$0.00");
    expect(formatMoney(123456, "eur", "de-DE")).toMatch(/1\.234,56/);
  });

  it("parses decimal input without float error", () => {
    expect(parseMoneyToCents("25")).toBe(2500);
    expect(parseMoneyToCents("25.5")).toBe(2550);
    expect(parseMoneyToCents(" 0.29 ")).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(parseMoneyToCents("19.99")).toBe(1999);
    expect(() => parseMoneyToCents("1.999")).toThrow();
    expect(() => parseMoneyToCents("-3")).toThrow();
    expect(() => parseMoneyToCents("abc")).toThrow();
  });

  it("validates service pricing", () => {
    expect(validateServicePricing({ priceCents: 5000, depositCents: 1000 })).toBeNull();
    expect(validateServicePricing({ priceCents: 5000, depositCents: 0 })).toBeNull();
    expect(validateServicePricing({ priceCents: 5000, depositCents: 6000 })).toBe("DEPOSIT_EXCEEDS_PRICE");
    expect(validateServicePricing({ priceCents: 5000, depositCents: 10 })).toBe("DEPOSIT_BELOW_MINIMUM");
  });

  it("computes balance due", () => {
    expect(balanceDueCents(5000, 1500)).toBe(3500);
    expect(balanceDueCents(1000, 1500)).toBe(0);
  });

  describe("computeRefundCents", () => {
    const base = {
      depositPaidCents: 2000,
      alreadyRefundedCents: 0,
      startAt: new Date("2026-06-10T15:00:00Z"),
      cancellationWindowHours: 24,
    };

    it("owner cancellations always refund the remainder", () => {
      expect(computeRefundCents({ ...base, now: new Date("2026-06-10T14:59:00Z"), initiatedBy: "OWNER" })).toBe(2000);
      expect(computeRefundCents({ ...base, alreadyRefundedCents: 500, now: new Date(), initiatedBy: "OWNER" })).toBe(1500);
    });

    it("customer cancellations refund only outside the window (boundary inclusive)", () => {
      expect(computeRefundCents({ ...base, now: new Date("2026-06-09T15:00:00Z"), initiatedBy: "CUSTOMER" })).toBe(2000);
      expect(computeRefundCents({ ...base, now: new Date("2026-06-09T15:00:01Z"), initiatedBy: "CUSTOMER" })).toBe(0);
    });

    it("never refunds more than remains", () => {
      expect(computeRefundCents({ ...base, alreadyRefundedCents: 2000, now: new Date(0), initiatedBy: "OWNER" })).toBe(0);
      expect(computeRefundCents({ ...base, depositPaidCents: 0, now: new Date(0), initiatedBy: "OWNER" })).toBe(0);
    });
  });
});
