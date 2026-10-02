import { describe, expect, it } from "vitest";
import { manageTokenExpiry, signManageToken, verifyManageToken } from "../src/tokens";

const SECRET = "test-secret-at-least-16";
const now = new Date("2026-06-10T12:00:00Z");
const exp = new Date("2026-06-12T12:00:00Z");

describe("manage tokens", () => {
  it("round-trips", () => {
    const t = signManageToken({ bookingId: "bk_1", version: 2, expiresAt: exp }, SECRET);
    expect(verifyManageToken(t, SECRET, now)).toEqual({ ok: true, payload: { b: "bk_1", v: 2, e: exp.getTime() / 1000 } });
  });

  it("rejects tampered payloads and wrong secrets", () => {
    const t = signManageToken({ bookingId: "bk_1", version: 1, expiresAt: exp }, SECRET);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ b: "bk_2", v: 1, e: exp.getTime() / 1000 })).toString("base64url");
    expect(verifyManageToken(`${forged}.${sig}`, SECRET, now)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyManageToken(t, "another-secret-1234567", now)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyManageToken(`${body}.AAAA`, SECRET, now)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("rejects expired tokens", () => {
    const t = signManageToken({ bookingId: "bk_1", version: 1, expiresAt: exp }, SECRET);
    expect(verifyManageToken(t, SECRET, exp)).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("rejects malformed tokens", () => {
    expect(verifyManageToken("nodot", SECRET, now)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(verifyManageToken(".x", SECRET, now)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(verifyManageToken(42 as unknown as string, SECRET, now)).toEqual({ ok: false, reason: "MALFORMED" });
    // Validly signed but not our payload shape.
    const body = Buffer.from(JSON.stringify({ hello: 1 })).toString("base64url");
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyManageToken(`${body}.${sig}`, SECRET, now)).toEqual({ ok: false, reason: "MALFORMED" });
    const notJson = Buffer.from("{not json").toString("base64url");
    const sig2 = createHmac("sha256", SECRET).update(notJson).digest("base64url");
    expect(verifyManageToken(`${notJson}.${sig2}`, SECRET, now)).toEqual({ ok: false, reason: "MALFORMED" });
  });

  it("refuses weak secrets", () => {
    expect(() => signManageToken({ bookingId: "b", version: 1, expiresAt: exp }, "short")).toThrow(/16/);
  });

  it("caps expiry at maxDays or start time", () => {
    expect(manageTokenExpiry(new Date("2026-06-11T00:00:00Z"), now)).toEqual(new Date("2026-06-11T00:00:00Z"));
    expect(manageTokenExpiry(new Date("2027-01-01T00:00:00Z"), now, 30)).toEqual(new Date("2026-07-10T12:00:00Z"));
  });
});
