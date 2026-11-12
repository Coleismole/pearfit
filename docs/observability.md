# Observability

Read this before you add, remove or change error reporting, analytics or session recording.

## Who does what
| Need | Tool | Where it runs |
| --- | --- | --- |
| Product analytics, session replay, browser exceptions | PostHog | `website/` and the scraper page, loaded from `/api/posthog-config` (`website/posthog-init.js`, `webscraper/analytics.ts`) |
| Errors and traces from the shopper app | Sentry (`pearfit-app`) | `app/src/instrument.ts` |
| Errors and traces from the server | Sentry (`pearfit-api`) | `engine/api/sentry.ts` (the Vercel API functions) and `webscraper/server/instrument.ts` (the scraper server) |

PostHog already records replays and captures browser exceptions for the project, so the website and the
scraper page do not load Sentry. The shopper app has no PostHog, so it keeps Sentry for errors.

## Consent and the privacy notice
- PostHog and Vercel Speed Insights load only after the visitor accepts analytics in the banner (`website/consent.js`).
  No answer means no. The answer is `pearfit.consent.v1` in local storage; the scraper page shares the origin and
  `webscraper/analytics.ts` reads the same key, so it sends nothing unless it says `granted`. Declining after accepting
  stops PostHog and clears what it stored; Speed Insights stops from the next page.
- `website/privacy.html` is what visitors are told. Anything that sends visitor data to a new service, loads a script
  or font from another host, or stores something new in the browser must be named there first. `website/test/privacy.test.mjs`
  fails on an outside host the site code mentions that the test does not know, and on a storage key the app uses that
  the notice does not list.
- Fonts are served from `website/fonts/` and `webscraper/fonts/` (SIL Open Font License). Do not add a font service.
- Sentry in the app and the API is not behind the banner: it sends errors, not usage, and no session replay. The privacy
  notice says so. If that changes, change the notice.

## Rules
- Do not run both tools for the same job. Browser errors and replay on a page that loads PostHog stay in PostHog.
- Replays and autocapture must skip forms that hold what a visitor typed: give the form the `ph-no-capture` class (the demo
  form and the inquiry form have it).
- The shopper app sends no Session Replay and no trace headers. Its wardrobe form holds body measurements, and
  the API's CORS rules allow `Content-Type` only, so `sentry-trace` and `baggage` make the browser block the call.
- A DSN is a public ingest key, so its default sits in code (the committed bundles are built without env vars).
  `VITE_SENTRY_DSN` (app) and `SENTRY_DSN` (engine, scraper server) override it; an empty value turns Sentry off.
- `engine/src/` never imports Sentry. Only `engine/api/recommend.ts` and `candidates.ts` do, through `engine/api/sentry.ts`;
  handlers report caught errors through the optional `onError` dependency.
- `engine/scripts/build-api.mjs` resolves `@sentry/node` from `webscraper/node_modules`, because CI installs only
  `webscraper/` and `app/`. Keep it that way, or `Check generated bundles` fails.
- Sample rates: every trace outside production, one in ten in production.
- Never put review text, product URLs, pasted HTML or measurements in an error message or an event.

## Check that it works
- Errors: throw in the running app, then `sentry issue list peafitapp/<project> --period 1h`. Projects: `pearfit-app`, `pearfit-api`.
- PostHog: `execute-sql` on `events` for `$exception` and `$pageview`, with a timestamp bound.
- Source maps for the minified browser bundle are not uploaded yet. That needs a `SENTRY_AUTH_TOKEN` created by the team.

## Related
- Event names and the analytics allow-list: `website/README.md`, `webscraper/analyticsEvents.ts`.
- Which file is generated and how it is rebuilt: `deploy.md`.
