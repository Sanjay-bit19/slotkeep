import { describe, expect, it } from "vitest";
import {
  computeSlots,
  isSlotAvailable,
  mergeRanges,
  pickStaff,
  staffSlots,
  validateAvailabilityInput,
  workingWindows,
  type AvailabilityInput,
  type StaffSchedule,
  type WeeklyRule,
} from "../src/availability";

const NY = "America/New_York";
const LONDON = "Europe/London";
const PAST = new Date("2000-01-01T00:00:00Z");

const h = (hh: number, mm = 0) => hh * 60 + mm;
const allWeek = (start: number, end: number): WeeklyRule[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: start, endMinute: end }));

function staff(id: string, over: Partial<StaffSchedule> = {}): StaffSchedule {
  return { staffId: id, weekly: allWeek(h(9), h(17)), timeOff: [], busy: [], ...over };
}

function input(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    timezone: NY,
    fromDate: "2026-06-10",
    toDate: "2026-06-10",
    durationMin: 60,
    bufferMin: 0,
    staff: [staff("s1")],
    now: PAST,
    stepMin: 30,
    ...over,
  };
}

const iso = (d: Date) => d.toISOString();
const starts = (inp: AvailabilityInput) => computeSlots(inp).map((s) => iso(s.start));

describe("computeSlots: basics", () => {
  it("generates slots that fit entirely in the working window", () => {
    // 09:00-17:00 EDT (UTC-4), 60 min service, 30 min step: last start 16:00.
    const s = starts(input());
    expect(s[0]).toBe("2026-06-10T13:00:00.000Z");
    expect(s.at(-1)).toBe("2026-06-10T20:00:00.000Z");
    expect(s).toHaveLength(15);
  });

  it("sets slot end to start + duration (buffer excluded)", () => {
    const [first] = computeSlots(input({ bufferMin: 15 }));
    expect(iso(first!.end)).toBe("2026-06-10T14:00:00.000Z");
  });

  it("returns nothing on a day with no weekly rule", () => {
    // 2026-06-13 is a Saturday; schedule is Mon-Fri only.
    const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      startMinute: h(9),
      endMinute: h(17),
    }));
    expect(
      starts(
        input({
          fromDate: "2026-06-13",
          toDate: "2026-06-13",
          staff: [staff("s1", { weekly: weekdays })],
        }),
      ),
    ).toEqual([]);
  });

  it("interprets weekdays in the tenant timezone, not UTC", () => {
    // Tuesday 2026-06-09 22:00-23:59 in New York is already Wednesday in UTC.
    const tueLate = [{ weekday: 2, startMinute: h(22), endMinute: h(23) }];
    const s = starts(
      input({
        fromDate: "2026-06-09",
        toDate: "2026-06-09",
        staff: [staff("s1", { weekly: tueLate })],
      }),
    );
    expect(s).toEqual(["2026-06-10T02:00:00.000Z"]);
  });

  it("handles split shifts and merges overlapping rules", () => {
    const weekly = [
      { weekday: 3, startMinute: h(9), endMinute: h(11) },
      { weekday: 3, startMinute: h(10), endMinute: h(12) }, // overlaps first
      { weekday: 3, startMinute: h(14), endMinute: h(15) },
    ];
    const s = starts(input({ staff: [staff("s1", { weekly })] }));
    expect(s).toEqual([
      "2026-06-10T13:00:00.000Z",
      "2026-06-10T13:30:00.000Z",
      "2026-06-10T14:00:00.000Z",
      "2026-06-10T14:30:00.000Z",
      "2026-06-10T15:00:00.000Z",
      "2026-06-10T18:00:00.000Z",
    ]);
  });

  it("supports a window that runs to midnight (endMinute 1440)", () => {
    const weekly = [{ weekday: 3, startMinute: h(23), endMinute: 1440 }];
    expect(starts(input({ staff: [staff("s1", { weekly })] }))).toEqual([
      "2026-06-11T03:00:00.000Z",
    ]);
  });

  it("aligns slots to the window start using stepMin", () => {
    const weekly = [{ weekday: 3, startMinute: h(9, 10), endMinute: h(10, 40) }];
    const s = starts(input({ stepMin: 15, durationMin: 30, staff: [staff("s1", { weekly })] }));
    expect(s.map((x) => x.slice(11, 16))).toEqual(["13:10", "13:25", "13:40", "13:55", "14:10"]);
  });

  it("covers a multi-day range in order", () => {
    const s = computeSlots(
      input({ fromDate: "2026-06-10", toDate: "2026-06-12", durationMin: 480 }),
    );
    expect(s.map((x) => iso(x.start))).toEqual([
      "2026-06-10T13:00:00.000Z",
      "2026-06-11T13:00:00.000Z",
      "2026-06-12T13:00:00.000Z",
    ]);
  });

  it("is deterministic for identical input", () => {
    const inp = input({ staff: [staff("b"), staff("a")] });
    expect(computeSlots(inp)).toEqual(computeSlots(inp));
  });
});

describe("computeSlots: existing bookings", () => {
  const busyAt = (startIso: string, endIso: string) => ({
    start: new Date(startIso),
    end: new Date(endIso),
  });

  it("excludes slots overlapping an existing booking", () => {
    const s = starts(
      input({
        staff: [staff("s1", { busy: [busyAt("2026-06-10T15:00:00Z", "2026-06-10T16:00:00Z")] })],
      }),
    );
    expect(s).not.toContain("2026-06-10T14:30:00.000Z"); // 10:30-11:30 overlaps 11:00
    expect(s).not.toContain("2026-06-10T15:00:00.000Z");
    expect(s).not.toContain("2026-06-10T15:30:00.000Z");
    expect(s).toContain("2026-06-10T14:00:00.000Z"); // 10:00-11:00 touches, does not overlap
    expect(s).toContain("2026-06-10T16:00:00.000Z"); // starts exactly when the booking ends
  });

  it("handles overlapping and unsorted busy intervals", () => {
    const busy = [
      busyAt("2026-06-10T18:00:00Z", "2026-06-10T19:00:00Z"),
      busyAt("2026-06-10T13:00:00Z", "2026-06-10T15:00:00Z"),
      busyAt("2026-06-10T14:00:00Z", "2026-06-10T16:30:00Z"),
    ];
    const s = starts(input({ staff: [staff("s1", { busy })] }));
    expect(s).toEqual([
      "2026-06-10T16:30:00.000Z",
      "2026-06-10T17:00:00.000Z",
      "2026-06-10T19:00:00.000Z",
      "2026-06-10T19:30:00.000Z",
      "2026-06-10T20:00:00.000Z",
    ]);
  });

  it("respects an existing booking's buffer (busy.end is blockedUntil)", () => {
    // Booking 10:00-11:00 with 30 min buffer => blocked until 11:30 local.
    const busy = [busyAt("2026-06-10T14:00:00Z", "2026-06-10T15:30:00Z")];
    const s = starts(input({ staff: [staff("s1", { busy })] }));
    expect(s).not.toContain("2026-06-10T15:00:00.000Z");
    expect(s).toContain("2026-06-10T15:30:00.000Z");
  });

  it("requires the new booking's own buffer before the next booking", () => {
    // Next booking at 11:00 local. 60 min service + 15 min buffer starting 10:00 would run to 11:15.
    const busy = [busyAt("2026-06-10T15:00:00Z", "2026-06-10T16:00:00Z")];
    const s = starts(input({ bufferMin: 15, staff: [staff("s1", { busy })] }));
    expect(s).not.toContain("2026-06-10T14:00:00.000Z");
    expect(s).toContain("2026-06-10T13:30:00.000Z"); // 09:30-10:30 (+15 = 10:45) fits
  });

  it("ignores zero-length and inverted intervals", () => {
    const busy = [
      busyAt("2026-06-10T15:00:00Z", "2026-06-10T15:00:00Z"),
      busyAt("2026-06-10T16:00:00Z", "2026-06-10T15:00:00Z"),
    ];
    expect(starts(input({ staff: [staff("s1", { busy })] }))).toHaveLength(15);
  });

  it("is fully booked when busy covers the day", () => {
    const busy = [busyAt("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z")];
    expect(starts(input({ staff: [staff("s1", { busy })] }))).toEqual([]);
  });
});

describe("computeSlots: buffers at day edges", () => {
  it("requires service + buffer to fit before closing", () => {
    // 09:00-17:00, 60 min + 30 min buffer: last start is 15:30 (ends 16:30, blocked to 17:00).
    const s = starts(input({ bufferMin: 30 }));
    expect(s.at(-1)).toBe("2026-06-10T19:30:00.000Z");
    expect(s).not.toContain("2026-06-10T20:00:00.000Z");
  });

  it("returns nothing when service + buffer is longer than the window", () => {
    const weekly = [{ weekday: 3, startMinute: h(9), endMinute: h(10) }];
    expect(starts(input({ bufferMin: 15, staff: [staff("s1", { weekly })] }))).toEqual([]);
  });

  it("lets a previous day's late booking buffer spill into the next morning window", () => {
    // Window 00:00-02:00 local; a booking the night before is blocked until 00:30 local.
    const weekly = allWeek(0, h(2));
    const busy = [
      { start: new Date("2026-06-10T03:00:00Z"), end: new Date("2026-06-10T04:30:00Z") },
    ];
    const s = starts(input({ staff: [staff("s1", { weekly, busy })] }));
    expect(s).toEqual(["2026-06-10T04:30:00.000Z", "2026-06-10T05:00:00.000Z"]);
  });

  it("does not let a slot bridge two adjacent windows", () => {
    const weekly = [
      { weekday: 3, startMinute: h(23), endMinute: 1440 },
      { weekday: 4, startMinute: 0, endMinute: h(1) },
    ];
    const s = starts(
      input({
        fromDate: "2026-06-10",
        toDate: "2026-06-11",
        durationMin: 90,
        staff: [staff("s1", { weekly })],
      }),
    );
    expect(s).toEqual([]);
  });
});

describe("computeSlots: time off", () => {
  it("removes slots overlapping time off", () => {
    const timeOff = [
      { start: new Date("2026-06-10T16:00:00Z"), end: new Date("2026-06-10T17:00:00Z") },
    ];
    const s = starts(input({ staff: [staff("s1", { timeOff })] }));
    expect(s).not.toContain("2026-06-10T15:30:00.000Z");
    expect(s).not.toContain("2026-06-10T16:00:00.000Z");
    expect(s).not.toContain("2026-06-10T16:30:00.000Z");
    expect(s).toContain("2026-06-10T17:00:00.000Z");
  });

  it("removes all slots for a full-day time off spanning midnight boundaries", () => {
    const timeOff = [
      { start: new Date("2026-06-09T12:00:00Z"), end: new Date("2026-06-11T12:00:00Z") },
    ];
    expect(starts(input({ staff: [staff("s1", { timeOff })] }))).toEqual([]);
  });
});

describe("computeSlots: lead time and now", () => {
  it("hides slots that start before now", () => {
    const s = starts(input({ now: new Date("2026-06-10T17:10:00Z") }));
    expect(s[0]).toBe("2026-06-10T17:30:00.000Z");
  });

  it("applies the minimum lead time", () => {
    const s = starts(input({ now: new Date("2026-06-10T13:00:00Z"), minLeadMin: 120 }));
    expect(s[0]).toBe("2026-06-10T15:00:00.000Z");
  });

  it("allows a slot starting exactly at now + lead", () => {
    const s = starts(input({ now: new Date("2026-06-10T14:00:00Z") }));
    expect(s[0]).toBe("2026-06-10T14:00:00.000Z");
  });
});

describe("computeSlots: DST transitions", () => {
  it("New York spring forward (2026-03-08): 09-17 window keeps 8 real hours with shifted offset", () => {
    const s = starts(input({ fromDate: "2026-03-07", toDate: "2026-03-08", durationMin: 480 }));
    // Saturday is EST (UTC-5), Sunday is EDT (UTC-4).
    expect(s).toEqual(["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z"]);
  });

  it("New York spring forward: an overnight 00:00-04:00 window is only 3 real hours", () => {
    const weekly = allWeek(0, h(4));
    const s = computeSlots(
      input({
        fromDate: "2026-03-08",
        toDate: "2026-03-08",
        stepMin: 60,
        staff: [staff("s1", { weekly })],
      }),
    );
    // 00:00 EST = 05:00Z, 04:00 EDT = 08:00Z. Hourly slots at 05Z, 06Z, 07Z. Local 02:00 never exists.
    expect(s.map((x) => iso(x.start))).toEqual([
      "2026-03-08T05:00:00.000Z",
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
    ]);
  });

  it("New York spring forward: a window entirely inside the gap yields nothing", () => {
    const weekly = [{ weekday: 7, startMinute: h(2), endMinute: h(2, 45) }];
    expect(
      starts(
        input({
          fromDate: "2026-03-08",
          toDate: "2026-03-08",
          durationMin: 15,
          staff: [staff("s1", { weekly })],
        }),
      ),
    ).toEqual([]);
  });

  it("New York spring forward: a window starting inside the gap starts when clocks jump", () => {
    // 02:30-04:00 local: 02:30 does not exist; the window starts at 03:00 EDT (07:00Z).
    const weekly = [{ weekday: 7, startMinute: h(2, 30), endMinute: h(4) }];
    const s = starts(
      input({
        fromDate: "2026-03-08",
        toDate: "2026-03-08",
        durationMin: 30,
        staff: [staff("s1", { weekly })],
      }),
    );
    expect(s).toEqual(["2026-03-08T07:00:00.000Z", "2026-03-08T07:30:00.000Z"]);
  });

  it("New York fall back (2026-11-01): an overnight 00:00-04:00 window is 5 real hours", () => {
    const weekly = allWeek(0, h(4));
    const s = computeSlots(
      input({
        fromDate: "2026-11-01",
        toDate: "2026-11-01",
        stepMin: 60,
        staff: [staff("s1", { weekly })],
      }),
    );
    // 00:00 EDT = 04:00Z ... 04:00 EST = 09:00Z. Local 01:00 happens twice.
    expect(s.map((x) => iso(x.start))).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T08:00:00.000Z",
    ]);
  });

  it("New York fall back: business-hours slots move by one hour in UTC", () => {
    const s = starts(input({ fromDate: "2026-10-31", toDate: "2026-11-01", durationMin: 480 }));
    expect(s).toEqual(["2026-10-31T13:00:00.000Z", "2026-11-01T14:00:00.000Z"]);
  });

  it("New York fall back: a booking in the repeated hour blocks the correct instant only", () => {
    const weekly = allWeek(0, h(4));
    // Busy during the *second* 01:00-02:00 (EST, 06:00Z-07:00Z).
    const busy = [
      { start: new Date("2026-11-01T06:00:00Z"), end: new Date("2026-11-01T07:00:00Z") },
    ];
    const s = computeSlots(
      input({
        fromDate: "2026-11-01",
        toDate: "2026-11-01",
        stepMin: 60,
        staff: [staff("s1", { weekly, busy })],
      }),
    );
    expect(s.map((x) => iso(x.start))).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T05:00:00.000Z", // first 01:00 (EDT) is still free
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T08:00:00.000Z",
    ]);
  });

  it("London spring forward (2026-03-29) and fall back (2026-10-25)", () => {
    const spring = starts(
      input({ timezone: LONDON, fromDate: "2026-03-28", toDate: "2026-03-29", durationMin: 480 }),
    );
    expect(spring).toEqual(["2026-03-28T09:00:00.000Z", "2026-03-29T08:00:00.000Z"]);
    const fall = starts(
      input({ timezone: LONDON, fromDate: "2026-10-24", toDate: "2026-10-25", durationMin: 480 }),
    );
    expect(fall).toEqual(["2026-10-24T08:00:00.000Z", "2026-10-25T09:00:00.000Z"]);
  });

  it("Lord Howe Island's 30-minute DST shift (2026-10-04)", () => {
    // Clocks go 02:00 -> 02:30. Window 01:00-04:00 is 2.5 real hours.
    const weekly = allWeek(h(1), h(4));
    const s = computeSlots(
      input({
        timezone: "Australia/Lord_Howe",
        fromDate: "2026-10-04",
        toDate: "2026-10-04",
        durationMin: 150,
        staff: [staff("s1", { weekly })],
      }),
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.end.getTime() - s[0]!.start.getTime()).toBe(150 * 60_000);
  });

  it("half-hour offset zone without DST (Asia/Kolkata)", () => {
    const s = starts(input({ timezone: "Asia/Kolkata", durationMin: 480 }));
    expect(s).toEqual(["2026-06-10T03:30:00.000Z"]);
  });
});

describe("computeSlots: multiple staff ('any')", () => {
  it("merges identical starts and lists every available staff member sorted", () => {
    const busy = [
      { start: new Date("2026-06-10T13:00:00Z"), end: new Date("2026-06-10T14:00:00Z") },
    ];
    const slots = computeSlots(input({ staff: [staff("zed"), staff("amy", { busy })] }));
    expect(slots[0]).toMatchObject({ staffIds: ["zed"] });
    expect(slots.find((s) => iso(s.start) === "2026-06-10T14:00:00.000Z")!.staffIds).toEqual([
      "amy",
      "zed",
    ]);
  });

  it("unions different schedules", () => {
    const early = allWeek(h(8), h(9));
    const late = allWeek(h(17), h(18));
    const slots = computeSlots(
      input({ staff: [staff("a", { weekly: early }), staff("b", { weekly: late })] }),
    );
    expect(slots.map((s) => [iso(s.start), s.staffIds])).toEqual([
      ["2026-06-10T12:00:00.000Z", ["a"]],
      ["2026-06-10T21:00:00.000Z", ["b"]],
    ]);
  });

  it("returns nothing with no staff", () => {
    expect(computeSlots(input({ staff: [] }))).toEqual([]);
  });
});

describe("isSlotAvailable", () => {
  it("accepts a valid slot and rejects misaligned, busy or unknown-staff starts", () => {
    const busy = [
      { start: new Date("2026-06-10T15:00:00Z"), end: new Date("2026-06-10T16:00:00Z") },
    ];
    const inp = input({ staff: [staff("s1", { busy })] });
    expect(isSlotAvailable(inp, "s1", new Date("2026-06-10T13:00:00Z"))).toBe(true);
    expect(isSlotAvailable(inp, "s1", new Date("2026-06-10T13:10:00Z"))).toBe(false);
    expect(isSlotAvailable(inp, "s1", new Date("2026-06-10T15:00:00Z"))).toBe(false);
    expect(isSlotAvailable(inp, "nobody", new Date("2026-06-10T13:00:00Z"))).toBe(false);
  });
});

describe("validation", () => {
  it.each([
    [{ durationMin: 0 }, /durationMin/],
    [{ durationMin: 1.5 }, /durationMin/],
    [{ bufferMin: -5 }, /bufferMin/],
    [{ stepMin: 0 }, /stepMin/],
    [{ fromDate: "2026-06-11", toDate: "2026-06-10" }, /fromDate/],
  ])("rejects %o", (over, msg) => {
    expect(() => computeSlots(input(over))).toThrow(msg);
  });

  it("rejects bad weekly rules", () => {
    expect(() =>
      validateAvailabilityInput(
        input({ staff: [staff("s", { weekly: [{ weekday: 8, startMinute: 0, endMinute: 60 }] })] }),
      ),
    ).toThrow(/weekday/);
    expect(() =>
      validateAvailabilityInput(
        input({
          staff: [staff("s", { weekly: [{ weekday: 1, startMinute: 600, endMinute: 600 }] })],
        }),
      ),
    ).toThrow(/weekly rule/);
    expect(() =>
      validateAvailabilityInput(
        input({
          staff: [staff("s", { weekly: [{ weekday: 1, startMinute: 0, endMinute: 1441 }] })],
        }),
      ),
    ).toThrow(/weekly rule/);
  });

  it("caps the date range", () => {
    expect(() => computeSlots(input({ fromDate: "2026-01-01", toDate: "2026-12-31" }))).toThrow(
      /exceeds/,
    );
  });

  it("rejects malformed dates", () => {
    expect(() => computeSlots(input({ fromDate: "2026-6-1", toDate: "2026-6-1" }))).toThrow(
      /Invalid/,
    );
  });
});

describe("helpers", () => {
  it("mergeRanges merges touching and overlapping ranges", () => {
    expect(
      mergeRanges([
        [60, 120],
        [0, 30],
        [30, 45],
        [100, 200],
      ]),
    ).toEqual([
      [0, 45],
      [60, 200],
    ]);
    expect(mergeRanges([])).toEqual([]);
  });

  it("workingWindows returns UTC instants for a local date", () => {
    expect(workingWindows(staff("s"), "2026-06-10", NY)).toEqual([
      { start: new Date("2026-06-10T13:00:00Z"), end: new Date("2026-06-10T21:00:00Z") },
    ]);
  });

  it("staffSlots returns Date instances", () => {
    expect(staffSlots(input(), staff("s1"))[0]).toBeInstanceOf(Date);
  });

  it("pickStaff chooses the least-booked candidate, then lowest id", () => {
    expect(pickStaff(["b", "a", "c"], { a: 3, b: 1, c: 1 })).toBe("b");
    expect(pickStaff(["b", "a"], {})).toBe("a");
    expect(pickStaff([], {})).toBeNull();
  });
});
