// k6 load test: public booking endpoint (creates real slot holds).
// Each iteration reads availability for a random day (2..DAYS+1 ahead), picks a random open slot,
// and books it. Default pacing (10/s for 60s) stays below the seeded calendar's capacity so
// later iterations aren't starved of slots; see contention.js for the race-heavy variant.
// 409 SLOT_UNAVAILABLE is the *correct* answer when two virtual users race for the same slot;
// it is tracked separately and not counted as an error. Errors = anything else non-2xx.
//   k6 run -e BASE_URL=http://localhost:3100 -e SLUG=shear-bliss -e SERVICE_ID=... loadtest/booking.js
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3100";
const SLUG = __ENV.SLUG || "shear-bliss";
const SERVICE_ID = __ENV.SERVICE_ID;

const bookingDuration = new Trend("booking_req_duration", true);
const bookingErrors = new Rate("booking_errors");
const created = new Counter("bookings_created");
const conflicts = new Counter("booking_conflicts_409");
const noSlots = new Counter("iterations_no_open_slot");
const RATE = Number(__ENV.RATE || 10);
const DAYS = Number(__ENV.DAYS || 85);

export const options = {
  scenarios: {
    booking: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 40,
      maxVUs: 100,
    },
  },
  thresholds: {
    booking_errors: ["rate<0.01"],
    booking_req_duration: ["p(95)<1000"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  const day = new Date(Date.now() + (2 + Math.floor(Math.random() * DAYS)) * 86400000)
    .toISOString()
    .slice(0, 10);
  const avail = http.get(
    `${BASE_URL}/api/public/${SLUG}/availability?serviceId=${SERVICE_ID}&from=${day}&to=${day}`,
    {
      tags: { name: "GET availability (booking flow)" },
    },
  );
  const slots = avail.status === 200 ? avail.json("slots") : [];
  if (!slots || slots.length === 0) {
    noSlots.add(1);
    return;
  }
  const slot = slots[Math.floor(Math.random() * slots.length)];
  const id = `${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${BASE_URL}/api/public/${SLUG}/bookings`,
    JSON.stringify({
      serviceId: SERVICE_ID,
      start: slot.start,
      name: `Load Test ${id}`,
      email: `load+${id}@example.com`,
    }),
    {
      headers: { "content-type": "application/json" },
      tags: { name: "POST /api/public/[slug]/bookings" },
    },
  );
  bookingDuration.add(res.timings.duration);
  if (res.status === 201) created.add(1);
  if (res.status === 409) conflicts.add(1);
  bookingErrors.add(res.status !== 201 && res.status !== 409);
  check(res, { "201 created or 409 slot taken": (r) => r.status === 201 || r.status === 409 });
}

export function handleSummary(data) {
  const d = data.metrics.booking_req_duration.values;
  const m = data.metrics;
  const n = (k) => (m[k] ? m[k].values.count : 0);
  const line = `\nbooking: ${n("bookings_created")} created, ${n("booking_conflicts_409")} conflicts (409), ${n("iterations_no_open_slot")} found no open slot, p50 ${d.med.toFixed(1)}ms, p95 ${d["p(95)"].toFixed(1)}ms, p99 ${d["p(99)"].toFixed(1)}ms, error rate ${(m.booking_errors.values.rate * 100).toFixed(2)}%\n`;
  return {
    [`loadtest/results/${__ENV.OUT || "booking"}-summary.json`]: JSON.stringify(data, null, 2),
    stdout: line,
  };
}
