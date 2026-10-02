import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { db, firstLink, payDeposit, signIn, waitForEmail } from "./helpers";

const CUSTOMER = { name: "Riley Tester", email: `riley+${Date.now()}@example.com` };
let bookedSlotLabel = "";
let bookedDateIndex = 0;

/** Selects the first date (from tomorrow on) that has open slots and returns its index. */
async function pickDayWithSlots(page: Page, startIndex = 1): Promise<number> {
  const days = page.getByRole("radiogroup", { name: "Date" }).getByRole("radio");
  for (let i = startIndex; i < 14; i++) {
    await days.nth(i).click();
    await expect(page.getByText("Loading available times…")).toBeHidden();
    if (
      (await page.getByRole("radiogroup", { name: "Available times" }).getByRole("radio").count()) >
      0
    )
      return i;
  }
  throw new Error("No day with open slots in the next two weeks");
}

test.describe.serial("customer booking and owner refund", () => {
  test("public booking page is accessible", async ({ page }) => {
    await page.goto("/b/shear-bliss");
    await expect(page.getByRole("heading", { name: "Shear Bliss Salon" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });

  test("customer books a slot, pays the deposit, and is confirmed by the webhook", async ({
    page,
  }) => {
    await page.goto("/b/shear-bliss");
    await page.getByText("Women's Cut & Style").click();
    bookedDateIndex = await pickDayWithSlots(page);
    const firstSlot = page
      .getByRole("radiogroup", { name: "Available times" })
      .getByRole("radio")
      .first();
    bookedSlotLabel = (await firstSlot.textContent())!.trim();
    await firstSlot.click();

    // Client-side validation (shared zod schema) runs before anything is sent.
    await page.getByRole("button", { name: /Continue to pay/ }).click();
    await expect(page.getByText("Please enter your name")).toBeVisible();

    await page.getByLabel("Full name").fill(CUSTOMER.name);
    await page.getByLabel("Email").fill(CUSTOMER.email);
    await page.getByRole("button", { name: /Continue to pay \$15\.00 deposit/ }).click();

    // Slot is now held (PENDING_PAYMENT) until the webhook arrives.
    await expect
      .poll(
        async () =>
          (await db.booking.findFirst({ where: { customer: { email: CUSTOMER.email } } }))?.status,
      )
      .toBe("PENDING_PAYMENT");

    await payDeposit(page);
    await page.waitForURL(/\/b\/shear-bliss\/success/);
    await expect(page.getByRole("heading", { name: "You're booked!" })).toBeVisible();

    const booking = await db.booking.findFirstOrThrow({
      where: { customer: { email: CUSTOMER.email } },
    });
    expect(booking).toMatchObject({ status: "CONFIRMED", depositPaidCents: 1500 });
    expect(
      await db.processedWebhookEvent.count({ where: { type: "checkout.session.completed" } }),
    ).toBeGreaterThan(0);

    // The worker sends the confirmation email with a self-service link.
    const email = await waitForEmail(CUSTOMER.email, "booking-confirmed");
    expect(email.subject).toContain("Confirmed: Women's Cut & Style");
  });

  test("the booked slot is no longer offered to the next customer", async ({ page }) => {
    const booking = await db.booking.findFirstOrThrow({
      where: { customer: { email: CUSTOMER.email } },
    });
    await page.goto("/b/shear-bliss");
    await page.getByText("Women's Cut & Style").click();
    await page.getByLabel("Who with?").selectOption({
      label: (await db.staffMember.findUniqueOrThrow({ where: { id: booking.staffId } })).name,
    });
    await page
      .getByRole("radiogroup", { name: "Date" })
      .getByRole("radio")
      .nth(bookedDateIndex)
      .click();
    await expect(page.getByText("Loading available times…")).toBeHidden();
    const labels = await page
      .getByRole("radiogroup", { name: "Available times" })
      .getByRole("radio")
      .allTextContents();
    expect(labels.map((l) => l.trim())).not.toContain(bookedSlotLabel);
  });

  test("customer can open the self-service link from the email", async ({ page }) => {
    const email = await waitForEmail(CUSTOMER.email, "booking-confirmed");
    const manage = firstLink(email.body, /http:\/\/\S+\/m\/\S+/);
    await page.goto(manage);
    await expect(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reschedule" })).toBeVisible();
    await expect(page.getByText(/full \$15\.00 refund/)).toBeVisible();
  });

  test("owner cancels the booking from the dashboard and the deposit is refunded", async ({
    page,
  }) => {
    await signIn(page, "owner@shearbliss.demo");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.getByRole("link", { name: "Bookings", exact: true }).click();
    await page.getByLabel("Customer").fill(CUSTOMER.email);
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("1 booking", { exact: true })).toBeVisible();
    await page.getByRole("row").nth(1).getByRole("link").click();

    await expect(page.getByRole("heading", { name: `Booking for ${CUSTOMER.name}` })).toBeVisible();
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByText("$15.00 will be refunded to the customer.")).toBeVisible();
    await page.getByRole("button", { name: "Yes, cancel and refund" }).click();
    await expect(page.getByText("Booking cancelled and $15.00 refunded.")).toBeVisible();

    const booking = await db.booking.findFirstOrThrow({
      where: { customer: { email: CUSTOMER.email } },
    });
    expect(booking).toMatchObject({
      status: "CANCELLED",
      cancelReason: "OWNER",
      refundedCents: 1500,
    });
    expect(booking.stripeRefundId).toBeTruthy();
    const email = await waitForEmail(CUSTOMER.email, "booking-cancelled");
    expect(email.body).toContain("refund of $15.00");
  });
});

test.describe("roles", () => {
  test("staff members see the calendar but not billing or settings", async ({ page }) => {
    await signIn(page, "staff@shearbliss.demo");
    const nav = page.getByRole("navigation", { name: "Dashboard" });
    await expect(nav.getByRole("link", { name: "Calendar" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Billing" })).toHaveCount(0);
    await page.goto("/dashboard/shear-bliss/billing");
    await expect(page).toHaveURL(/denied=1/);
    await expect(page.getByText("You don't have permission to view that page.")).toBeVisible();
  });

  test("owners of one business cannot open another business's dashboard", async ({ page }) => {
    await signIn(page, "owner@brightpath.demo");
    const res = await page.goto("/dashboard/shear-bliss/bookings");
    expect(res?.status()).toBe(404);
  });

  test("calendar week view renders seeded bookings", async ({ page }) => {
    await signIn(page, "owner@shearbliss.demo");
    await page.goto("/dashboard/shear-bliss/calendar?view=week");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(page.locator('ul[aria-label^="Bookings for"] li a').first()).toBeVisible();
  });
});
