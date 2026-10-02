import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_ENV } from "../playwright.config";

export const db = new PrismaClient({ datasources: { db: { url: E2E_ENV.DATABASE_URL } } });

/** Polls the email log (the dev transport records every email) until a match appears. */
export async function waitForEmail(to: string, template: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const e = await db.emailLog.findFirst({
      where: { to, template },
      orderBy: { createdAt: "desc" },
    });
    if (e) return e;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No ${template} email to ${to} within ${timeoutMs}ms`);
}

export function firstLink(body: string | null, pattern: RegExp): string {
  const text = body?.split("<!--html-->")[0] ?? "";
  const m = text.match(pattern);
  if (!m) throw new Error(`No link matching ${pattern} in email`);
  return m[0];
}

/** Signs in through the real magic-link flow: request link, read it from the email log, open it. */
export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  const requestedAt = new Date();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  let link = "";
  const deadline = Date.now() + 15_000;
  while (!link && Date.now() < deadline) {
    const e = await db.emailLog.findFirst({
      where: {
        to: email,
        template: "magic-link",
        createdAt: { gte: new Date(requestedAt.getTime() - 1000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (e) link = firstLink(e.body, /http:\/\/\S+\/api\/auth\/callback\/email\S+/);
    else await new Promise((r) => setTimeout(r, 200));
  }
  await page.goto(link);
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

/**
 * Pays on the checkout page. Fake mode: our simulator. Real mode (STRIPE_E2E=1): Stripe's hosted
 * Checkout in test mode with the 4242 test card (webhooks must reach the app, e.g. via
 * `stripe listen --forward-to localhost:3100/api/webhooks/stripe`).
 */
export async function payDeposit(page: Page) {
  if (process.env.STRIPE_E2E === "1") {
    await page.waitForURL(/checkout\.stripe\.com/);
    await page.locator("#cardNumber").fill("4242424242424242");
    await page.locator("#cardExpiry").fill("12/34");
    await page.locator("#cardCvc").fill("123");
    await page.locator("#billingName").fill("E2E Tester");
    const zip = page.locator("#billingPostalCode");
    if (await zip.isVisible()) await zip.fill("10001");
    await page.locator(".SubmitButton").click();
  } else {
    await page.waitForURL(/\/dev\/checkout\//);
    await expect(page.getByText("Test mode · payment simulator")).toBeVisible();
    await page.getByRole("button", { name: /^Pay / }).click();
  }
}
