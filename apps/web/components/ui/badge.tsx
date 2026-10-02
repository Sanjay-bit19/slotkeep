import { cn } from "@/lib/utils";
import type { BookingStatus } from "@slotkeep/core";

const STYLES: Record<BookingStatus, string> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-emerald-100 text-emerald-900",
  CANCELLED: "bg-slate-200 text-slate-700",
  COMPLETED: "bg-sky-100 text-sky-900",
  NO_SHOW: "bg-red-100 text-red-900",
};

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
};

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  return <Badge className={STYLES[status]}>{STATUS_LABEL[status]}</Badge>;
}
