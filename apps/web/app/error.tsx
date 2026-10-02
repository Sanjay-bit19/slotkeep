"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center"
    >
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-slate-700">
        We&apos;ve been notified. {error.digest && <span>Reference: {error.digest}</span>}
      </p>
      <button onClick={reset} className="mt-6 rounded-md bg-indigo-600 px-4 py-2 text-white">
        Try again
      </button>
    </main>
  );
}
