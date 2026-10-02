"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { cn } from "@/lib/utils";

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function ManageBooking({
  token,
  timezone,
  today,
  canReschedule,
  cancelNote,
  cancelAction,
  rescheduleAction,
}: {
  token: string;
  timezone: string;
  today: string;
  canReschedule: boolean;
  cancelNote: string;
  cancelAction: (prev: ActionResult | null) => Promise<ActionResult>;
  rescheduleAction: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
}) {
  const [cancelState, cancelForm, cancelling] = useActionState(cancelAction, null);
  const [resState, resForm, moving] = useActionState(rescheduleAction, null);
  const [date, setDate] = useState(addDays(today, 1));
  const [slots, setSlots] = useState<Array<{ start: string }> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i + 1)), [today]);
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
    if (!canReschedule) return;
    setSlots(null);
    setSelected(null);
    fetch(`/api/manage/${encodeURIComponent(token)}/availability?date=${date}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => setSlots(j.slots ?? []))
      .catch(() => setSlots([]));
  }, [date, token, canReschedule]);

  const done = cancelState?.ok ? cancelState : resState?.ok ? resState : null;
  if (done) {
    return (
      <div
        role="status"
        className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900"
      >
        {done.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {canReschedule && (
        <section aria-labelledby="reschedule-h" className="flex flex-col gap-3">
          <h2 id="reschedule-h" className="text-lg font-semibold">
            Reschedule
          </h2>
          <div role="radiogroup" aria-label="New date" className="flex gap-2 overflow-x-auto pb-2">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={d === date}
                onClick={() => setDate(d)}
                className={cn(
                  "shrink-0 rounded-md border px-3 py-2 text-sm",
                  d === date ? "border-brand bg-brand text-white" : "border-slate-300 bg-white",
                )}
              >
                {dayFmt.format(new Date(`${d}T12:00:00Z`))}
              </button>
            ))}
          </div>
          <form action={resForm} className="flex flex-col gap-3">
            <div aria-live="polite" className="min-h-10">
              {slots === null ? (
                <p className="text-sm text-slate-600">Loading…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-slate-600">No times available that day.</p>
              ) : (
                <div
                  role="radiogroup"
                  aria-label="New time"
                  className="grid grid-cols-3 gap-2 sm:grid-cols-5"
                >
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      role="radio"
                      aria-checked={selected === s.start}
                      onClick={() => setSelected(s.start)}
                      className={cn(
                        "rounded-md border px-2 py-2 text-sm",
                        selected === s.start
                          ? "border-brand bg-brand text-white"
                          : "border-slate-300 bg-white",
                      )}
                    >
                      {timeFmt.format(new Date(s.start))}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input type="hidden" name="start" value={selected ?? ""} />
            {resState && !resState.ok && (
              <p role="alert" className="text-sm text-red-700">
                {resState.error}
              </p>
            )}
            <button
              type="submit"
              disabled={!selected || moving}
              className="h-11 self-start rounded-md bg-brand px-5 font-semibold text-white disabled:opacity-50"
            >
              {moving ? "Moving…" : "Move my booking"}
            </button>
          </form>
        </section>
      )}

      <section aria-labelledby="cancel-h" className="flex flex-col gap-3">
        <h2 id="cancel-h" className="text-lg font-semibold">
          Cancel
        </h2>
        <p className="text-sm text-slate-700">{cancelNote}</p>
        {cancelState && !cancelState.ok && (
          <p role="alert" className="text-sm text-red-700">
            {cancelState.error}
          </p>
        )}
        {!confirmCancel ? (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="h-11 self-start rounded-md border border-red-300 bg-white px-5 font-semibold text-red-700"
          >
            Cancel booking
          </button>
        ) : (
          <form action={cancelForm} className="flex gap-2">
            <button
              type="submit"
              disabled={cancelling}
              className="h-11 rounded-md bg-red-600 px-5 font-semibold text-white"
            >
              {cancelling ? "Cancelling…" : "Yes, cancel it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="h-11 rounded-md px-5 text-slate-700"
            >
              Keep it
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
