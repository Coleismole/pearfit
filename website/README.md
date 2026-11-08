# Pearfit Marketing Site

Static landing page for **Pearfit**. No build step.

The page describes what exists today: a scraper that stores numerical fit values, and a separate comparison engine. The hero silhouette and the size matrix are samples. The ROI calculator uses the numbers a visitor types in.

## Contents
- `index.html` — Page markup.
- `styles.css` — Stylesheet, including a dark color scheme.
- `app.js` — Sample silhouette, sample size matrix, ROI model, and the inquiry form.

## Preview
Open `website/index.html` in a browser, or run `npx serve website`.

`website/vercel.json` publishes this folder by itself. The repo root `vercel.json` publishes this folder at `pearfit.app` and the scraper at `pearfit.app/scraper`. For that combined site, the Vercel project's Root Directory must be the repository root.

## Inquiries
The form posts the inquiry to `customerservice@pearfit.app` through FormSubmit. The first submission asks that inbox to confirm the address. After that, each form send delivers the email.
