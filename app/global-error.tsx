"use client";

/**
 * Top-level error boundary. Catches errors that root layout boundaries miss
 * (esp. errors thrown during root rendering itself). Sentry captures them
 * here so we have a record even if the user just sees a white screen.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
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
    <html>
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#e4e4e7",
          margin: 0,
          padding: "2rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
            Something broke.
          </h1>
          <p style={{ color: "#a1a1aa", marginBottom: "1rem" }}>
            Brain crashed on the way to render this page. The error is logged.
            Refresh or hit Reset to try again.
          </p>
          <button
            onClick={reset}
            style={{
              background: "linear-gradient(135deg, #6366f1, #ec4899)",
              color: "white",
              border: "none",
              padding: "0.5rem 1.25rem",
              borderRadius: "9999px",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        </div>
      </body>
    </html>
  );
}
