// Sentry error reporting for the deployed functions. Only the two entry files (recommend.ts, candidates.ts) import
// this, so the handlers, the tests and engine/src stay free of it.
// The DSN is a public ingest key, not a secret. Set SENTRY_DSN to send events elsewhere, or to an empty string to turn
// Sentry off.
import * as Sentry from "@sentry/node";
import type { ApiRequest, ApiResponse } from "./http.ts";

const DEFAULT_SENTRY_DSN =
  "https://42654097ec10bf2e7f8ffb9cfe0e5697@o4512414548164608.ingest.us.sentry.io/4512414567956480";

const dsn = process.env.SENTRY_DSN ?? DEFAULT_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // A tenth of requests in production, all of them elsewhere.
    tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.1 : 1.0,
    serverName: "pearfit-api",
  });
}

// For errors a handler catches and answers itself (for example the 502 when Supabase is unreachable).
export function reportError(error: unknown): void {
  Sentry.captureException(error);
}

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>;

// Reports an error that escapes the handler, then rethrows so Vercel still answers 500. A serverless function can be
// frozen as soon as it answers, so events are flushed before the function returns.
export function withSentry(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      Sentry.captureException(error);
      throw error;
    } finally {
      await Sentry.flush(2000);
    }
  };
}
