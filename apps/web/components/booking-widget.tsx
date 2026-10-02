"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBookingSchema } from "@slotkeep/core/booking-schemas";
import { cn } from "@/lib/utils";

export interface WidgetService {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
  depositCents: number;
  currency: string;
}
export interface WidgetStaff {
  id: string;
  name: string;
  serviceIds: string[];
}
interface Slot {
  start: string;
  end: string;
  staffIds: string[];
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

/** Adds days to a YYYY-MM-DD string without involving local time zones. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function BookingWidget({
  slug,
  timezone,
  today,
  services,
  staff,
}: {
  slug: string;
  timezone: string;
  /** Today's date in the business timezone (computed on the server to avoid hydration drift). */
  today: string;
  services: WidgetService[];
  staff: WidgetStaff[];
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [staffId, setStaffId] = useState("any");
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const detailsRef = useRef<HTMLHeadingElement>(null);

  const service = services.find((s) => s.id === serviceId);
  const eligibleStaff = useMemo(
    () => staff.filter((s) => s.serviceIds.includes(serviceId)),
    [staff, serviceId],
  );
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const tzLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? timezone,
    [timezone],
  );
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }),
    [timezone],
  );
  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [],
  );

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cancelled")) {
      setBanner({
        kind: "info",
        text: "Checkout was cancelled. Your slot will be released shortly; you can pick a time again.",
      });
    }
  }, []);

  const loadSlots = useCallback(async () => {
    if (!serviceId) return;
    setLoadingSlots(true);
    setSlot(null);
    try {
      const qs = new URLSearchParams({ serviceId, from: date, to: date });
      if (staffId !== "any") qs.set("staffId", staffId);
      const res = await fetch(`/api/public/${slug}/availability?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Could not load times");
      setSlots(json.slots);
    } catch (err) {
      setSlots([]);
      setBanner({ kind: "error", text: (err as Error).message });
    } finally {
      setLoadingSlots(false);
    }
  }, [serviceId, staffId, date, slug]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slot || !service) return;
    setBanner(null);
    const payload = {
      ...form,
      serviceId,
      staffId: staffId === "any" ? undefined : staffId,
      start: slot.start,
    };
    const parsed = createBookingSchema.safeParse(payload);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/${slug}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json?.error?.fieldErrors) {
          const errs: Record<string, string> = {};
          for (const [k, v] of Object.entries(json.error.fieldErrors as Record<string, string[]>))
            errs[k] = v[0]!;
          setErrors(errs);
        }
        setBanner({ kind: "error", text: json?.error?.message ?? "Booking failed" });
        if (res.status === 409) void loadSlots();
        setSubmitting(false);
        return;
      }
      window.location.assign(json.checkoutUrl ?? json.redirectUrl);
    } catch {
      setBanner({ kind: "error", text: "Network error. Please try again." });
      setSubmitting(false);
    }
  }

  if (services.length === 0) {
    return (
      <p className="rounded-lg bg-white p-6 text-slate-700">
        This business isn&apos;t taking online bookings yet.
      </p>
    );
  }

  const field = (
    key: keyof typeof form,
    label: string,
    type = "text",
    autoComplete?: string,
    required = true,
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`f-${key}`} className="text-sm font-medium text-slate-800">
        {label}
        {!required && <span className="font-normal text-slate-600"> (optional)</span>}
      </label>
      <input
        id={`f-${key}`}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `f-${key}-err` : undefined}
        className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 aria-[invalid=true]:border-red-600"
      />
      {errors[key] && (
        <p id={`f-${key}-err`} className="text-sm text-red-700">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {banner && (
        <div
          role={banner.kind === "error" ? "alert" : "status"}
          className={cn(
            "rounded-md border px-4 py-3 text-sm",
            banner.kind === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-sky-200 bg-sky-50 text-sky-900",
          )}
        >
          {banner.text}
        </div>
      )}

      <fieldset>
        <legend className="mb-3 text-lg font-semibold text-slate-900">1. Choose a service</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((s) => (
            <label
              key={s.id}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border bg-white p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
                s.id === serviceId ? "border-brand ring-2 ring-brand" : "border-slate-200",
              )}
            >
              <input
                type="radio"
                name="service"
                value={s.id}
                checked={s.id === serviceId}
                onChange={() => {
                  setServiceId(s.id);
                  setStaffId("any");
                }}
                className="sr-only"
              />
              <span className="font-medium text-slate-900">{s.name}</span>
              <span className="text-sm text-slate-700">
                {s.durationMin} min · {money(s.priceCents, s.currency)}
                {s.depositCents > 0
                  ? ` · ${money(s.depositCents, s.currency)} deposit`
                  : " · no deposit"}
              </span>
              {s.description && <span className="text-sm text-slate-600">{s.description}</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="staff" className="text-lg font-semibold text-slate-900">
          2. Who with?
        </label>
        <select
          id="staff"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          className="h-11 max-w-xs rounded-md border border-slate-300 bg-white px-3 text-base"
        >
          <option value="any">Anyone available</option>
          {eligibleStaff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <section aria-labelledby="when-heading">
        <h2 id="when-heading" className="mb-3 text-lg font-semibold text-slate-900">
          3. Pick a time <span className="text-sm font-normal text-slate-600">({tzLabel})</span>
        </h2>
        <div role="radiogroup" aria-label="Date" className="flex gap-2 overflow-x-auto pb-2">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={d === date}
              onClick={() => setDate(d)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-2 text-sm",
                d === date
                  ? "border-brand bg-brand text-white"
                  : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
              )}
            >
              {dayFmt.format(new Date(`${d}T12:00:00Z`))}
            </button>
          ))}
        </div>
        <div aria-live="polite" aria-busy={loadingSlots} className="mt-3 min-h-16">
          {loadingSlots ? (
            <p className="text-sm text-slate-600">Loading available times…</p>
          ) : slots && slots.length === 0 ? (
            <p className="text-sm text-slate-600">
              No times available on this day. Try another date.
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label="Available times"
              className="grid grid-cols-3 gap-2 sm:grid-cols-5"
            >
              {slots?.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  role="radio"
                  aria-checked={slot?.start === s.start}
                  onClick={() => {
                    setSlot(s);
                    requestAnimationFrame(() =>
                      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
                    );
                  }}
                  className={cn(
                    "rounded-md border px-2 py-2 text-sm font-medium",
                    slot?.start === s.start
                      ? "border-brand bg-brand text-white"
                      : "border-slate-300 bg-white text-slate-900 hover:border-brand",
                  )}
                >
                  {timeFmt.format(new Date(s.start))}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {slot && service && (
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5"
          aria-labelledby="details-heading"
        >
          <h2
            id="details-heading"
            ref={detailsRef}
            tabIndex={-1}
            className="text-lg font-semibold text-slate-900"
          >
            4. Your details
          </h2>
          <p className="text-sm text-slate-700">
            {service.name} on{" "}
            {new Intl.DateTimeFormat("en-US", {
              timeZone: timezone,
              dateStyle: "full",
              timeStyle: "short",
            }).format(new Date(slot.start))}{" "}
            ({tzLabel})
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("name", "Full name", "text", "name")}
            {field("email", "Email", "email", "email")}
            {field("phone", "Phone", "tel", "tel", false)}
            {field("notes", "Notes for the business", "text", "off", false)}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="h-12 rounded-md bg-brand px-6 text-base font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {submitting
              ? "Reserving your time…"
              : service.depositCents > 0
                ? `Continue to pay ${money(service.depositCents, service.currency)} deposit`
                : "Confirm booking"}
          </button>
          {service.depositCents > 0 && (
            <p className="text-xs text-slate-600">
              Your time is held for 10 minutes while you pay. The deposit counts toward the total
              price.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
