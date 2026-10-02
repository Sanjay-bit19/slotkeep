import { balanceDueCents, formatInTimeZone, formatMoney } from "@slotkeep/core";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface Layout {
  brandColor: string;
  businessName: string;
  heading: string;
  paragraphs: string[];
  details?: Array<[string, string]>;
  cta?: { label: string; url: string };
  footer?: string;
}

function layout(l: Layout): string {
  const details = l.details?.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0">${l.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;color:#6b7280;width:40%">${escapeHtml(k)}</td><td style="padding:6px 0;color:#111827;font-weight:600">${escapeHtml(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const cta = l.cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(l.cta.url)}" style="background:${escapeHtml(l.brandColor)};color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(l.cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#ffffff;border-radius:12px;padding:32px;border-top:4px solid ${escapeHtml(l.brandColor)}">
<p style="margin:0 0 8px;color:#6b7280;font-size:14px">${escapeHtml(l.businessName)}</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#111827">${escapeHtml(l.heading)}</h1>
${l.paragraphs.map((p) => `<p style="margin:0 0 12px;color:#374151;line-height:1.5">${escapeHtml(p)}</p>`).join("")}
${details}${cta}
${l.footer ? `<p style="margin:24px 0 0;color:#9ca3af;font-size:12px">${escapeHtml(l.footer)}</p>` : ""}
</div><p style="text-align:center;color:#9ca3af;font-size:12px">Sent by SlotKeep</p></div></body></html>`;
}

function textVersion(l: Layout): string {
  return [
    l.businessName,
    "",
    l.heading,
    "",
    ...l.paragraphs,
    "",
    ...(l.details ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(l.cta ? ["", `${l.cta.label}: ${l.cta.url}`] : []),
    ...(l.footer ? ["", l.footer] : []),
  ].join("\n");
}

function render(subject: string, l: Layout): RenderedEmail {
  return { subject, html: layout(l), text: textVersion(l) };
}

export interface BookingEmailData {
  businessName: string;
  brandColor: string;
  timezone: string;
  customerName: string;
  serviceName: string;
  staffName: string;
  startAt: Date;
  priceCents: number;
  depositPaidCents: number;
  currency: string;
  manageUrl?: string;
  cancellationWindowHours: number;
}

function when(d: BookingEmailData): string {
  return `${formatInTimeZone(d.startAt, d.timezone, "cccc, LLLL d, yyyy 'at' h:mm a")} (${formatInTimeZone(d.startAt, d.timezone, "ZZZZ")})`;
}

function bookingDetails(d: BookingEmailData): Array<[string, string]> {
  return [
    ["Service", d.serviceName],
    ["With", d.staffName],
    ["When", when(d)],
    ["Deposit paid", formatMoney(d.depositPaidCents, d.currency)],
    [
      "Due at appointment",
      formatMoney(balanceDueCents(d.priceCents, d.depositPaidCents), d.currency),
    ],
  ];
}

export function bookingConfirmedEmail(d: BookingEmailData): RenderedEmail {
  return render(
    `Confirmed: ${d.serviceName} on ${formatInTimeZone(d.startAt, d.timezone, "LLL d")}`,
    {
      brandColor: d.brandColor,
      businessName: d.businessName,
      heading: "Your booking is confirmed",
      paragraphs: [`Hi ${d.customerName}, you're all set. We look forward to seeing you.`],
      details: bookingDetails(d),
      cta: d.manageUrl ? { label: "Reschedule or cancel", url: d.manageUrl } : undefined,
      footer: `Free cancellation up to ${d.cancellationWindowHours} hours before your appointment.`,
    },
  );
}

export function bookingReminderEmail(d: BookingEmailData): RenderedEmail {
  return render(`Reminder: ${d.serviceName} tomorrow`, {
    brandColor: d.brandColor,
    businessName: d.businessName,
    heading: "See you tomorrow",
    paragraphs: [`Hi ${d.customerName}, this is a reminder of your upcoming appointment.`],
    details: bookingDetails(d),
    cta: d.manageUrl ? { label: "Manage booking", url: d.manageUrl } : undefined,
  });
}

export function bookingRescheduledEmail(d: BookingEmailData): RenderedEmail {
  return render(
    `Rescheduled: ${d.serviceName} on ${formatInTimeZone(d.startAt, d.timezone, "LLL d")}`,
    {
      brandColor: d.brandColor,
      businessName: d.businessName,
      heading: "Your booking has moved",
      paragraphs: [
        `Hi ${d.customerName}, your appointment has been rescheduled. Links in earlier emails no longer work.`,
      ],
      details: bookingDetails(d),
      cta: d.manageUrl ? { label: "Manage booking", url: d.manageUrl } : undefined,
    },
  );
}

export function bookingCancelledEmail(
  d: BookingEmailData & { refundCents: number },
): RenderedEmail {
  const refund =
    d.refundCents > 0
      ? `A refund of ${formatMoney(d.refundCents, d.currency)} has been issued to your original payment method. It can take 5-10 business days to appear.`
      : d.depositPaidCents > 0
        ? "Because this cancellation was inside the cancellation window, the deposit is non-refundable."
        : "No payment was taken.";
  return render(
    `Cancelled: ${d.serviceName} on ${formatInTimeZone(d.startAt, d.timezone, "LLL d")}`,
    {
      brandColor: d.brandColor,
      businessName: d.businessName,
      heading: "Your booking was cancelled",
      paragraphs: [
        `Hi ${d.customerName}, your appointment on ${when(d)} has been cancelled.`,
        refund,
      ],
    },
  );
}

export function paymentConflictEmail(d: BookingEmailData & { refundCents: number }): RenderedEmail {
  return render(`We couldn't hold your time: ${d.serviceName}`, {
    brandColor: d.brandColor,
    businessName: d.businessName,
    heading: "Sorry, that time was taken",
    paragraphs: [
      `Hi ${d.customerName}, your payment arrived after your 10-minute reservation expired and someone else booked ${when(d)} in the meantime.`,
      `We've refunded ${formatMoney(d.refundCents, d.currency)} in full. Please pick another time on our booking page.`,
    ],
  });
}

export interface DailySummaryData {
  businessName: string;
  brandColor: string;
  timezone: string;
  localDate: string;
  dashboardUrl: string;
  bookings: Array<{ startAt: Date; customerName: string; serviceName: string; staffName: string }>;
}

export function dailySummaryEmail(d: DailySummaryData): RenderedEmail {
  const n = d.bookings.length;
  return render(`Today at ${d.businessName}: ${n} appointment${n === 1 ? "" : "s"}`, {
    brandColor: d.brandColor,
    businessName: d.businessName,
    heading: `Your day, ${d.localDate}`,
    paragraphs: [
      n === 0 ? "No appointments today." : `You have ${n} appointment${n === 1 ? "" : "s"} today.`,
    ],
    details: d.bookings.map((b) => [
      formatInTimeZone(b.startAt, d.timezone, "h:mm a"),
      `${b.customerName} - ${b.serviceName} (${b.staffName})`,
    ]),
    cta: { label: "Open dashboard", url: d.dashboardUrl },
  });
}

export function magicLinkEmail(url: string, host: string): RenderedEmail {
  return render(`Sign in to SlotKeep`, {
    brandColor: "#4f46e5",
    businessName: "SlotKeep",
    heading: "Sign in",
    paragraphs: [
      `Click the button below to sign in to ${host}. The link expires in 24 hours and can be used once.`,
    ],
    cta: { label: "Sign in", url },
    footer: "If you didn't request this, you can ignore this email.",
  });
}
