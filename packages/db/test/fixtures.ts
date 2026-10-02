import { prisma } from "../src/client";

const TABLES = [
  "Booking",
  "Customer",
  "StaffService",
  "TimeOff",
  "WeeklyAvailability",
  "StaffMember",
  "Service",
  "Membership",
  "Tenant",
  "Session",
  "Account",
  "VerificationToken",
  "User",
  "ProcessedWebhookEvent",
  "EmailLog",
];

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

let seq = 0;

export interface TenantFixture {
  tenant: { id: string; slug: string; timezone: string };
  serviceId: string;
  staffIds: string[];
  ownerId: string;
}

/**
 * A tenant with one 60-minute service ($50, $10 deposit, 15 min buffer) and `staffCount` staff
 * members who work 09:00-17:00 local every day and can perform the service.
 */
export async function createTenantFixture(opts: {
  plan?: "FREE" | "PRO";
  staffCount?: number;
  timezone?: string;
  depositCents?: number;
  bufferMin?: number;
} = {}): Promise<TenantFixture> {
  seq++;
  const plan = opts.plan ?? "PRO";
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${seq}`,
      slug: `tenant-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      timezone: opts.timezone ?? "America/New_York",
      plan,
      subscriptionStatus: plan === "PRO" ? "ACTIVE" : "NONE",
    },
  });
  const owner = await prisma.user.create({ data: { email: `owner${seq}-${tenant.id}@example.com`, name: "Owner" } });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: "OWNER" } });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: "Haircut",
      durationMin: 60,
      bufferMin: opts.bufferMin ?? 15,
      priceCents: 5000,
      depositCents: opts.depositCents ?? 1000,
    },
  });
  const staffIds: string[] = [];
  for (let i = 0; i < (opts.staffCount ?? 1); i++) {
    const s = await prisma.staffMember.create({ data: { tenantId: tenant.id, name: `Staff ${i + 1}` } });
    staffIds.push(s.id);
    await prisma.weeklyAvailability.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        tenantId: tenant.id,
        staffId: s.id,
        weekday,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      })),
    });
    await prisma.staffService.create({ data: { tenantId: tenant.id, staffId: s.id, serviceId: service.id } });
  }
  return { tenant, serviceId: service.id, staffIds, ownerId: owner.id };
}

/** A fixed "now" well before the test slots, so lead-time rules never interfere. */
export const NOW = new Date("2030-03-01T12:00:00Z");
/** 10:00 New York time on a Monday after NOW (EST, UTC-5). */
export const SLOT = new Date("2030-03-04T15:00:00Z");

export const customer = (i = 0) => ({ name: `Customer ${i}`, email: `c${i}@example.com`, phone: "", notes: "" });
