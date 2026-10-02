"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server component every `ms` until `maxTries`, e.g. while awaiting a webhook. */
export function AutoRefresh({ ms = 2000, maxTries = 30 }: { ms?: number; maxTries?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      if (++n > maxTries) return clearInterval(id);
      router.refresh();
    }, ms);
    return () => clearInterval(id);
  }, [router, ms, maxTries]);
  return null;
}
