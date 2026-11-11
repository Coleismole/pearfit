// Starts Sentry error reporting on the marketing site. The SDK itself is the pinned CDN bundle loaded just before this
// file (see the <script> tag in each page). This file does nothing when that bundle is blocked or missing.
// The DSN is a public ingest key, not a secret.
(function initializeSentry() {
  if (!window.Sentry) return;

  var isDevelopment = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;

  window.Sentry.init({
    dsn: 'https://0d349cacfc8efbc99a5d80161ae78d04@o4512414548164608.ingest.us.sentry.io/4512414567825409',
    environment: isDevelopment ? 'development' : 'production',
    integrations: [window.Sentry.browserTracingIntegration(), window.Sentry.replayIntegration()],
    // Every trace locally so a test shows up; a tenth in production.
    tracesSampleRate: isDevelopment ? 1.0 : 0.1,
    // Trace headers go to Pearfit's own API only.
    tracePropagationTargets: [/^\/api\//],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
})();
