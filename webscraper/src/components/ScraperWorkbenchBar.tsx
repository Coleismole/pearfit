import React, { useState } from 'react';
import {
  Globe,
  Code2,
  Database,
  Loader2,
  Eye,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import {
  aggregateProductFitReport,
  parseRawReviewBatch,
  ProductFitReport,
} from '../utils/fitAnalyzer';
import { SCRAPABLE_PRESET_TARGETS } from '../data/seedCatalog';

function supabaseNote(sync: { ok?: boolean; error?: string; skipped?: boolean; reason?: string } | null): string {
  if (!sync) return '';
  if (sync.ok) return ' Fit values were sent to Supabase.';
  if (sync.error) return ` Supabase was not updated: ${sync.error}`;
  if (sync.skipped) return '';
  return '';
}

interface Props {
  onScrapedReportReady: (
    report: ProductFitReport,
    dbState?: {
      reports: ProductFitReport[];
      stats: { skuCount: number; sizeMetricRows: number; reviewRows: number };
    }
  ) => void;
  onBatchCommitted: (dbState: {
    reports: ProductFitReport[];
    stats: { skuCount: number; sizeMetricRows: number; reviewRows: number };
  }) => void;
}

const SAMPLE_HTML_BATCH = `<article class="review-card" data-size="XS" data-rating="5" data-author="Buyer_101">
  <h4>Fits true to size in XS</h4>
  <p>True to size! Fits perfectly in the shoulders and waist with a clean tailored drape. Opaque heavyweight cotton.</p>
</article>
<article class="review-card" data-size="S" data-rating="4" data-author="Buyer_102">
  <h4>Slightly snug chest</h4>
  <p>True to size in the waist and length, slightly snug across the bust.</p>
</article>
<article class="review-card" data-size="M" data-rating="2" data-author="Buyer_103">
  <h4>Runs small in M — tight shoulders</h4>
  <p>Runs small! Way too tight across the shoulders and pulls at the chest buttons. Size up.</p>
</article>
<article class="review-card" data-size="L" data-rating="2" data-author="Buyer_104">
  <h4>L fits like a Small</h4>
  <p>Runs very small in size L. Constricting in the sleeves and tight in the chest and waist. Shrunk after wash.</p>
</article>
<article class="review-card" data-size="XL" data-rating="2" data-author="Buyer_105">
  <h4>Shrunk and runs small</h4>
  <p>Smaller than expected and shrunk after wash. Tight across the shoulders and short in the torso.</p>
</article>
<article class="review-card" data-size="XXL" data-rating="3" data-author="Buyer_106">
  <h4>Size up for XXL</h4>
  <p>Runs small through the bust and armholes. Order a size larger if between sizes.</p>
</article>`;

export const ScraperWorkbenchBar: React.FC<Props> = ({
  onScrapedReportReady,
  onBatchCommitted,
}) => {
  const [scrapeMode, setScrapeMode] = useState<'url' | 'batch'>('url');
  const [targetUrl, setTargetUrl] = useState<string>(
    SCRAPABLE_PRESET_TARGETS[0].url
  );
  const [customSku, setCustomSku] = useState<string>('HM-1190402-BLK');
  const [customProductName, setCustomProductName] = useState<string>(
    'Heavyweight Boxy Pocket Tee'
  );
  const [customBrand, setCustomBrand] = useState<string>('H&M Blank Staples');
  const [customCategory, setCustomCategory] =
    useState<ProductFitReport['category']>('T-Shirts & Tops');
  const [rawInput, setRawInput] = useState<string>(SAMPLE_HTML_BATCH);
  const [autoCommitToDb, setAutoCommitToDb] = useState<boolean>(true);
  const [isScraping, setIsScraping] = useState<boolean>(false);
  const [isBatchScraping, setIsBatchScraping] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [commitBanner, setCommitBanner] = useState<string | null>(null);
  const [inspectedHtmlPreview, setInspectedHtmlPreview] = useState<string | null>(
    null
  );

  const handleSelectPreset = (presetUrl: string) => {
    setScrapeMode('url');
    setTargetUrl(presetUrl);
    setErrorMessage(null);
    setInspectedHtmlPreview(null);
  };

  const handleInspectPresetDom = async () => {
    if (inspectedHtmlPreview) {
      setInspectedHtmlPreview(null);
      return;
    }
    try {
      const cleanPath = targetUrl.replace(/^https?:\/\/[^/]+/, '');
      if (cleanPath.startsWith('/api/mock-store/')) {
        const res = await fetch(`${cleanPath}/raw`);
        if (res.ok) {
          const data = await res.json();
          setInspectedHtmlPreview(data.html);
          return;
        }
      }
      setErrorMessage(
        'Live DOM source preview is available for the built-in storefront endpoints (/api/mock-store/*).'
      );
    } catch {
      setErrorMessage('Could not load raw HTML preview.');
    }
  };

  const handleExecuteScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setCommitBanner(null);

    if (scrapeMode === 'url') {
      if (!targetUrl.trim()) {
        setErrorMessage(
          'Please enter a target product URL or select a storefront endpoint before running the scraper.'
        );
        return;
      }
    } else {
      if (!rawInput.trim()) {
        setErrorMessage(
          'Please paste HTML review markup or plain-text customer reviews before running the scraper.'
        );
        return;
      }
      if (!customProductName.trim()) {
        setErrorMessage('Please enter a garment title for the database record.');
        return;
      }
    }

    setIsScraping(true);
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          scrapeMode === 'url'
            ? { url: targetUrl.trim(), commitToDb: autoCommitToDb }
            : {
                rawHtml: rawInput.trim(),
                productName: customProductName.trim(),
                brand: customBrand.trim() || 'Commercial Vendor',
                sku: customSku.trim() || `SKU-${Date.now()}`,
                category: customCategory,
                commitToDb: autoCommitToDb,
              }
        ),
      });

      const data = await response.json();
      if (!response.ok || !data.report) {
        throw new Error(data.error || 'Failed to scrape reviews from target.');
      }

      onScrapedReportReady(data.report, data.dbState);
      if (autoCommitToDb) {
        const remote = supabaseNote(data.supabase);
        setCommitBanner(
          `Scraped & Dumped SKU ${data.report.sku} (${data.report.name}) into SQLite Database: 1 SKU row, ${data.report.sizeSummaries.length} size_metrics rows, and ${data.report.totalReviews} review rows committed.${remote}`
        );
      } else {
        setCommitBanner(
          `Scraped SKU ${data.report.sku} into staging memory (${data.report.totalReviews} reviews parsed via Cheerio DOM).`
        );
      }
    } catch (err) {
      if (scrapeMode === 'batch' && rawInput.trim()) {
        const parsed = parseRawReviewBatch(rawInput);
        if (parsed.length > 0) {
          const localReport = aggregateProductFitReport(
            {
              id: `local-batch-${Date.now()}`,
              name: customProductName.trim(),
              brand: customBrand.trim() || 'Custom Label',
              category: customCategory,
              sku: customSku.trim() || 'BAT-101',
              price: '$24.99',
              fabricComposition: 'Custom Scraped Batch',
              sourceUrl: 'batch://direct-html-parser',
            },
            parsed
          );
          onScrapedReportReady(localReport);
          setIsScraping(false);
          return;
        }
      }
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to complete scrape request.'
      );
    } finally {
      setIsScraping(false);
    }
  };

  const handleBatchScrapeAllPresets = async () => {
    setErrorMessage(null);
    setCommitBanner(null);
    setIsBatchScraping(true);
    try {
      let latestDbState = null;
      let totalReviewsScraped = 0;
      for (const preset of SCRAPABLE_PRESET_TARGETS) {
        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: preset.url, commitToDb: true }),
        });
        if (res.ok) {
          const data = await res.json();
          latestDbState = data.dbState;
          totalReviewsScraped += data.report?.totalReviews || 0;
        }
      }
      if (latestDbState) {
        onBatchCommitted(latestDbState);
        setCommitBanner(
          `Batch Scrape & Database Dump Complete: ${SCRAPABLE_PRESET_TARGETS.length} SKUs (${totalReviewsScraped} reviews) parsed via Cheerio DOM and committed to commercial_fit.db.`
        );
      }
    } catch {
      setErrorMessage('Batch scrape pipeline encountered an error.');
    } finally {
      setIsBatchScraping(false);
    }
  };

  return (
    <section
      id="scraper-workbench"
      aria-labelledby="scraper-workbench-heading"
      className="bg-white border border-stone-200 rounded-lg p-6"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-stone-200">
        <div>
          <h2
            id="scraper-workbench-heading"
            className="text-lg font-bold text-slate-900 tracking-tight"
          >
            Commercial Web Scraper &amp; Database Ingestion Pipeline
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            100% deterministic Cheerio DOM &amp; rule-based lexical fit classifier (Zero LLM). Scrape item reviews by size and dump normalized records directly into SQLite (`commercial_fit.db`).
          </p>
        </div>

        {/* Mode Switcher & Auto-Commit DB Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full lg:w-auto">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none whitespace-nowrap shrink-0">
            <input
              type="checkbox"
              checked={autoCommitToDb}
              onChange={(e) => setAutoCommitToDb(e.target.checked)}
              className="rounded border-stone-300 text-slate-900 focus:ring-slate-900"
            />
            <Database className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
            <span>Auto-Dump to SQLite DB</span>
          </label>

          <div
            role="group"
            aria-label="Scraper input mode"
            className="grid grid-cols-2 sm:flex items-center gap-1 p-1 bg-stone-100 rounded-lg w-full sm:w-auto"
          >
            <button
              type="button"
              onClick={() => {
                setScrapeMode('url');
                setErrorMessage(null);
              }}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                scrapeMode === 'url'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Scrape SKU URL</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setScrapeMode('batch');
                setErrorMessage(null);
              }}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                scrapeMode === 'batch'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <Code2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Ingest HTML / Payload</span>
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={handleExecuteScrape} className="mt-4">
        {scrapeMode === 'url' ? (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <label htmlFor="target-url-input" className="sr-only">
                  Target Product Review Page URL
                </label>
                <input
                  id="target-url-input"
                  type="text"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="Enter product review URL (e.g. /api/mock-store/hm-heavyweight-relaxed-tee or https://...)"
                  className="w-full px-3.5 py-2 text-sm font-mono bg-stone-50 border border-stone-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
                />
              </div>
              <button
                type="button"
                onClick={handleInspectPresetDom}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {inspectedHtmlPreview ? 'Hide Raw DOM' : 'Inspect Raw HTML'}
                </span>
              </button>
              <button
                type="submit"
                disabled={isScraping || isBatchScraping}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {isScraping ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Scraping &amp; Dumping...</span>
                  </>
                ) : (
                  <>
                    <Database className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Scrape &amp; Dump to DB</span>
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={isScraping || isBatchScraping}
                onClick={handleBatchScrapeAllPresets}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-stone-100 hover:bg-stone-200 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {isBatchScraping ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Batch Dumping...</span>
                  </>
                ) : (
                  <>
                    <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Batch Scrape All 5 Targets</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Storefront Preset Targets */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 pt-1">
              <span className="font-medium text-slate-800 whitespace-nowrap shrink-0">
                Target Storefront Feeds:
              </span>
              {SCRAPABLE_PRESET_TARGETS.map((preset, idx) => (
                <React.Fragment key={preset.id}>
                  {idx > 0 && <span aria-hidden="true">·</span>}
                  <button
                    type="button"
                    onClick={() => handleSelectPreset(preset.url)}
                    className={`underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                      targetUrl === preset.url
                        ? 'font-semibold text-slate-900'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {preset.label}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {inspectedHtmlPreview && (
              <div className="mt-3 p-3 bg-slate-900 text-stone-100 rounded-md overflow-x-auto max-h-48 text-xs font-mono leading-relaxed">
                <div className="text-[11px] text-stone-400 pb-1.5 mb-1.5 border-b border-slate-800">
                  Live HTML Response from {targetUrl} (parsed via Cheerio `[data-review-card]`)
                </div>
                <pre className="whitespace-pre-wrap">{inspectedHtmlPreview}</pre>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="batch-sku-code"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Commercial SKU Code
                </label>
                <input
                  id="batch-sku-code"
                  type="text"
                  value={customSku}
                  onChange={(e) => setCustomSku(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-stone-50 border border-stone-200 rounded-md text-slate-900"
                />
              </div>
              <div>
                <label
                  htmlFor="batch-product-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Garment Title
                </label>
                <input
                  id="batch-product-name"
                  type="text"
                  value={customProductName}
                  onChange={(e) => setCustomProductName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-md text-slate-900"
                />
              </div>
              <div>
                <label
                  htmlFor="batch-brand-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Vendor / Brand
                </label>
                <input
                  id="batch-brand-name"
                  type="text"
                  value={customBrand}
                  onChange={(e) => setCustomBrand(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-md text-slate-900"
                />
              </div>
              <div>
                <label
                  htmlFor="batch-category-select"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Apparel Category
                </label>
                <select
                  id="batch-category-select"
                  value={customCategory}
                  onChange={(e) =>
                    setCustomCategory(
                      e.target.value as ProductFitReport['category']
                    )
                  }
                  className="w-full px-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-md text-slate-900"
                >
                  <option value="T-Shirts & Tops">T-Shirts &amp; Tops</option>
                  <option value="Outerwear">Outerwear</option>
                  <option value="Shirting">Shirting</option>
                  <option value="Knitwear">Knitwear</option>
                  <option value="Fleece & Hoodies">Fleece &amp; Hoodies</option>
                  <option value="Trousers">Trousers</option>
                  <option value="Dresses">Dresses</option>
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="raw-review-textarea"
                  className="text-xs font-medium text-slate-700"
                >
                  Raw HTML Review Nodes or Plain-Text Payload (Sizes XS–XXL)
                </label>
                <button
                  type="button"
                  onClick={() => setRawInput(SAMPLE_HTML_BATCH)}
                  className="text-xs text-slate-600 hover:text-slate-900 underline underline-offset-4"
                >
                  Load Sample HTML Payload
                </button>
              </div>
              <textarea
                id="raw-review-textarea"
                rows={5}
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="Paste HTML <article class='review-card' data-size='L'>... or plain text reviews..."
                className="w-full p-3 text-xs font-mono bg-stone-50 border border-stone-200 rounded-md text-slate-900 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isScraping}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {isScraping ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Parsing &amp; Dumping...</span>
                  </>
                ) : (
                  <>
                    <Database className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Parse &amp; Dump to DB</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {commitBanner && (
          <div
            role="status"
            data-testid="db-commit-banner"
            className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-md flex items-center gap-2 text-xs text-emerald-900 font-medium"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{commitBanner}</span>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 font-medium"
          >
            {errorMessage}
          </div>
        )}
      </form>
    </section>
  );
};
