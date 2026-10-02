// k6 load test: public slot-availability endpoint.
//   k6 run -e BASE_URL=http://localhost:3100 -e SLUG=shear-bliss -e SERVICE_ID=... loadtest/availability.js
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3100";
const SLUG = __ENV.SLUG || "shear-bliss";
const SERVICE_ID = __ENV.SERVICE_ID;

export const options = {
  scenarios: {
    availability: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 50 },
        { duration: "60s", target: 50 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function isoDate(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

export default function () {
  const day = isoDate(1 + Math.floor(Math.random() * 30));
  const staff = Math.random() < 0.5 ? "" : "&staffId=any";
  const res = http.get(
    `${BASE_URL}/api/public/${SLUG}/availability?serviceId=${SERVICE_ID}&from=${day}&to=${day}${staff}`,
    {
      tags: { name: "GET /api/public/[slug]/availability" },
    },
  );
  check(res, {
    "status 200": (r) => r.status === 200,
    "has slots array": (r) => Array.isArray(r.json("slots")),
  });
}

export function handleSummary(data) {
  return {
    "loadtest/results/availability-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const d = data.metrics.http_req_duration.values;
  const f = data.metrics.http_req_failed.values;
  const r = data.metrics.http_reqs.values;
  return `\navailability: ${r.count} requests, ${r.rate.toFixed(1)} req/s, p50 ${d.med.toFixed(1)}ms, p95 ${d["p(95)"].toFixed(1)}ms, p99 ${d["p(99)"].toFixed(1)}ms, error rate ${(f.rate * 100).toFixed(2)}%\n`;
}
