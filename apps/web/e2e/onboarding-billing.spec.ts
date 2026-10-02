import { expect, test } from "@playwright/test";
import { db, firstLink, payDeposit, signIn, waitForEmail } from "./helpers";

const stamp = Date.now();

test.describe.serial("new business: onboarding, plan limits, upgrade", () => {
  const ownerEmail = `founder+${stamp}@example.com`;
  const slug = `e2e-studio-${stamp}`;

  test("signs up and creates a business", async ({ page }) => {
    await signIn(page, ownerEmail);
    await page.waitForURL(/\/onboarding/);
    await page.waitForLoadState("networkidle"); // let React hydrate the controlled inputs
    await page.getByLabel("Business name").fill(`E2E Studio ${stamp}`);
    await page.getByLabel("Booking page address").fill(slug);
    await page.getByLabel("Time zone").selectOption("America/Denver");
    await page.getByRole("button", { name: "Create business" }).click();
    await page.waitForURL(new RegExp(`/dashboard/${slug}\\?welcome=1`));
    await expect(page.getByText("Your business is ready.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a service" })).toBeVisible();
  });

  test("adds a service and it appears on the public booking page", async ({ page }) => {
    await signIn(page, ownerEmail);
    await page.goto(`/dashboard/${slug}/services/new`);
    await page.getByLabel("Name").fill("Strength Session");
    await page.getByLabel("Duration (minutes)").fill("45");
    await page.getByLabel("Price (USD)").fill("80");
    await page.getByLabel("Deposit (USD)").fill("20");
    await page.getByRole("button", { name: "Save service" }).click();
    await expect(page.getByText("Service saved.")).toBeVisible();

    // Server-side validation: deposit greater than price is rejected.
    await page.goto(`/dashboard/${slug}/services/new`);
    await page.getByLabel("Name").fill("Bad Pricing");
    await page.getByLabel("Price (USD)").fill("10");
    await page.getByLabel("Deposit (USD)").fill("20");
    await page.getByRole("button", { name: "Save service" }).click();
    await expect(page.getByText("Deposit cannot exceed price")).toBeVisible();

    await page.goto(`/b/${slug}`);
    await expect(page.getByText("Strength Session")).toBeVisible();
  });

  test("free plan blocks a second active staff member, upgrading lifts the limit", async ({
    page,
  }) => {
    await signIn(page, ownerEmail);
    await page.goto(`/dashboard/${slug}/staff/new`);
    await page.getByLabel("Name", { exact: true }).fill("Second Coach");
    await page.getByRole("button", { name: "Save staff member" }).click();
    await expect(page.getByText(/Your plan allows 1 active staff member/)).toBeVisible();

    await page.goto(`/dashboard/${slug}/billing`);
    await expect(page.getByRole("heading", { name: "Current plan: Free" })).toBeVisible();
    await page.getByRole("button", { name: "Upgrade to Pro" }).click();
    await payDeposit(page); // same hosted-checkout step, subscription mode
    await page.waitForURL(new RegExp(`/dashboard/${slug}/billing\\?upgraded=1`));
    await expect(page.getByRole("heading", { name: "Current plan: Pro" })).toBeVisible();
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug } });
    expect(tenant).toMatchObject({ plan: "PRO", subscriptionStatus: "ACTIVE" });

    await page.goto(`/dashboard/${slug}/staff/new`);
    await page.getByLabel("Name", { exact: true }).fill("Second Coach");
    await page.getByRole("button", { name: "Save staff member" }).click();
    await expect(page.getByText("Staff member saved.")).toBeVisible();
  });
});

test("customer reschedules from the email link; the old link stops working", async ({ page }) => {
  const email = `reschedule+${stamp}@example.com`;
  await page.goto("/b/shear-bliss");
  await page.getByText("Blowout").click(); // no-deposit service: confirmed immediately
  const days = page.getByRole("radiogroup", { name: "Date" }).getByRole("radio");
  for (let i = 3; i < 14; i++) {
    await days.nth(i).click();
    await expect(page.getByText("Loading available times…")).toBeHidden();
    if (
      (await page.getByRole("radiogroup", { name: "Available times" }).getByRole("radio").count()) >
      1
    )
      break;
  }
  await page
    .getByRole("radiogroup", { name: "Available times" })
    .getByRole("radio")
    .first()
    .click();
  await page.getByLabel("Full name").fill("Morgan Mover");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible();

  const confirmation = await waitForEmail(email, "booking-confirmed");
  const manageUrl = firstLink(confirmation.body, /http:\/\/\S+\/m\/\S+/);
  const before = await db.booking.findFirstOrThrow({ where: { customer: { email } } });

  await page.goto(manageUrl);
  await page.getByRole("radiogroup", { name: "New date" }).getByRole("radio").nth(5).click();
  const times = page.getByRole("radiogroup", { name: "New time" }).getByRole("radio");
  await expect(times.first()).toBeVisible();
  await times.last().click();
  await page.getByRole("button", { name: "Move my booking" }).click();
  await expect(page.getByText("Your booking has been moved.")).toBeVisible();
  expect(page.url()).not.toContain(manageUrl.split("/m/")[1]!);

  const after = await db.booking.findFirstOrThrow({ where: { customer: { email } } });
  expect(after.startAt.getTime()).not.toBe(before.startAt.getTime());
  expect(after.tokenVersion).toBe(before.tokenVersion + 1);
  await waitForEmail(email, "booking-rescheduled");

  await page.goto(manageUrl);
  await expect(page.getByText("This booking has changed since this link was sent.")).toBeVisible();
});
