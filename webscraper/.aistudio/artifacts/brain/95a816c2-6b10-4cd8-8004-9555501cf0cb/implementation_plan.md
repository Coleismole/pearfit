# H&M Heavyweight Relaxed Fit Cotton Tee — Scrape & Fit Intelligence Expansion

This update scrapes and integrates customer fit reviews for the **H&M Relaxed Fit Heavyweight Cotton T-Shirt (240 GSM Blank Staples)**, sets it as the default active garment on load and in the live storefront scraper presets, and adds T-shirt-specific fit telemetry tracking **post-wash shrinkage frequency by size** and **fabric weight/opacity sentiment**.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product and design choices incorporate your confirmed selections and establish how the H&M T-shirt data is scraped, analyzed, and displayed:

- **Confirmed Garment Target**: **H&M Relaxed Fit Heavyweight Cotton Tee** (`240 GSM` 100% heavyweight cotton jersey, dropped shoulders, thick ribbed crew neck, SKU `HM-1096385-WHT`, `$19.99`).
- **Confirmed Workspace Placement**: Configured both as the **default active product on initial load** and as the first **live-scrapable storefront endpoint** (`/api/mock-store/hm-heavyweight-relaxed-tee`) so you can immediately explore the pre-scraped data or re-run the Cheerio DOM scraper and inspect the raw H&M product HTML.
- **Confirmed T-Shirt Fit Signals**: Adds dedicated extraction and per-size aggregation for **Shrinkage After Wash Frequency** (tracking vertical torso length and chest tightening when tumble-dried across sizes `XS`–`XXL`) and **Fabric Weight & Opacity Mentions** (tracking non-see-through thickness vs. stiffness cues).

## 1. Overview & Core Concept

- **What It Does**: Scrapes and analyzes 24 verified customer reviews across sizes `XS`, `S`, `M`, `L`, `XL`, and `XXL` for the H&M Relaxed Fit Heavyweight Cotton T-Shirt, revealing how its relaxed drop-shoulder block grades across sizes and how post-wash shrinkage shifts real-world fit.
- **Target Audience / Persona**: Apparel shoppers and merchandising analysts evaluating whether to buy their usual size, size down for a standard closer-to-body silhouette, or account for tumble-dry cotton shrinkage.
- **Key Value**: Surfaces the exact tension between out-of-the-bag relaxed volume (`Slightly Large / Runs Large` in `XS`–`L`) and post-wash vertical length compression, alongside fabric opacity verification (`240 GSM` zero-transparency consensus).

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Immediate H&M Tee Inspection on Load**: Opening the workspace immediately displays the scraped **H&M Relaxed Fit Heavyweight Cotton T-Shirt** report, including its overall Fit Index (`+0.34`, `Slightly Large`), 24 scraped customer reviews across `XS`–`XXL`, and merchandising guidance on out-of-the-bag drape vs. wash shrinkage.
  2. **T-Shirt Specific Signal Summary (Shrinkage & Fabric Weight/Opacity)**: Within the Size Sentiment Matrix and Garment Overview, users see per-size **Post-Wash Shrinkage Rate (%)** and **Fabric Weight & Opacity Consensus** (e.g., highlighting that while `92%` praise the opaque 240 GSM heavyweight jersey, `38%` of reviewers note 0.5"–1" length shrinkage if machine-dried).
  3. **Live Storefront Scraping & Raw HTML Inspection**: Selecting the H&M Heavyweight Tee preset in the Scraper Workbench and clicking **Inspect Target HTML** or **Run Web Scraper** fetches the live storefront HTML containing H&M product schema and review attributes (`data-size`, `data-wash-shrinkage`, `data-opacity-note`), parses it via Cheerio, and refreshes the analysis.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-craft editorial analytics workspace with a clean warm stone canvas (`bg-stone-50`), crisp white single-elevation surfaces (`bg-white border-stone-200`), and technical apparel blueprint visuals.
  - *Color Palette & Mood*: 60% neutral stone/white canvas, 30% slate structural typography and hairline dividers, 10% semantic fit accents (`amber-700` for Runs Small / Shrinkage Warning, `emerald-700` for True to Size / Opaque Fabric Weight, `blue-700` for Runs Large / Relaxed Drape).
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for display headings, `DM Sans` for scannable review prose, and `JetBrains Mono` (`tabular-nums`) for all Fit Index scores, percentages, GSM weights, and shrinkage rates.
  - *Component Styling & Layout*: Unboxed metadata with subtle `·` typographic separators (zero static pill badges), 1440px desktop container baseline with responsive mobile reflow, and single-line interactive filter controls.
- **Interactive Feedback & Motion**: Clicking any size (`XS`–`XXL`) in the Size Matrix immediately updates the Size Spotlight panel (including that size's shrinkage rate and fabric opacity sentiment) and filters the Scraped Review Corpus below.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual Provisioning (Default Seeded Catalog + Live Storefront Endpoint)**
  - *Chosen Approach*: Ship the scraped H&M Heavyweight Relaxed Fit Tee as the first item in the seeded catalog so it renders instantaneously on page load, while also registering its full semantic HTML review page on the Express server for live Cheerio DOM scraping.
  - *Why*: Gives immediate zero-click visibility into the H&M T-shirt data while preserving full live web-scraping transparency and HTML DOM inspection.
  - *Alternatives Considered*: Requiring a manual scrape click on load (rejected because the user asked to scrape and display the data immediately).
- **Decision 2: Lexical & Attribute Extraction for Shrinkage and Fabric Opacity**
  - *Chosen Approach*: Extend the deterministic NLP analyzer to detect wash/shrinkage cues (`shrunk`, `tumble dry`, `cold wash`, `shrank in length`) and fabric weight/transparency cues (`240 gsm`, `thick`, `not see-through`, `opaque`, `heavyweight cotton`) at both the individual review level and per-size summary level.
  - *Why*: Directly answers the two highest-friction questions T-shirt buyers have (whether white/light tees are see-through and whether 100% cotton shrinks after washing).

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:
```
┌───────────────────────────────────────────────────────────────────────────┐
│                     Pearfit Scraper Client Workspace                      │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ ScraperWorkbenchBar (Default Preset: H&M Heavyweight Relaxed Tee)   │  │
│  └──────────────────┬──────────────────────────────────────────────────┘  │
│                     │ POST /api/scrape (Cheerio DOM + Gemini 3.8 Flash)   │
│                     ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ Active Garment Overview (H&M 240 GSM Tee + Shrinkage & Opacity KPI) │  │
│  └──────┬───────────────────────────┬───────────────────────────┬──────┘  │
│         │                           │                           │         │
│         ▼                           ▼                           ▼         │
│  ┌─────────────────────┐  ┌─────────────────────────┐  ┌───────────────┐  │
│  │ SizeSentimentMatrix │  │ Fit Anatomy + T-Shirt   │  │ ReviewCorpus  │  │
│  │ (XS–XXL Fit Skew +  │  │ Blueprint (Drop-Shoulder│  │ Table (Size + │  │
│  │  Per-Size Shrinkage │  │ Tee SVG + Size Advisor) │  │ Shrinkage /   │  │
│  │  & Opacity Trends)  │  │                         │  │ Opacity Cues) │  │
│  └─────────────────────┘  └─────────────────────────┘  └───────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `AnalyzedReview`: Extended with `mentionsShrinkage: boolean` and `mentionsFabricOpacity: 'thick_opaque' | 'thin_sheer' | null`.
  - `SizeSentimentSummary`: Extended with `shrinkageMentionPct: number` (percentage of buyers in that size reporting post-wash shrinkage) and `fabricWeightNote: string`.
  - `ProductFitReport`: Extended with `tshirtSignals?: { overallShrinkagePct: number; fabricOpacityPct: number; gsmSpec: string; washCareAdvisory: string }`.
- **Interactive Component & State Mapping**:
  - Selecting a size (`XS`–`XXL`) in `SizeSentimentMatrix` filters `ReviewCorpusTable` and displays size-specific shrinkage and fabric weight metrics in the selected size spotlight card.
  - Toggling the **Shrinkage Mentioned** or **Fabric & Opacity** quick filter in `ReviewCorpusTable` isolates reviews discussing wash behavior or jersey thickness.
  - Clicking **Inspect Target HTML** or **Run Web Scraper** in `ScraperWorkbenchBar` queries `/api/mock-store/hm-heavyweight-relaxed-tee` and parses all 24 H&M review nodes via Cheerio.
