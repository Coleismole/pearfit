# Pearfit Marketing & Investor Site

Static landing page for **Pearfit** — proprietary size intelligence that cuts returns for apparel brands and delivers better-fitting clothing for shoppers. No build step required.

## Contents
- `index.html` — Full page markup (Hero with interactive garment silhouette overlay, Two-Sided Value Engine, Live Fit Insights Sandbox, Proprietary Architecture, ROI & Bracketing Tax Calculator, Cohort Proof + True Fit Comparison Matrix, and Pilot / Investor Inquiry forms).
- `styles.css` — Complete stylesheet (`Fraunces` editorial serif, `Plus Jakarta Sans` body prose, `JetBrains Mono` tabular metrics, responsive layout, and dark-mode support).
- `app.js` — Zero-dependency interactive logic (2-layer SVG garment silhouette morphing, per-size review sentiment engine, exact integer-reconciled ROI & Bracketing Tax calculator, and Pilot/Investor mode switching).

## Preview & Deployment
- **Local Preview**: Open `website/index.html` directly in any browser, or run `npx serve website`.
- **GitHub Pages / Static Hosting**: Point your static host or `.github/workflows/pages.yml` at the `website/` directory.
- **Inbox Configuration**: Update `PILOT_INBOX` (`hello@pearfit.com`) and `INVESTOR_INBOX` (`investors@pearfit.com`) at the top of `app.js` before launch.
