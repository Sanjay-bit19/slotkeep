import { describe, expect, it } from "vitest";
import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  dailySummaryEmail,
  escapeHtml,
  magicLinkEmail,
  paymentConflictEmail,
} from "../src/email/templates";

const data = {
  businessName: "Shear <Bliss>",
  brandColor: "#4f46e5",
  timezone: "America/New_York",
  customerName: "Jo <script>alert(1)</script>",
  serviceName: "Cut",
  staffName: "Ana",
  startAt: new Date("2030-03-04T15:00:00Z"),
  priceCents: 5000,
  depositPaidCents: 1000,
  currency: "usd",
  cancellationWindowHours: 24,
  manageUrl: "https://app.test/m/tok",
};

describe("email templates", () => {
  it("escapes user-provided content", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
    const e = bookingConfirmedEmail(data);
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("Jo &lt;script&gt;");
  });

  it("renders times in the tenant timezone and money in cents", () => {
    const e = bookingConfirmedEmail(data);
    expect(e.text).toContain("Monday, March 4, 2030 at 10:00 AM");
    expect(e.text).toContain("Deposit paid: $10.00");
    expect(e.text).toContain("Due at appointment: $40.00");
    expect(e.text).toContain("https://app.test/m/tok");
  });

  it("explains refunds on cancellation", () => {
    expect(bookingCancelledEmail({ ...data, refundCents: 1000 }).text).toContain(
      "refund of $10.00",
    );
    expect(bookingCancelledEmail({ ...data, refundCents: 0 }).text).toContain("non-refundable");
    expect(bookingCancelledEmail({ ...data, depositPaidCents: 0, refundCents: 0 }).text).toContain(
      "No payment was taken",
    );
    expect(paymentConflictEmail({ ...data, refundCents: 1000 }).text).toContain("refunded $10.00");
  });

  it("renders summaries and magic links", () => {
    const s = dailySummaryEmail({
      ...data,
      localDate: "2030-03-04",
      dashboardUrl: "https://x",
      bookings: [],
    });
    expect(s.subject).toContain("0 appointments");
    expect(magicLinkEmail("https://x/cb", "x").html).toContain("https://x/cb");
  });
});
