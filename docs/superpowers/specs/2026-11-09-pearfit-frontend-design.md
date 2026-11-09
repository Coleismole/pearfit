# Pearfit frontend: design system and app spec

Status: draft for review. No app code exists yet. Approving this spec unlocks the implementation plan,
not implementation.

Reference design: `docs/design/tailor/index.html` (open in a browser; Check screen, then Result).
Canonical garment drawing: `docs/design/tailor/shirt.svg`.
Research behind it (not committed): colossal.com captures, decoded into the system below.

## 1. Intent

**What the team asked for**
- The shopper-facing app for pearfit.app, for D2C shoppers who care how they look.
- Desktop-first web. Paste a product link, get "Get the M, fits like your blue Uniqlo oxford" with a
  confidence level.
- Closet stored in Supabase behind real accounts.
- Next.js + Tailwind in a new `app/` folder that imports the pure engine from `engine/src`.
- Visual system borrowed from colossal.com (type contrast, grid, hairlines, restraint, motion), in
  direction C "Tailor": ecru paper, ink, chalk red, measuring-tape ticks.
- Banned: over-explained UI, badges or kickers above headlines, purple gradients.
- Free fonts now behind tokens, licensed fonts later. Structural labels allowed sparingly.

**Assumptions (correct these in review)**
- v1 screens: sign in, closet, add/edit shirt, check, reading (scrape wait), result. Gmail import,
  the browser extension and bottoms are out of v1.
- Tops only, three dimensions (chest, length, sleeve), matching `engine/src/types.ts`.
- The existing `website/` marketing page is untouched.

**Success**
- A shopper with 1+ "great" shirt in their closet pastes a supported product link and sees the
  engine's size, verdict, confidence and ranking, with numbers identical to
  `npm run recommend` for the same inputs.
- Every screen passes the automated design checks in section 9.

## 2. Principles
1. **One idea per screen.** The answer is the screen. Everything else is subordinate or absent.
2. **Trust the user.** No helper text, subtitles, captions or explainer paragraphs. A line of text
   ships only if the screen fails without it. Errors are the exception: they say what happened and
   what to do.
3. **Numbers are mono, words are sans.** Martian Mono only carries sizes, cm, %, counts and the
   section numbers `01`/`02`. Never decorative labels.
4. **Measured, not decorated.** Hairlines, tape ticks and the shirt draft carry the craft. No
   shadows, no gradients, no rounded cards, no icons where a word works.
5. **The engine decides, the UI reports.** The UI never computes a size, a %, a confidence or a
   match band. It renders `Recommendation` as returned and only chooses wording for fields the engine
   supplies. Missing values render as `—`, never a guess.

## 3. Tokens

All tokens live in one CSS file (`app/src/styles/tokens.css`) as custom properties and are exposed
to Tailwind v4 through `@theme`. Components never use raw hex or px outside this scale.

### Colour
| Token | Value | Use |
|---|---|---|
| `--paper` | `#F2EEE5` | page background |
| `--paper-glass` | `rgba(242,238,229,0.72)` | fixed header behind `blur(20px)` |
| `--band` | `#E8E2D5` | full-bleed bands (ranking, closet list) |
| `--ink` | `#1A1A17` | text, rules, strokes |
| `--ink-2` | `#6E6A60` | secondary text and placeholders, **on paper only** |
| `--rule` | `rgba(26,26,23,0.25)` | hairlines |
| `--chalk` | `#B42A1E` | the one accent: hover fills, chosen size, high-confidence dot, errors |

Measured contrast (WCAG): ink/paper 15.06, ink/band 13.51, ink-2/paper 4.66, chalk/paper 5.51,
chalk/band 4.94, paper on chalk 5.51. **ink-2/band is 4.18 and is not allowed**; text on a band is
ink. No other colours. No purple, no gradients.

Errors use chalk plus words, never colour alone. Chalk is also the accent, so an error is always a
sentence, not a red field outline by itself.

### Type
| Token | Value |
|---|---|
| `--font-display` | `"Martian Mono"`, `font-stretch: 112%` (axis max), weights 100 and 300 |
| `--font-text` | `"Urbanist"`, weights 300, 400, 500 |

Swapping in the licensed Colossal faces later (NB Architekt for display, Telegraf for text) is a
change to these two tokens only.

Scale, px (desktop): **280** (size hero only), 200, 112, 72, 48, 32, 22, 18, 16, 13. Nothing else.
Body default 18/1.3 Urbanist 300. Letter-spacing 0 everywhere. No uppercase transforms in v1.

| Role | Font | Size | Weight |
|---|---|---|---|
| Size hero ("M") | display | 280 | 100 |
| Link entry | text | 72 | 300 |
| Verdict | text | 48 | 300 |
| Chosen size in spread | display | 48 | 300, chalk |
| Other sizes, %, row names | display / text | 32 | 300 |
| Confidence word, pill label | text | 22 | 300-400 |
| Body, closet items, dims | text | 18 | 400 |
| Nav, quiet links, section numbers | text / display | 16 | 400 / 300 |
| Diagram labels | display | 13 | 300 |

### Space and grid
- Spacing scale (px): 8, 16, 24, 32, 40, 48, 56, 64, 72, 120, 220.
- **Desktop-first.** Designed and verified at 1280x800, 1440x900 and 1920x1080 browser windows.
  12 columns, 30px gutters, header aligned to the column at every width.
- Content column: `min(1600px, 100vw - 2 x margin)`, margin by window width:

  | Window | Side margin | Column |
  |---|---|---|
  | ≥ 1800 | 160 | 1600 (cap) |
  | 1440-1799 | 115 | 1210 at 1440 |
  | 1280-1439 | 80 | 1120 at 1280 |
  | 1024-1279 | 48 | fluid |

- Type sizes do not scale with the window; the extra width goes to whitespace and the column cap.
- The result's first screen shows the answer and the top of the ranking without scrolling at
  1440x900 and 1920x1080. No section is forced to `100vh` except Check, which is a single input.
- Never size to `100vw` without `overflow-x: clip` on `html` (desktop scrollbars count inside `vw`).
- Mobile layouts are out of v1, but nothing may overflow horizontally down to 1024px.

### Shape, lines, motion
- Radius 0 everywhere. Pills only: `999px`. Circles only for the confidence node.
- `box-shadow: none` globally.
- Hairline: 1px `--rule`. Strong rule (input underline, row borders on paper): 1px `--ink`.
- **Tape** replaces Colossal's "+" marks: an SVG pattern of 1px ticks every 8px, longer every 40px,
  14px tall. Use at most two per screen: under the header on result and closet, and above the
  ranking or closet list.
- Motion: `ease` only. 300ms for hover and state changes; 1000ms fade-in for the size hero; the
  reading screen's timer updates once a second without animation. Everything sits inside
  `@media (prefers-reduced-motion: no-preference)`.
- z-index: content 0, header 10, overlay/dialog 20.

## 4. Copy rules
- Sentences end with a full stop. Sentence case everywhere. No exclamation marks.
- The verdict line is phrased by the UI from structured engine fields (section 7, step 3), using the
  shirt's name as the user typed it:
  - band 0: "Fits like your {name}."
  - band 1: "Closest to your {name}, {gap}." (gap is the engine's phrase, e.g. "2.0cm looser in the
    chest"; omitted when null)
  - band 2: "No close match. Nearest is your {name}."
  - no size: the engine's `verdict` sentence as-is.
- Button labels are a verb plus a noun at most: "Check", "Shop the M", "Add shirt", "Save".
- Pills carry a trailing mono "+" or "→" glyph; it is decoration, hidden from screen readers.
- Banned anywhere: eyebrow or kicker labels above headings, bracketed captions like "[ QUOTE ]",
  tags or chips, subtitles under headings, placeholder-as-instructions longer than four words,
  marketing claims, emoji.

## 5. Components
Each is one file in `app/src/components/`, typed props, no data fetching inside.

| Component | Props (summary) | Notes |
|---|---|---|
| `Header` | `readout?: string` | Fixed, 60px, glass + blur. Wordmark left, `Closet` and `Check` right, readout centred in mono (product name on reading/result only). Active nav item in ink, other in ink-2. |
| `Pill` | `children, glyph?, onClick/href, busy?` | 72px tall, 1px ink border. Hover: chalk fill, paper text. `busy` disables and swaps the glyph for the elapsed seconds. |
| `QuietLink` | `href, children` | 16px, underline rule, chalk on hover. |
| `LinkEntry` | `onSubmit(url)` | 72px input on an ink underline with the `Check` pill. Placeholder "Paste a product link". Validates URL shape on submit only. |
| `SizeHero` | `size: string` | 280px display 100, fades in. `null` size never reaches it (see states). |
| `ConfidenceNode` | `level: high/medium/low` | 22px circle: filled chalk dot, half dot, hollow. Always followed by the word. |
| `SizeSpread` | `sizes: {size, pct}[]`, `chosen` | Mono row; chosen size 48px chalk, others 32px ink. Tape above. |
| `ShirtRow` | `rank, name, pct, ease` | Grid row: rank, name 32px, % mono 32px, then chest/length/sleeve with mono values; `null` → `—`. |
| `Draft` | `ease: Ease` | Inline `shirt.svg`, geometry unchanged, labels at the anchors in the file. A dimension with no ease draws its line at 25% opacity with `—`. |
| `Tape` | `orientation` | The tick pattern. Decorative, `aria-hidden`. |
| `SectionNumber` | `n` | `01`, `02` in 16px mono. The only label allowed above a block. |
| `ClosetItem` | `shirt` | Name in 18px plus the fit word (`great`/`tight`/`loose`) in ink-2 on paper. Click to edit. |
| `MeasureField` | `dim, value, onChange` | Mono number input in cm, 1 decimal, empty = `null`. Label is the dimension word only. |
| `FitChoice` | `value, onChange` | Three-way segmented choice: Great, Tight, Loose. Selected: ink fill, paper text. |

## 6. Screens and states

Routes (App Router): `/signin`, `/closet`, `/closet/new`, `/closet/[id]`, `/` (check),
`/check/[jobId]` (reading, then result).

**Sign in** (`/signin`). Wordmark, one email field, `Continue` pill. After submit: "Check your
email." Nothing else. (Auth method is open question Q1.)

**Closet** (`/closet`). Band with tape above, 4-column grid of `ClosetItem`. One pill: `Add shirt +`.
- Empty: the 72px line "Add a shirt you love." and the pill. No illustration.
- No `great` shirts yet: the result screen cannot rank, so Check shows the line "Add a shirt that
  fits you well." with a link to `/closet/new` instead of the entry.

**Add / edit shirt** (`/closet/new`, `/closet/[id]`). Name field (text, 48px), `FitChoice`, three
`MeasureField`s beside a `Draft` that highlights the dimension in focus. `Save` pill; on edit, a
quiet `Delete` link with a confirm step. Measurement convention (pit-to-pit flat, high shoulder to
hem, shoulder seam to cuff) is shown by the highlighted line in the drawing, not by text. A chest
value over 80 shows the one allowed hint: "That looks like the full chest. Measure across, armpit to
armpit." (mirrors the engine loader's warning). See open question Q3.

**Check** (`/`). As in the reference: `LinkEntry` centred, closet names along the bottom band.

**Reading** (`/check/[jobId]` while pending). Header readout shows the store domain. The 72px line
"Reading the page." and a mono elapsed timer (`00:14`). The tape slowly fills left to right as
time passes against a 90s cap; it reflects elapsed time, not fake progress, and stops at the cap.
Cancel: quiet link "Stop".

**Result** (`/check/[jobId]` when done). As in the reference, top to bottom: placeholder or product
image (4:5, left 4 columns) | `SizeHero`, verdict, `ConfidenceNode`, `SizeSpread`, `Shop the M +`
(links to the product URL) and `Check another`. Band `01`: `ShirtRow`s from `ranking`. Section `02`:
`Draft` with the ease of the top-ranked shirt, plus one line built from data: review agreement or
the first engine note. Engine `notes` beyond the first are not shown in v1.
- Low confidence: same layout; the node is hollow and the word says "Low". No extra warning text.
- `size === null`: no hero. The engine's `verdict` alone at 48px (it explains why, e.g. no great
  shirts or no overlapping measurements), then `Check another`.

**Errors** (inline, replacing the reading line; chalk sentence plus one action):
| Case | Copy | Action |
|---|---|---|
| Invalid URL | "That isn't a product link." | stay on entry |
| Store blocked or fetch failed | "Couldn't read that page." | `Try again`, `Paste the page instead` (Q4) |
| No size chart found | "No size chart on that page." | `Check another` |
| Timed out (90s) | "That page took too long." | `Try again` |
| Not a top / unsupported category | "Pearfit sizes tops for now." | `Check another` |

## 7. Architecture and data flow

```
app/ (Next.js App Router, TypeScript, Tailwind v4)
  src/app/...            routes above
  src/components/...     section 5
  src/lib/supabase.ts    browser + server clients (@supabase/ssr)
  src/lib/scrape.ts      server-only: calls the scraper, maps the response to a Candidate
  src/app/api/check/route.ts   POST {url} -> starts a job; GET -> job status/result
engine/src               imported directly (pure, no I/O); the app adds no logic to it
webscraper/              unchanged; runs as its own server in dev
```

1. Check submits the URL to `POST /api/check` (server). It creates a job row and calls the scraper's
   `POST /api/scrape {url}`. Locally the scraper runs on `:3000` (`webscraper: npm run dev`); in
   production it is `pearfit.app/scraper/api/scrape`. The base URL is an env var
   (`SCRAPER_URL`), listed in `app/.env.example`.
2. The scraper returns `{ report, sizeChart }`. `scrape.ts` maps them to the engine's `Candidate`:
   `sizeChart` rows in `sort_order` become `sizes`; the review signal comes from the report's
   runs-small/true-to-size/runs-large percentages using the same rule as
   `engine/cli/export-candidates.ts`. That rule moves into `engine/src` as a pure function so the app
   and the exporter share one implementation (engine change with a hand-computed unit test, per
   AGENTS.md). No size chart → the "No size chart" error; never a guessed chart.
3. The server loads the signed-in user's closet from Supabase, maps rows to `OwnedShirt[]` and calls
   the engine's `recommend`. The `Recommendation` is stored on the job and returned as-is.
   Engine change: today `verdict` is a finished English string built from the shirt id ("Get the M,
   fits like your blue uniqlo oxford."), which repeats the hero size and loses capitalisation.
   `Recommendation` gains `match: { band: 0 | 1 | 2, shirtId: string, gap: string | null } | null`,
   computed by the same code that builds `verdict` today. `verdict` stays unchanged for the CLI and
   eval. Ships with a hand-computed unit test per band.
4. The reading screen polls `GET /api/check?id=` every 2s until done, failed or 90s.

**Supabase (proposal; schema reviewed in the plan with the data-modeling and migration skills)**
- Auth: Supabase Auth (method: Q1). RLS on every table, owner-only.
- `closet_shirts`: `id uuid pk`, `user_id uuid not null references auth.users`, `name text not null`,
  `fit text not null check (fit in ('great','tight','loose'))`, `chest_cm numeric(4,1) null`,
  `length_cm numeric(4,1) null`, `sleeve_cm numeric(4,1) null`, `created_at timestamptz default now()`.
  The engine's `id` is derived from `name` (lowercase, dashes) at mapping time.
- `checks`: `id uuid pk`, `user_id`, `url text`, `status text check (status in
  ('pending','done','failed'))`, `result jsonb null`, `error text null`, `created_at`.
- The existing shared fit store (`commit_fit_report`) is untouched. The scraper keeps writing to it.

**Repo rule changes (in the same PR as the scaffold):** AGENTS.md "First MVP has no frontend" becomes
"`app/` is the shopper web app (Next.js); it imports engine types and functions, never the reverse",
and gains `app/` commands. `app/` has its own `package.json`, like `webscraper/`.

**Local hosting:** `cd webscraper && npm run dev` (scraper, :3000) and `cd app && npm run dev`
(app, :3001). A Supabase project URL and publishable key go in `app/.env.local`; nothing secret is
committed.

## 8. Accessibility
- Contrast pairs restricted as in section 3. Focus ring: 2px chalk outline, 2px offset, on every
  interactive element; never removed.
- Every input has a real `<label>` (visually it is the dimension word or the field's role; the link
  entry's label is visually hidden: "Product link").
- Size hero has `aria-label="Recommended size M"`; the `Draft` has a text alternative listing the
  three differences; tape and glyphs are `aria-hidden`.
- Keyboard: tab order follows visual order; `Enter` submits the link entry; dialogs trap focus and
  close on `Escape`.
- Reduced motion: no fade, no tape fill animation (the timer still counts).

## 9. Verification (required for every task in the plan)
Nothing is reported as working until these pass and the output is shown.
1. `engine`: `npm test` and `npm run typecheck` (unchanged engine behaviour; new shared review-signal
   function has a hand-computed test).
2. `app`: `npm run typecheck`, `npm run lint`, unit tests for `scrape.ts` mapping (fixtures from a
   real scraper response, including null dims and no size chart).
3. Design checker (Playwright, adapted from the mockup verifier) on every route at 1280x800,
   1440x900, 1920x1080 and 1024x768: header aligned to the content column, fonts actually loaded (FontFace status), no box-shadow, no gradient, no purple hue, no
   horizontal overflow, every font-size on the scale, no element above a heading except
   `SectionNumber`, contrast of every text node ≥ 4.5:1 against its background.
4. Golden check: for the sample closet and `cos-oxford`, the result screen shows M / High / 84.6% /
   S 70 M 85 L 35, identical to `npm run recommend -- sample cos-oxford`.
5. Screenshots of each screen and state are viewed by a person (or the managing agent) before a task
   is called done.

## 10. Out of scope (v1)
Gmail import, browser extension, bottoms and other categories, mobile layouts below 1024px, dark
mode, product photos from the store (placeholder block until image extraction exists), sharing,
analytics beyond the existing PostHog setup, editing engine weights from the UI.

## 11. Open questions (need a decision before the plan)
- **Q1 Auth method.** Email magic link (no passwords, matches the minimal sign-in screen) or Google
  OAuth (one click, and later reusable for Gmail import)?
- **Q2 Scraper in production.** The app calls the scraper on Vercel at `pearfit.app/scraper`, whose
  SQLite is ephemeral and which runs under a 50s budget. Acceptable for v1, or should the app only
  target local dev until the scraper has a durable home?
- **Q3 Measuring a shirt.** Adding a shirt needs three hand measurements. The design teaches the
  convention through the drawing, with no instructions. Is that enough for a first-time user, or do
  we allow one short line per field (which breaks principle 2)?
- **Q4 Blocked stores.** Many stores block scraping. Offer "Paste the page instead" (the scraper
  already accepts raw HTML), or only show the failure in v1?
