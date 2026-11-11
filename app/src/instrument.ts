// Sentry error reporting. Imported first in main.tsx so it is running before the app renders.
// The DSN is a public ingest key (it ships in the browser bundle by design), so the default lives here the same way
// the API base URL does in config.ts. Set VITE_SENTRY_DSN to send events elsewhere, or to an empty string to turn Sentry off.
import * as Sentry from "@sentry/react";

const DEFAULT_SENTRY_DSN =
  "https://4308729363bea47026a9360072cb7fc3@o4512414548164608.ingest.us.sentry.io/4512414567563265";

const dsn = import.meta.env.VITE_SENTRY_DSN ?? DEFAULT_SENTRY_DSN;
const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

if (dsn) {
  Sentry.init({
    dsn,
    environment: isLocal ? "development" : "production",
    release: __APP_VERSION__,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    // Every trace locally so a test shows up; a tenth in production.
    tracesSampleRate: isLocal ? 1.0 : 0.1,
    // Send no trace headers. The API's CORS rules allow Content-Type only (see src/lib/api.ts), so sentry-trace and
    // baggage would make the browser block every API call.
    tracePropagationTargets: [],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
