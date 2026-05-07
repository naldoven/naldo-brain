/**
 * Sentry client-side runtime config.
 *
 * Next.js 15+ auto-loads `instrumentation-client.ts` in the browser. Catches
 * unhandled errors and unhandled promise rejections in React components.
 * Most production noise comes from extension-injected scripts and is
 * filtered out via the `denyUrls` list.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    enabled: process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SENTRY_FORCE_ENABLE === "1",
    sendDefaultPii: false,
    // Filter common browser-extension noise so the dashboard isn't flooded.
    denyUrls: [
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
      /safari-extension:\/\//,
    ],
    // Replay only on errors — not all sessions, to stay within free tier.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

// Required by @sentry/nextjs in App Router for navigation transactions
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
