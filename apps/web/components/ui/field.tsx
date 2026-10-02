import { Label } from "./label";

/** Label + control + accessible error/description wiring. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string[] | string;
  hint?: string;
  children: React.ReactNode;
}) {
  const msg = Array.isArray(error) ? error[0] : error;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !msg && (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      )}
      {msg && (
        <p id={`${id}-error`} className="text-xs text-red-700">
          {msg}
        </p>
      )}
    </div>
  );
}
