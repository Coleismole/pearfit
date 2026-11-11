/**
 * Sentry error reporting for the scraper's server. server.ts imports this first.
 * The DSN is a public ingest key, not a secret. Set SENTRY_DSN to send events elsewhere, or to an empty string to
 * turn Sentry off. Tests leave it off so a failing test never reports.
 */
import * as Sentry from '@sentry/node';

const DEFAULT_SENTRY_DSN =
  'https://42654097ec10bf2e7f8ffb9cfe0e5697@o4512414548164608.ingest.us.sentry.io/4512414567956480';

const dsn = process.env.SENTRY_DSN ?? DEFAULT_SENTRY_DSN;
const underTest = process.execArgv.includes('--test') || process.env.NODE_ENV === 'test';

if (dsn && !underTest) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Every trace locally so a test shows up; a tenth in production.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    serverName: 'pearfit-scraper',
  });
}
