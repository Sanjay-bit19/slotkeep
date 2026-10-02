import { Prisma } from "@prisma/client";

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class SlotUnavailableError extends DomainError {
  constructor(message = "That time is no longer available") {
    super("SLOT_UNAVAILABLE", message, 409);
  }
}

export class PlanLimitError extends DomainError {
  constructor(code: "STAFF_LIMIT" | "BOOKING_LIMIT", message: string) {
    super(code, message, 402);
  }
}

export class NotFoundError extends DomainError {
  constructor(what = "Resource") {
    super("NOT_FOUND", `${what} not found`, 404);
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super("INVALID_STATE", message, 409);
  }
}

/** Postgres SQLSTATE 23P01: exclusion_violation (our booking_no_overlap constraint). */
export function isExclusionViolation(err: unknown): boolean {
  return hasPgCode(err, "23P01") || /booking_no_overlap/.test(String((err as Error)?.message ?? ""));
}

export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return true;
  return hasPgCode(err, "23505");
}

function hasPgCode(err: unknown, code: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  if (e.meta?.code === code) return true;
  return typeof e.message === "string" && e.message.includes(code);
}
