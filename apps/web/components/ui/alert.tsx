import { cn } from "@/lib/utils";

export function Alert({
  variant = "info",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "info" | "error" | "success" | "warning" }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[variant];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-4 py-3 text-sm", styles, className)}
      {...props}
    >
      {children}
    </div>
  );
}
