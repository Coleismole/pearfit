# FitPulse marketing site

Static landing page selling FitPulse to apparel brands (B2B). No build step.

- Preview: open `index.html` in a browser, or `npx serve website`.
- Deploy: GitHub Pages via `.github/workflows/pages.yml` on every push to `main` that touches
  `website/` (Settings -> Pages -> Source: "GitHub Actions").
- Before launch: set `PILOT_INBOX` in `app.js` to the real team inbox (or replace the
  pilot form handler with a real endpoint). The demo matrix uses illustrative data.
