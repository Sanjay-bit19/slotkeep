import * as Sentry from "@sentry/nextjs";
import { DomainError } from "@slotkeep/db";
import type { Logger } from "@slotkeep/infra";
import { ZodError } from "zod";
import { AuthzError } from "./authz";

export interface PublicError {
  status: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/** Maps any thrown error to what is safe to show a client. Unknown errors are logged + reported. */
export function toPublicError(err: unknown, log?: Logger): PublicError {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      status: 400,
      code: "VALIDATION",
      message: "Please fix the highlighted fields",
      fieldErrors,
    };
  }
  if (err instanceof DomainError)
    return { status: err.status, code: err.code, message: err.message };
  if (err instanceof AuthzError)
    return { status: err.status, code: err.code, message: err.message };
  log?.error({ err }, "unhandled error");
  Sentry.captureException(err);
  return { status: 500, code: "INTERNAL", message: "Something went wrong. Please try again." };
}
