// k6 contention test: many virtual users race to book the SAME day, so most attempts collide.
// Purpose: show that the booking endpoint stays correct and fast when the database rejects
// conflicting inserts (409), and verify afterwards (SQL in README) that no slot was double-booked.
//   k6 run -e BASE_URL=... -e SERVICE_ID=... -e DAY=YYYY-MM-DD loadtest/contention.js
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3100";
const SLUG = __ENV.SLUG || "shear-bliss";
const SERVICE_ID = __ENV.SERVICE_ID;
const DAY = __ENV.DAY;

const bookingDuration = new Trend("booking_req_duration", true);
const errors = new Rate("booking_errors");
const created = new Counter("bookings_created");
const conflicts = new Counter("booking_conflicts_409");

export const options = {
  scenarios: { race: { executor: "constant-vus", vus: 30, duration: "20s" } },
  thresholds: { booking_errors: ["rate<0.01"] },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  const avail = http.get(
    `${BASE_URL}/api/public/${SLUG}/availability?serviceId=${SERVICE_ID}&from=${DAY}&to=${DAY}`,
  );
  const slots = avail.status === 200 ? avail.json("slots") : [];
  if (!slots || slots.length === 0) return; // day sold out
  // Everyone prefers the first few slots of the day, maximizing collisions.
  const slot = slots[Math.floor(Math.random() * Math.min(3, slots.length))];
  const id = `${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${BASE_URL}/api/public/${SLUG}/bookings`,
    JSON.stringify({
      serviceId: SERVICE_ID,
      start: slot.start,
      name: `Race ${id}`,
      email: `race+${id}@example.com`,
    }),
    { headers: { "content-type": "application/json" } },
  );
  bookingDuration.add(res.timings.duration);
  if (res.status === 201) created.add(1);
  if (res.status === 409) conflicts.add(1);
  errors.add(res.status !== 201 && res.status !== 409);
  check(res, { "201 or 409": (r) => r.status === 201 || r.status === 409 });
}

export function handleSummary(data) {
  if (!data.metrics.booking_req_duration)
    return { stdout: "\ncontention: day already sold out, no bookings attempted\n" };
  const d = data.metrics.booking_req_duration.values;
  const m = data.metrics;
  const n = (k) => (m[k] ? m[k].values.count : 0);
  return {
    "loadtest/results/contention-summary.json": JSON.stringify(data, null, 2),
    stdout: `\ncontention: ${n("bookings_created")} created, ${n("booking_conflicts_409")} conflicts (409), p50 ${d.med.toFixed(1)}ms, p95 ${d["p(95)"].toFixed(1)}ms, p99 ${d["p(99)"].toFixed(1)}ms, error rate ${(m.booking_errors.values.rate * 100).toFixed(2)}%\n`,
  };
}
