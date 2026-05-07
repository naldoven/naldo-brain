/**
 * Sentry server-side runtime config.
 *
 * Loaded by instrumentation.ts when running in Node.js. Captures unhandled
 * errors in API routes, server components, and server actions. DSN comes
 * from SENTRY_DSN — without it Sentry is a no-op so local dev stays quiet.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Sample rate for non-error transactions. 0.1 = 10%, plenty for a
    // single-user app and keeps the free tier happy.
    tracesSampleRate: 0.1,
    // Don't send anything from local development unless explicitly enabled.
    enabled: process.env.NODE_ENV === "production" || process.env.SENTRY_FORCE_ENABLE === "1",
    // Cut PII from event bodies — Naldo's chats include personal data.
    sendDefaultPii: false,
    // Release tag from Render's commit SHA env var when available.
    release: process.env.RENDER_GIT_COMMIT ?? process.env.SENTRY_RELEASE,
  });
}
