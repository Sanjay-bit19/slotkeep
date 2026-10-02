/**
 * Seeds two demo tenants with realistic data. Idempotent: re-running deletes and recreates them.
 *
 *   Shear Bliss Salon (shear-bliss)   New York, Pro plan, 3 staff, 4 services
 *   BrightPath Tutoring (brightpath)  Los Angeles, Free plan, 1 staff, 3 services
 *
 * Bookings span the last 10 weeks and the next 2. They're placed with the real availability
 * engine, so they respect hours, buffers and the exclusion constraint. A seeded PRNG keeps the
 * data identical between runs.
 */
import {
  addDaysToLocalDate,
  addMinutes,
  computeSlots,
  eachLocalDate,
  localDayBounds,
  toLocalDate,
  type StaffSchedule,
} from "@slotkeep/core";
import { PrismaClient, type BookingStatus } from "@prisma/client";

const prisma = new PrismaClient();

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261002);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

const FIRST = [
  "Ava",
  "Liam",
  "Noah",
  "Emma",
  "Olivia",
  "Elijah",
  "Sophia",
  "Mateo",
  "Isabella",
  "Lucas",
  "Mia",
  "Amir",
  "Zoe",
  "Ethan",
  "Chloe",
  "Kenji",
  "Aisha",
  "Diego",
  "Hana",
  "Omar",
  "Grace",
  "Leo",
  "Nora",
  "Ravi",
];
const LAST = [
  "Johnson",
  "Nguyen",
  "Garcia",
  "Smith",
  "Kim",
  "Martinez",
  "Brown",
  "Lee",
  "Patel",
  "Davis",
  "Lopez",
  "Wilson",
  "Cohen",
  "Okafor",
  "Silva",
  "Rossi",
];

type Hours = Array<[number, number, number]>; // weekday, startMinute, endMinute
const h = (hh: number, mm = 0) => hh * 60 + mm;
const weekdays = (start: number, end: number, days = [1, 2, 3, 4, 5]): Hours =>
  days.map((d) => [d, start, end]);

interface TenantSpec {
  name: string;
  slug: string;
  timezone: string;
  brandColor: string;
  plan: "FREE" | "PRO";
  owner: { email: string; name: string };
  staffUsers: Array<{ email: string; name: string }>;
  services: Array<{
    name: string;
    description: string;
    durationMin: number;
    bufferMin: number;
    priceCents: number;
    depositCents: number;
  }>;
  staff: Array<{ name: string; email: string; hours: Hours; services: string[] }>;
  bookingsPerDay: [number, number];
}

const TENANTS: TenantSpec[] = [
  {
    name: "Shear Bliss Salon",
    slug: "shear-bliss",
    timezone: "America/New_York",
    brandColor: "#be185d",
    plan: "PRO",
    owner: { email: "owner@shearbliss.demo", name: "Dana Whitfield" },
    staffUsers: [{ email: "staff@shearbliss.demo", name: "Maya Chen" }],
    services: [
      {
        name: "Women's Cut & Style",
        description: "Consultation, wash, cut and blow-dry.",
        durationMin: 60,
        bufferMin: 15,
        priceCents: 6500,
        depositCents: 1500,
      },
      {
        name: "Men's Cut",
        description: "Classic or modern cut, includes wash.",
        durationMin: 30,
        bufferMin: 10,
        priceCents: 3500,
        depositCents: 1000,
      },
      {
        name: "Full Color",
        description: "Single-process color with gloss.",
        durationMin: 120,
        bufferMin: 15,
        priceCents: 14000,
        depositCents: 4000,
      },
      {
        name: "Blowout",
        description: "Wash and styled blow-dry.",
        durationMin: 45,
        bufferMin: 5,
        priceCents: 4500,
        depositCents: 0,
      },
    ],
    staff: [
      {
        name: "Maya Chen",
        email: "staff@shearbliss.demo",
        hours: weekdays(h(9), h(17), [2, 3, 4, 5, 6]),
        services: ["Women's Cut & Style", "Full Color", "Blowout"],
      },
      {
        name: "Jordan Reyes",
        email: "jordan@shearbliss.demo",
        hours: [...weekdays(h(11), h(19), [1, 2, 3, 4]), [6, h(9), h(14)]],
        services: ["Men's Cut", "Women's Cut & Style", "Blowout"],
      },
      {
        name: "Priya Patel",
        email: "priya@shearbliss.demo",
        hours: weekdays(h(10), h(18), [3, 4, 5, 6]),
        services: ["Full Color", "Women's Cut & Style"],
      },
    ],
    bookingsPerDay: [3, 7],
  },
  {
    name: "BrightPath Tutoring",
    slug: "brightpath",
    timezone: "America/Los_Angeles",
    brandColor: "#0f766e",
    plan: "FREE",
    owner: { email: "owner@brightpath.demo", name: "Sam Okafor" },
    staffUsers: [],
    services: [
      {
        name: "Math Tutoring (60 min)",
        description: "Algebra through calculus, one-on-one.",
        durationMin: 60,
        bufferMin: 10,
        priceCents: 6000,
        depositCents: 2000,
      },
      {
        name: "SAT Prep (90 min)",
        description: "Strategy plus timed practice sections.",
        durationMin: 90,
        bufferMin: 15,
        priceCents: 9500,
        depositCents: 2500,
      },
      {
        name: "Free Consultation",
        description: "Meet and plan your goals.",
        durationMin: 30,
        bufferMin: 0,
        priceCents: 0,
        depositCents: 0,
      },
    ],
    staff: [
      {
        name: "Sam Okafor",
        email: "owner@brightpath.demo",
        hours: [...weekdays(h(15), h(20), [1, 2, 3, 4]), [6, h(9), h(13)]],
        services: ["Math Tutoring (60 min)", "SAT Prep (90 min)", "Free Consultation"],
      },
    ],
    bookingsPerDay: [0, 2],
  },
];

async function seedTenant(spec: TenantSpec, now: Date) {
  await prisma.tenant.deleteMany({ where: { slug: spec.slug } });
  const tenant = await prisma.tenant.create({
    data: {
      name: spec.name,
      slug: spec.slug,
      timezone: spec.timezone,
      brandColor: spec.brandColor,
      plan: spec.plan,
      subscriptionStatus: spec.plan === "PRO" ? "ACTIVE" : "NONE",
      currentPeriodEnd: spec.plan === "PRO" ? new Date(now.getTime() + 20 * 86_400_000) : null,
      stripeCustomerId: spec.plan === "PRO" ? `cus_demo_${spec.slug}` : null,
      stripeSubscriptionId: spec.plan === "PRO" ? `sub_demo_${spec.slug}` : null,
    },
  });
  const owner = await prisma.user.upsert({
    where: { email: spec.owner.email },
    update: { name: spec.owner.name },
    create: { ...spec.owner, emailVerified: now },
  });
  await prisma.membership.create({
    data: { tenantId: tenant.id, userId: owner.id, role: "OWNER" },
  });
  for (const su of spec.staffUsers) {
    const u = await prisma.user.upsert({
      where: { email: su.email },
      update: { name: su.name },
      create: { ...su, emailVerified: now },
    });
    await prisma.membership.create({ data: { tenantId: tenant.id, userId: u.id, role: "STAFF" } });
  }

  const services = new Map<string, Awaited<ReturnType<typeof prisma.service.create>>>();
  for (const s of spec.services)
    services.set(s.name, await prisma.service.create({ data: { tenantId: tenant.id, ...s } }));

  const staff: Array<{ id: string; spec: TenantSpec["staff"][number] }> = [];
  for (const s of spec.staff) {
    const row = await prisma.staffMember.create({
      data: { tenantId: tenant.id, name: s.name, email: s.email },
    });
    await prisma.weeklyAvailability.createMany({
      data: s.hours.map(([weekday, startMinute, endMinute]) => ({
        tenantId: tenant.id,
        staffId: row.id,
        weekday,
        startMinute,
        endMinute,
      })),
    });
    await prisma.staffService.createMany({
      data: s.services.map((n) => ({
        tenantId: tenant.id,
        staffId: row.id,
        serviceId: services.get(n)!.id,
      })),
    });
    staff.push({ id: row.id, spec: s });
  }
  // A week of vacation for the first staff member, three weeks out.
  const vacStart = addDaysToLocalDate(toLocalDate(now, spec.timezone), 21);
  await prisma.timeOff.create({
    data: {
      tenantId: tenant.id,
      staffId: staff[0]!.id,
      startAt: localDayBounds(vacStart, spec.timezone).start,
      endAt: localDayBounds(addDaysToLocalDate(vacStart, 3), spec.timezone).start,
      reason: "Vacation",
    },
  });

  const customers = [];
  for (let i = 0; i < 40; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    customers.push(
      await prisma.customer.upsert({
        where: {
          tenantId_email: {
            tenantId: tenant.id,
            email: `${first}.${last}${i}@example.com`.toLowerCase(),
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          name: `${first} ${last}`,
          email: `${first}.${last}${i}@example.com`.toLowerCase(),
          phone: `+1555${String(1000000 + i * 7919).slice(-7)}`,
        },
      }),
    );
  }

  const today = toLocalDate(now, spec.timezone);
  const busy = new Map<string, Array<{ start: Date; end: Date }>>(staff.map((s) => [s.id, []]));
  let created = 0;
  const monthStart = toLocalDate(now, spec.timezone).slice(0, 8) + "01";
  let thisMonth = 0;

  for (const day of eachLocalDate(addDaysToLocalDate(today, -70), addDaysToLocalDate(today, 14))) {
    const target =
      spec.bookingsPerDay[0] +
      Math.floor(rand() * (spec.bookingsPerDay[1] - spec.bookingsPerDay[0] + 1));
    for (let n = 0; n < target; n++) {
      const svcSpec = pick(spec.services);
      const service = services.get(svcSpec.name)!;
      const schedules: StaffSchedule[] = staff
        .filter((s) => s.spec.services.includes(svcSpec.name))
        .map((s) => ({
          staffId: s.id,
          weekly: s.spec.hours.map(([weekday, startMinute, endMinute]) => ({
            weekday,
            startMinute,
            endMinute,
          })),
          timeOff: [],
          busy: busy.get(s.id)!,
        }));
      const slots = computeSlots({
        timezone: spec.timezone,
        fromDate: day,
        toDate: day,
        durationMin: service.durationMin,
        bufferMin: service.bufferMin,
        staff: schedules,
        now: new Date(0),
        stepMin: 15,
      });
      if (!slots.length) continue;
      const slot = pick(slots);
      const staffId = pick(slot.staffIds);
      const startAt = slot.start;
      const endAt = addMinutes(startAt, service.durationMin);
      const blockedUntil = addMinutes(endAt, service.bufferMin);
      const past = startAt < now;
      const r = rand();
      let status: BookingStatus;
      if (past) status = r < 0.08 ? "NO_SHOW" : r < 0.15 ? "CANCELLED" : "COMPLETED";
      else status = r < 0.07 ? "CANCELLED" : "CONFIRMED";

      const createdAt = new Date(
        Math.min(now.getTime(), startAt.getTime() - (1 + Math.floor(rand() * 10)) * 86_400_000),
      );
      if (spec.plan === "FREE" && createdAt >= localDayBounds(monthStart, spec.timezone).start) {
        if (thisMonth >= 40) continue; // stay under the 50/month free cap
        thisMonth++;
      }
      const paid = service.depositCents;
      const refunded = status === "CANCELLED" && rand() < 0.7 ? paid : 0;
      busy
        .get(staffId)!
        .push({ start: startAt, end: status === "CANCELLED" ? startAt : blockedUntil });
      await prisma.booking.create({
        data: {
          tenantId: tenant.id,
          serviceId: service.id,
          staffId,
          customerId: pick(customers).id,
          startAt,
          endAt,
          blockedUntil,
          status,
          priceCents: service.priceCents,
          depositCents: service.depositCents,
          depositPaidCents: paid,
          refundedCents: refunded,
          stripePaymentIntentId: paid ? `pi_demo_${tenant.slug}_${created}` : null,
          stripeRefundId: refunded ? `re_demo_${tenant.slug}_${created}` : null,
          confirmedAt: createdAt,
          cancelledAt:
            status === "CANCELLED"
              ? new Date(Math.min(now.getTime(), startAt.getTime() - 3_600_000))
              : null,
          cancelReason: status === "CANCELLED" ? pick(["CUSTOMER", "OWNER"]) : null,
          createdAt,
        },
      });
      created++;
    }
  }
  console.log(
    `  ${spec.name}: ${staff.length} staff, ${services.size} services, ${created} bookings`,
  );
}

async function main() {
  const now = new Date();
  console.log("Seeding demo tenants...");
  for (const t of TENANTS) await seedTenant(t, now);
  console.log("Done. Demo logins (magic link via /dev/mailbox, or DEMO_LOGIN_ENABLED=true):");
  console.log(
    "  owner@shearbliss.demo (owner), staff@shearbliss.demo (staff), owner@brightpath.demo (owner)",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
