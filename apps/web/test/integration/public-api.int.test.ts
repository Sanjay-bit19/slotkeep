import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@slotkeep/db";
import { resetEnvCache } from "@slotkeep/infra";
import { GET as availability } from "@/app/api/public/[slug]/availability/route";
import { POST as book } from "@/app/api/public/[slug]/bookings/route";
import { GET as health } from "@/app/api/health/route";
import { createTenantFixture, resetDb } from "../../../../packages/db/test/fixtures";
import { closeQueues, flushRedis, jobIds, QUEUE_NAMES } from "./helpers";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
import { addDaysToLocalDate, toLocalDate, wallTimeToUtc } from "@slotkeep/core";

// Inside the 90-day booking horizon, far enough out that lead time never matters.
const DAY = addDaysToLocalDate(toLocalDate(new Date(), "America/New_York"), 45);
const NINE_AM = wallTimeToUtc(DAY, 9 * 60, "America/New_York").toISOString();
const nextYear = new Date().getUTCFullYear() + 1;

function availReq(slug: string, q: Record<string, string>, ip = "10.0.0.1") {
  return new Request(`http://localhost/api/public/${slug}/availability?${new URLSearchParams(q)}`, {
    headers: { "x-forwarded-for": ip },
  });
}
function bookReq(slug: string, body: unknown, ip = "10.0.0.1") {
  return new Request(`http://localhost/api/public/${slug}/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
  await flushRedis();
});
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

describe("GET /api/public/[slug]/availability", () => {
  it("returns open slots in UTC with the tenant timezone", async () => {
    const fx = await createTenantFixture();
    const res = await availability(
      availReq(fx.tenant.slug, { serviceId: fx.serviceId, from: DAY, to: DAY }),
      params(fx.tenant.slug),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.timezone).toBe("America/New_York");
    // 09:00-17:00 EDT, 60 min + 15 min buffer, 15 min step: 09:00 ... 15:45 => 28 slots.
    expect(json.slots).toHaveLength(28);
    expect(json.slots[0].start).toBe(NINE_AM);
  });

  it("validates input and caps the range", async () => {
    const fx = await createTenantFixture();
    expect(
      (
        await availability(
          availReq(fx.tenant.slug, { serviceId: fx.serviceId, from: "nope" }),
          params(fx.tenant.slug),
        )
      ).status,
    ).toBe(400);
    const res = await availability(
      availReq(fx.tenant.slug, {
        serviceId: fx.serviceId,
        from: `${nextYear}-06-01`,
        to: `${nextYear}-06-30`,
      }),
      params(fx.tenant.slug),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("RANGE_TOO_LARGE");
  });

  it("returns no slots beyond the booking horizon", async () => {
    const fx = await createTenantFixture();
    const far = `${nextYear + 1}-01-10`;
    const res = await availability(
      availReq(fx.tenant.slug, { serviceId: fx.serviceId, from: far, to: far }),
      params(fx.tenant.slug),
    );
    expect((await res.json()).slots).toEqual([]);
  });

  it("404s for unknown tenants and for another tenant's service", async () => {
    const a = await createTenantFixture();
    const b = await createTenantFixture();
    expect(
      (
        await availability(
          availReq("no-such-biz", { serviceId: a.serviceId, from: DAY }),
          params("no-such-biz"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await availability(
          availReq(a.tenant.slug, { serviceId: b.serviceId, from: DAY }),
          params(a.tenant.slug),
        )
      ).status,
    ).toBe(404);
  });
});

describe("POST /api/public/[slug]/bookings", () => {
  const body = (serviceId: string, start: string, i = 0) => ({
    serviceId,
    start,
    name: `Pat ${i}`,
    email: `pat${i}@example.com`,
  });

  it("holds the slot, opens checkout, and schedules hold expiry", async () => {
    const fx = await createTenantFixture();
    const res = await book(
      bookReq(fx.tenant.slug, body(fx.serviceId, NINE_AM)),
      params(fx.tenant.slug),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.kind).toBe("checkout");
    expect(json.checkoutUrl).toMatch(/\/dev\/checkout\/cs_fake_/);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: json.bookingId } });
    expect(b.status).toBe("PENDING_PAYMENT");
    expect(b.stripeCheckoutSessionId).toMatch(/^cs_fake_/);
    expect(await jobIds(QUEUE_NAMES.holds)).toEqual([`hold-${b.id}`]);
  });

  it("confirms immediately for no-deposit services", async () => {
    const fx = await createTenantFixture({ depositCents: 0 });
    const res = await book(
      bookReq(fx.tenant.slug, body(fx.serviceId, NINE_AM)),
      params(fx.tenant.slug),
    );
    const json = await res.json();
    expect(json.kind).toBe("confirmed");
    expect(json.redirectUrl).toContain(`/b/${fx.tenant.slug}/success?t=`);
    expect(await jobIds(QUEUE_NAMES.email)).toContain(`booking-confirmed-${json.bookingId}`);
  });

  it("returns 409 for a taken slot and 400 with field errors for bad input", async () => {
    const fx = await createTenantFixture();
    await book(bookReq(fx.tenant.slug, body(fx.serviceId, NINE_AM, 1)), params(fx.tenant.slug));
    const taken = await book(
      bookReq(fx.tenant.slug, body(fx.serviceId, NINE_AM, 2), "10.0.0.2"),
      params(fx.tenant.slug),
    );
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("SLOT_UNAVAILABLE");
    const bad = await book(
      bookReq(fx.tenant.slug, { serviceId: fx.serviceId, start: "x", name: "", email: "nope" }),
      params(fx.tenant.slug),
    );
    expect(bad.status).toBe(400);
    expect(Object.keys((await bad.json()).error.fieldErrors)).toEqual(
      expect.arrayContaining(["start", "name", "email"]),
    );
  });

  it("rate limits booking creation per IP (429 with Retry-After)", async () => {
    process.env.RATE_LIMIT_DISABLED = "false";
    resetEnvCache();
    try {
      const fx = await createTenantFixture();
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await book(
          bookReq(
            fx.tenant.slug,
            { serviceId: fx.serviceId, start: "bad", name: "x", email: "y" },
            "10.9.9.9",
          ),
          params(fx.tenant.slug),
        );
        statuses.push(res.status);
        if (res.status === 429) expect(res.headers.get("Retry-After")).toBeTruthy();
      }
      expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      // Different IP is unaffected.
      const other = await book(
        bookReq(
          fx.tenant.slug,
          { serviceId: fx.serviceId, start: "bad", name: "x", email: "y" },
          "10.9.9.10",
        ),
        params(fx.tenant.slug),
      );
      expect(other.status).toBe(400);
    } finally {
      process.env.RATE_LIMIT_DISABLED = "true";
      resetEnvCache();
    }
  });
});

describe("GET /api/health", () => {
  it("reports database and redis status", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.checks.database.ok).toBe(true);
    expect(json.checks.redis.ok).toBe(true);
  });
});
