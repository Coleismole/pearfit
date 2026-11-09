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
- v1 screens: sign in, closet, add shirt, check, result, plus the "requested" state for links the
  database does not have yet. Gmail import, the browser extension and bottoms are out of v1.
- Tops only, three dimensions (chest, length, sleeve), matching `engine/src/types.ts`.
- The app never calls the scraper. It reads products and size charts the scraper stored in Supabase
  and files scrape requests for links it does not have (D4).
- Closet shirts are added from a product link too: the user picks the size they own and the chart
  supplies the measurements. Nobody measures a shirt by hand in v1 (D3).
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
  page-level transitions are none. Everything sits inside
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
| `Pill` | `children, glyph?, onClick/href, busy?` | 72px tall, 1px ink border. Hover: chalk fill, paper text. `busy` disables it while a lookup or save is in flight. |
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
| `SizePicker` | `sizes: string[], value, onChange` | The chart's sizes in order as 48px mono letters on one line; selected in chalk with an ink underline. A radio group for assistive tech. |
| `FitChoice` | `value, onChange` | Three-way segmented choice: Great, Tight, Loose. Selected: ink fill, paper text. |

## 6. Screens and states

Routes (App Router): `/signin`, `/closet`, `/closet/new`, `/` (check), `/result/[sku]`.

**Sign in** (`/signin`). Wordmark, a `Continue with Google` pill, a hairline, then one email field
with a `Send link` pill (magic link). After sending: "Check your email." Nothing else (D1).

**Closet** (`/closet`). Band with tape above, 4-column grid of `ClosetItem`. One pill: `Add shirt +`.
- Empty: the 72px line "Add a shirt you love." and the pill. No illustration.
- A shirt whose page is not in the database yet shows its store domain as the name and `—` as the
  size until the scraper has read it (see "Requested").

**Add shirt** (`/closet/new`). Step 1: `LinkEntry` with placeholder "Link to your shirt".
Step 2 (found): product name at 48px, `SizePicker` with the chart's sizes, `FitChoice`,
`Save` pill. The shirt's measurements are the chart row for the chosen size, copied as stored
(nulls stay null). There is no manual measurement entry (D3). Edit = change size or fit; `Delete`
is a quiet link with a confirm step.

**Check** (`/`). As in the reference: `LinkEntry` centred, closet names along the bottom band.
- No `great` shirts yet: the line "Add a shirt that fits you well." with a link to `/closet/new`
  replaces the entry.

**Result** (`/result/[sku]`). The lookup is a database read, so there is no wait screen. As in the
reference, top to bottom: placeholder (4:5, left 4 columns) | `SizeHero`, verdict,
`ConfidenceNode`, `SizeSpread`, `Shop the M +` (links to the product's `source_url`) and
`Check another`. Band `01`: `ShirtRow`s from `ranking`. Section `02`: `Draft` with the ease of the
top-ranked shirt, plus one line built from data (review agreement or the first engine note).
- Low confidence: same layout; hollow node, the word "Low". No extra warning text.
- `size === null`: no hero. The engine's `verdict` alone at 48px, then `Check another`.

**Requested** (a link the database does not have, from Check or Add shirt). The app saves a scrape
request and shows the 72px line "We'll read this page." with `Check another`. The request stays
listed under the entry on Check (store domain plus mono request time) until it resolves; opening
the app re-checks pending requests. When the scraper has stored the product, the item links to its
result (or, from Add shirt, continues to step 2).

**Errors** (chalk sentence plus one action):
| Case | Copy | Action |
|---|---|---|
| Invalid URL | "That isn't a product link." | stay on entry |
| In the database, no size chart | "No size chart for this one." | `Check another` |
| Request failed on the scraper side | "Couldn't read that page." | `Check another` |
| Not a top | "Pearfit sizes tops for now." | `Check another` |
| Network or Supabase error | "Something went wrong. Try again." | `Try again` |

## 7. Architecture and data flow

The app and the scraper never talk to each other. The scraper writes products and size charts to the
shared Supabase project; the app reads them from there (D2, D4).

```
webscraper/ (unchanged runtime) --writes--> Supabase: commercial_skus, sku_size_chart
                                      ^                       |
                     reads requests   |                       | find_fit_product(url)
                                      |                       v
            Supabase: scrape_requests <---writes--- app/ (Next.js) --> engine/src (pure)
```

```
app/ (Next.js App Router, TypeScript, Tailwind v4, own package.json)
  src/app/...            routes above
  src/components/...     section 5
  src/lib/supabase.ts    browser + server clients (@supabase/ssr)
  src/lib/catalog.ts     server-only: find_fit_product -> engine Candidate
  src/lib/closet.ts      server-only: closet rows -> engine OwnedShirt[]
engine/src               imported directly (pure, no I/O)
```

1. **Lookup.** The app normalises the pasted URL (lowercase host, no query string, fragment or
   trailing slash) and calls a new RPC `find_fit_product(url)`. Today the only read path,
   `list_fit_catalog()`, returns the whole catalog with no filter and omits `source_url` and the
   review percentages, so it cannot serve this. `find_fit_product` returns one product: `sku`,
   `brand`, `product_name`, `category`, `source_url`, `total_reviews`, the three runs-small /
   true-to-size / runs-large percentages, and the chart rows in `sort_order`. It is
   `security definer`, read-only, and granted to `authenticated` only. The scraper must store
   `source_url` normalised the same way; one shared normaliser in TypeScript is used by both.
2. **Candidate.** `catalog.ts` maps the result to the engine's `Candidate`: chart rows become
   `sizes` in order; the review signal uses the rule now in `engine/cli/export-candidates.ts`
   (`reviewSignal`), which moves into `engine/src` as a pure function so the app and the exporter
   share one implementation (unit test with hand-computed cases, per AGENTS.md). No chart rows: the
   "No size chart" error; a chart is never guessed.
3. **Recommend.** The server loads the user's closet, maps it to `OwnedShirt[]`, calls `recommend`,
   and renders the `Recommendation` as returned. Engine change: today `verdict` is a finished English
   string built from the shirt id ("Get the M, fits like your blue uniqlo oxford."), which repeats
   the hero size and loses capitalisation. `Recommendation` gains
   `match: { band: 0 | 1 | 2, shirtId: string, gap: string | null } | null`, computed by the code
   that builds `verdict` today. `verdict` stays unchanged for the CLI and eval. Ships with a
   hand-computed unit test per band.
4. **Miss.** No product for the URL: insert a `scrape_requests` row and show "Requested". Picking up
   requests is the scraper's job and is outside this app (dependency S1 below).

**Supabase tables the app owns (proposal; reviewed in the plan with the data-modeling and migration
skills).** Same Supabase project as the fit store. RLS on, owner-only policies.
- `closet_shirts`: `id uuid pk`, `user_id uuid not null references auth.users`, `sku text null`
  (null while requested), `source_url text not null`, `name text not null`, `size_code text null`,
  `fit text not null check (fit in ('great','tight','loose'))`, `chest_cm`, `length_cm`,
  `sleeve_cm` (`numeric(4,1)`, nullable, copied from the chart at save time), `created_at`.
  The engine's `id` is the row id; display uses `name`.
- `scrape_requests`: `id uuid pk`, `user_id`, `url text not null` (normalised), `status text check
  (status in ('pending','done','failed'))`, `created_at`, `resolved_at null`. Unique on
  `(user_id, url)`. The scraper reads pending rows and sets the status with its own service key.

Copying chart values into `closet_shirts` at save time means a later re-scrape never silently
changes a shirt the user already labelled.

**Dependencies on the scraper side (not built by the app plan)**
- S1: a worker or manual step that scrapes `pending` rows in `scrape_requests` and marks them done
  or failed.
- S2: `find_fit_product(url)` added to `webscraper/fit_store.sql`, and `source_url` stored
  normalised.

**Repo rule changes (in the same PR as the scaffold):** AGENTS.md "First MVP has no frontend" becomes
"`app/` is the shopper web app (Next.js); it imports engine types and functions, never the reverse;
it reads the fit store through RPCs and never calls the scraper", and gains `app/` commands.

**Local hosting (D2):** `cd app && npm run dev` on `:3001` against the shared Supabase project.
Publishable URL and key in `app/.env.local`, names listed in `app/.env.example`. Google OAuth needs a
Google Cloud OAuth client configured in Supabase Auth with `http://localhost:3001` as an allowed
redirect. Nothing secret is committed. Production hosting is out of v1.

## 8. Accessibility
- Contrast pairs restricted as in section 3. Focus ring: 2px chalk outline, 2px offset, on every
  interactive element; never removed.
- Every input has a real `<label>` (the link entry's is visually hidden: "Product link").
- Size hero has `aria-label="Recommended size M"`; the `Draft` has a text alternative listing the
  three differences; tape and glyphs are `aria-hidden`.
- Keyboard: tab order follows visual order; `Enter` submits the link entry; dialogs trap focus and
  close on `Escape`.
- Reduced motion: no fade.

## 9. Verification (required for every task in the plan)
Nothing is reported as working until these pass and the output is shown.
1. `engine`: `npm test` and `npm run typecheck`; new `reviewSignal` and `match` fields have
   hand-computed tests; existing eval output unchanged.
2. `app`: `npm run typecheck`, `npm run lint`, unit tests for `catalog.ts` and `closet.ts` mapping
   (fixtures shaped like real `find_fit_product` output, including null dims and an empty chart),
   and for URL normalisation.
3. RLS: a test signs in as two users and confirms neither can read or write the other's
   `closet_shirts` or `scrape_requests`, and that anon cannot call `find_fit_product`.
4. Design checker (Playwright, adapted from the mockup verifier) on every route at 1280x800,
   1440x900, 1920x1080 and 1024x768: header aligned to the content column, fonts actually loaded,
   no box-shadow, no gradient, no purple hue, no horizontal overflow, every font-size on the scale,
   nothing above a heading except `SectionNumber`, every text node ≥ 4.5:1 against its background.
5. Golden check: with the sample closet and `cos-oxford` seeded, the result screen shows M / High /
   84.6% / S 70 M 85 L 35, identical to `npm run recommend -- sample cos-oxford`.
6. Screenshots of each screen and state are viewed by the managing agent before a task is called
   done.

## 10. Out of scope (v1)
Calling the scraper from the app, pasting page content, manual measurement entry, Gmail import,
browser extension, bottoms and other categories, mobile layouts below 1024px, dark mode, product
photos (placeholder block until image extraction exists), production hosting, realtime updates for
requests (re-checked on load instead), editing engine weights from the UI.

## 11. Decisions (2026-11-09)
- **D1 Sign-in:** both Google OAuth and email magic link, through Supabase Auth.
- **D2 Hosting:** local development only for v1.
- **D3 Closet measurements:** come from scraped size charts (link + size owned). No hand measuring.
  No chart or no page means the shirt cannot be added yet.
- **D4 Unknown links:** the app saves a scrape request; the scraper picks it up. This replaces the
  earlier "paste the page" answer, which cannot work because the app does not run the scraper.
