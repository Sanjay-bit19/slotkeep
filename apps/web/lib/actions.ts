import { isRedirectError } from "next/dist/client/components/redirect-error";
import { actionLogger } from "./request";
import { toPublicError } from "./errors";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

export const initialActionState: ActionResult<never> | null = null;

/**
 * Runs server action logic and converts thrown errors into a serializable result. The callback
 * may return its own ActionResult (e.g. a success message) or nothing.
 */
export async function runAction(
  name: string,
  fn: () => Promise<ActionResult | void>,
): Promise<ActionResult> {
  const { log } = await actionLogger({ action: name });
  try {
    const out = await fn();
    return out ?? { ok: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const e = toPublicError(err, log);
    return { ok: false, error: e.message, code: e.code, fieldErrors: e.fieldErrors };
  }
}

export function formString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
