import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { requestLogger, type Logger } from "@slotkeep/infra";

export async function getRequestId(): Promise<string> {
  try {
    return (await headers()).get("x-request-id") ?? randomUUID();
  } catch {
    return randomUUID();
  }
}

export function requestIdFrom(req: Request): string {
  return req.headers.get("x-request-id") ?? randomUUID();
}

/**
 * Client IP for rate limiting. On Vercel and most proxies the first X-Forwarded-For hop is the
 * client; self-hosted deployments must put a proxy in front that overwrites this header.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function actionLogger(
  extra: Record<string, unknown> = {},
): Promise<{ log: Logger; requestId: string }> {
  const requestId = await getRequestId();
  return { log: requestLogger(requestId, extra), requestId };
}
