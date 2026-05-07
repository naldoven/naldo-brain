/**
 * Sentry edge runtime config.
 *
 * Loaded by instrumentation.ts when running in the edge runtime
 * (middleware, edge route handlers). Most of our routes are nodejs but
 * Next.js still loads this in middleware contexts.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    enabled: process.env.NODE_ENV === "production" || process.env.SENTRY_FORCE_ENABLE === "1",
    sendDefaultPii: false,
    release: process.env.RENDER_GIT_COMMIT ?? process.env.SENTRY_RELEASE,
  });
}
