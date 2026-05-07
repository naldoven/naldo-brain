import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // Source map upload — only runs when SENTRY_AUTH_TOKEN is set on the build
  // host. Without it, build skips upload silently (good for local + first deploy).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet build logs unless we're on CI.
  silent: !process.env.CI,

  // Auto-instrumentation defaults that catch unhandled errors in App Router.
  widenClientFileUpload: true,
  disableLogger: true,
  reactComponentAnnotation: { enabled: true },
});
