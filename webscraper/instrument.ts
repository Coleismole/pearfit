/**
 * Sentry error reporting for the scraper page. main.tsx imports this first.
 * The DSN is a public ingest key (it ships in the browser bundle by design). Set VITE_SENTRY_DSN to send events
 * elsewhere, or to an empty string to turn Sentry off.
 */
import * as Sentry from '@sentry/react';

const DEFAULT_SENTRY_DSN =
  'https://e494cc9f6726692e9b0b3ebe0bb39e53@o4512414548164608.ingest.us.sentry.io/4512414567694337';

const dsn = import.meta.env.VITE_SENTRY_DSN ?? DEFAULT_SENTRY_DSN;
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

if (dsn) {
  Sentry.init({
    dsn,
    environment: isLocal ? 'development' : 'production',
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    // Every trace locally so a test shows up; a tenth in production.
    tracesSampleRate: isLocal ? 1.0 : 0.1,
    // Send trace headers to the scraper's own API only.
    tracePropagationTargets: [/^\/(scraper\/)?api\//],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
