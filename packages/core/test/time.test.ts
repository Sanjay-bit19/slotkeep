import { describe, expect, it } from "vitest";
import {
  addDaysToLocalDate,
  addMinutes,
  eachLocalDate,
  formatInTimeZone,
  isValidTimeZone,
  localDayBounds,
  localHour,
  localMonthBounds,
  localWeekStart,
  localWeekday,
  minutesBetween,
  toLocalDate,
  wallTimeToUtc,
} from "../src/time";

describe("time helpers", () => {
  it("validates IANA zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("converts wall time to UTC across DST", () => {
    expect(wallTimeToUtc("2026-01-15", 540, "America/New_York").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
    expect(wallTimeToUtc("2026-07-15", 540, "America/New_York").toISOString()).toBe(
      "2026-07-15T13:00:00.000Z",
    );
    expect(wallTimeToUtc("2026-07-15", 1440, "America/New_York").toISOString()).toBe(
      "2026-07-16T04:00:00.000Z",
    );
    // Nonexistent 02:30 clamps to the moment clocks jump: 03:00 EDT.
    expect(wallTimeToUtc("2026-03-08", 150, "America/New_York").toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    expect(wallTimeToUtc("2026-03-08", 120, "America/New_York").toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    // 30-minute gap on Lord Howe: 02:15 clamps to 02:30 (+11) = 15:30Z previous day.
    expect(wallTimeToUtc("2026-10-04", 135, "Australia/Lord_Howe").toISOString()).toBe(
      "2026-10-03T15:30:00.000Z",
    );
    // Ambiguous 01:30 resolves to the earlier instant (EDT).
    expect(wallTimeToUtc("2026-11-01", 90, "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("rejects bad inputs", () => {
    expect(() => wallTimeToUtc("2026-01-15", -1, "UTC")).toThrow(RangeError);
    expect(() => wallTimeToUtc("2026-01-15", 1441, "UTC")).toThrow(RangeError);
    expect(() => wallTimeToUtc("2026-02-30", 0, "UTC")).toThrow(/Invalid local date/);
    expect(() => wallTimeToUtc("nope", 0, "UTC")).toThrow(/Invalid local date/);
    expect(() => eachLocalDate("x", "y")).toThrow(RangeError);
  });

  it("finds local dates and weekdays", () => {
    const instant = new Date("2026-06-10T02:00:00Z");
    expect(toLocalDate(instant, "America/New_York")).toBe("2026-06-09");
    expect(toLocalDate(instant, "Asia/Tokyo")).toBe("2026-06-10");
    expect(localWeekday("2026-06-10", "UTC")).toBe(3);
    expect(localHour(instant, "America/New_York")).toBe(22);
  });

  it("computes 23h and 25h days at DST boundaries", () => {
    const spring = localDayBounds("2026-03-08", "America/New_York");
    expect(minutesBetween(spring.start, spring.end)).toBe(23 * 60);
    const fall = localDayBounds("2026-11-01", "America/New_York");
    expect(minutesBetween(fall.start, fall.end)).toBe(25 * 60);
  });

  it("iterates and offsets local dates", () => {
    expect(eachLocalDate("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(eachLocalDate("2026-03-02", "2026-03-01")).toEqual([]);
    expect(addDaysToLocalDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("computes month and week bounds in the tenant zone", () => {
    const { start, end } = localMonthBounds(
      new Date("2026-07-01T02:00:00Z"),
      "America/Los_Angeles",
    );
    // Still June 30 in LA.
    expect(start.toISOString()).toBe("2026-06-01T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(localWeekStart(new Date("2026-06-14T12:00:00Z"), "UTC")).toBe("2026-06-08");
  });

  it("formats and does minute math", () => {
    expect(formatInTimeZone(new Date("2026-06-10T13:00:00Z"), "America/New_York", "HH:mm")).toBe(
      "09:00",
    );
    expect(addMinutes(new Date("2026-06-10T13:00:00Z"), 90).toISOString()).toBe(
      "2026-06-10T14:30:00.000Z",
    );
  });
});
