"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", padding: 40 }}>
        <h1>Something went wrong</h1>
        <p>Please refresh the page.</p>
      </body>
    </html>
  );
}
