/** The scrape endpoint: fetch, render when needed, read reviews and size chart, commit. */
import type { Express } from 'express';
import { aggregateProductFitReport, type ProductFitReport, type RawScrapedReview } from '../fitAnalyzer.ts';
import { fetchGuidePagesByHttp, renderChartOnly, renderPageHtml, shouldUseHeadlessRender } from '../headlessFetch.ts';
import { sizeChartFromPages, blockPageTitle, blockPageText } from '../pageHelpers.ts';
import { pushFitReports, type SupabaseSync } from '../supabaseFit.ts';
import { blockedFetchTargetResolved } from '../publicUrl.ts';
import {
  hasStoredReviews,
  loadStoredReport,
  upsertReportTransaction,
  saveSizeChart,
  getDatabaseSummary,
} from './db.ts';
import { mockStoreProduct, renderMockStoreHtml } from './mockStore.ts';
import { mergeScrapedReviews } from './reviewMerge.ts';
import { looksLikeFullHtmlDocument, scrapeHtmlWithCheerio } from './scrapeHtml.ts';
import { type StaticFetchError, fetchStaticHtml, fetchGuidePage } from './staticFetch.ts';

type RenderMode = 'auto' | 'always' | 'never';

const PASTE_HINT =
  ' If the reviews show in your own browser, copy them (or View Source) and paste into the raw HTML box instead.';

export function registerScrapeRoute(app: Express) {
  // Deterministic Web Scraper Endpoint (Zero LLM)
  app.post('/api/scrape', async (req, res) => {
    try {
      const {
        url,
        rawHtml,
        productName,
        brand,
        sku,
        category,
        commitToDb = true,
        render,
        chartRender = false,
      } = req.body as {
        url?: string;
        rawHtml?: string;
        productName?: string;
        brand?: string;
        sku?: string;
        category?: ProductFitReport['category'];
        commitToDb?: boolean;
        render?: RenderMode;
        /** Also run a short render for the size chart alone when nothing else found one (see below). Off by default. */
        chartRender?: boolean;
      };

      if ((url !== undefined && typeof url !== 'string') || (rawHtml !== undefined && typeof rawHtml !== 'string')) {
        res.status(400).json({ error: 'url and rawHtml must be strings.' });
        return;
      }

      const renderMode: RenderMode = render === 'always' || render === 'never' ? render : 'auto';
      let targetHtml = (rawHtml || '').trim();
      let renderedChartHtml: string | null = null; // headless snapshot from before the review steps
      let renderedFinalHtml: string | null = null; // headless page at the end, when the source page's reviews won
      let renderedGuidePages: string[] = []; // size guide pages the product page linked to, read by the headless browser
      let renderedChartJson: string[] = []; // size chart tables that arrived as HTML inside JSON the page received
      let sourceUrl = (url || 'batch://direct-review-payload').trim();
      let isRemoteUrl = false;
      let staticError: StaticFetchError | null = null;

      if (!targetHtml && url) {
        const mockMatch = url.match(/^(?:https?:\/\/[^/?#]+)?\/api\/mock-store\/([a-z0-9-]+)\/?(?:[?#].*)?$/i);
        const mockProd = mockMatch ? mockStoreProduct(mockMatch[1]) : undefined;
        if (mockProd) {
          targetHtml = renderMockStoreHtml(mockProd);
          sourceUrl = `https://storefront.pearfitscraper.local/api/mock-store/${mockProd.slug}`;
        } else if (/^https?:\/\//i.test(url)) {
          isRemoteUrl = true;
          const blocked = await blockedFetchTargetResolved(url);
          if (blocked) {
            res.status(400).json({ error: blocked });
            return;
          }
          if (renderMode !== 'always') {
            const result = await fetchStaticHtml(url);
            if ('html' in result) targetHtml = result.html;
            else staticError = result;
          }
        } else {
          res.status(400).json({
            error:
              'Provide a valid http(s):// URL, select a target SKU endpoint, or paste review HTML/text.',
          });
          return;
        }
      }

      const overrides = { productName, brand, sku, category };
      const staticHtml = targetHtml; // the page as the server sent it, before any render replaces targetHtml
      let scraped = targetHtml ? scrapeHtmlWithCheerio(targetHtml, sourceUrl, overrides) : null;
      let headlessNote: string | null = null;

      // Headless fallback for reviews loaded by JavaScript. A failed fetch is reported as
      // that failure. A refusal (403/429/503) is not retried in a browser.
      const needsRender = shouldUseHeadlessRender({
        isRemoteUrl,
        renderMode,
        staticFailed: staticError !== null && !staticError.retryInBrowser,
        reviewCount: scraped ? scraped.reviews.length : null,
        reportedReviewCount: scraped?.meta.scraperTelemetry.reportedReviewCount ?? null,
      });
      if (needsRender) {
        try {
          const rendered = await renderPageHtml(url!);
          const blockedBy = blockPageTitle(rendered.html);
          if (rendered.status !== null && rendered.status >= 400) {
            headlessNote = `Headless browser got HTTP ${rendered.status}.`;
          } else if (blockedBy) {
            // A bot check or access-denied page is a refusal, reported as one and not worked around.
            headlessNote = `The store showed the headless browser a block page ("${blockedBy}"): it refuses automated requests.`;
          } else if (blockPageText(rendered.html) === 'refused') {
            headlessNote = 'The store told the headless browser it does not allow automated traffic: it refuses automated requests.';
          } else if (blockPageText(rendered.html) === 'maintenance') {
            headlessNote = "The store's site is showing a maintenance page. It is down; try again later.";
          } else {
            // The render may end on the product's own review page; product details come from the
            // product page snapshot then.
            const leftProductPage = rendered.chartHtml !== null && new URL(rendered.finalUrl).pathname !== new URL(url!).pathname;
            const renderedScrape = scrapeHtmlWithCheerio(
              rendered.html,
              sourceUrl,
              overrides,
              rendered.jsonResponses,
              leftProductPage ? rendered.chartHtml : null,
              targetHtml,
            );
            // Earlier pages of a review list that pages by link each hold their own reviews. Merge them in
            // page order, then the last page, so the list keeps the store's order (newest first).
            if (rendered.extraHtml?.length) {
              let earlierReviews: RawScrapedReview[] = [];
              for (const pageHtml of rendered.extraHtml) {
                const earlier = scrapeHtmlWithCheerio(pageHtml, sourceUrl, overrides);
                earlierReviews = mergeScrapedReviews(earlierReviews, earlier.reviews);
                renderedScrape.meta.scraperTelemetry.reportedReviewCount ??= earlier.meta.scraperTelemetry.reportedReviewCount;
              }
              renderedScrape.reviews = mergeScrapedReviews(earlierReviews, renderedScrape.reviews);
            }
            renderedScrape.meta.scraperTelemetry.engineMode = 'headless-chromium+cheerio-dom';
            renderedScrape.meta.scraperTelemetry.selectorsUsed.unshift('headless-chromium render');
            // Keep the render when it found at least as many reviews as the page source, or when it read
            // the review widget's own data and the page source had only markup cards.
            const renderedHasData = renderedScrape.meta.scraperTelemetry.reviewSources.some((src) => src !== 'dom' && src !== 'json-ld');
            const staticHasData = (scraped?.meta.scraperTelemetry.reviewSources ?? []).some((src) => src !== 'dom' && src !== 'json-ld');
            // The render's size chart is kept whichever review set wins.
            renderedChartHtml = rendered.chartHtml;
            renderedFinalHtml = rendered.html;
            renderedGuidePages = rendered.guidePages ?? [];
            renderedChartJson = rendered.chartJson ?? [];
            if (process.env.SCRAPER_DEBUG) console.error(`[render] size chart JSON fragments: ${renderedChartJson.length}`);
            if (
              !scraped ||
              renderedScrape.reviews.length >= scraped.reviews.length ||
              (renderedHasData && !staticHasData && renderedScrape.reviews.length > 0)
            ) {
              scraped = renderedScrape;
              targetHtml = rendered.html;
            }
            if (renderedScrape.reviews.length === 0) {
              headlessNote = 'Rendered the page in a headless browser but still found no reviews.';
            }
          }
        } catch (renderErr) {
          const reason = renderErr instanceof Error ? renderErr.message.split('\n')[0] : String(renderErr);
          const missingLocalBrowser =
            !process.env.VERCEL &&
            /Executable doesn't exist|browserType\.launch|Cannot find (module|package) 'playwright'/i.test(reason);
          headlessNote = missingLocalBrowser
            ? 'Headless browser is not installed (run `npx playwright install chromium`).'
            : `Headless browser render failed: ${reason}`;
        }
      }

      if (!scraped) {
        const parts = [staticError?.message ?? 'No HTML or review content provided to scrape.', headlessNote].filter(Boolean);
        res.status(staticError?.status ?? 400).json({
          error: `${parts.join(' ')}${isRemoteUrl ? PASTE_HINT : ''}`,
        });
        return;
      }

      const { meta, reviews } = scraped;

      // A page whose reviews were all in its source needed no render, so its size guide was never opened.
      // Look for the chart anyway: first the size-guide pages the source links to (plain fetch, no browser, a
      // second or two). Only when the request asks for it (chartRender), a short render for the chart alone
      // follows: 15 to 45 seconds a page, and on 15 such stores it found no chart the plain fetch had missed.
      // A page the full render already read is not read again.
      if (isRemoteUrl && url && staticHtml && renderedFinalHtml === null) {
        const hint = { name: meta.name, url: sourceUrl };
        const chartFound = () => sizeChartFromPages([targetHtml, renderedChartHtml, renderedFinalHtml, ...renderedChartJson], renderedGuidePages, hint).length > 0;
        if (!chartFound()) {
          renderedGuidePages = await fetchGuidePagesByHttp(staticHtml, url, fetchGuidePage);
          if (process.env.SCRAPER_DEBUG) {
            console.error(`[guides] ${renderedGuidePages.length} linked guide page(s) read: ${renderedGuidePages.map((h) => `${h.length} chars, ${(h.match(/<table/gi) ?? []).length} tables`).join('; ')}`);
          }
          if (!chartFound() && chartRender === true && renderMode === 'auto' && !needsRender && !process.env.VERCEL) {
            try {
              const chartRender = await renderChartOnly(url);
              const refused = chartRender.html && (blockPageTitle(chartRender.html) || blockPageText(chartRender.html) === 'refused');
              // A store that answers the browser with a refusal is not asked again, and nothing from that page is used.
              if (chartRender.html && !refused && (chartRender.status === null || chartRender.status < 400)) {
                renderedChartHtml = chartRender.chartHtml;
                renderedFinalHtml = chartRender.html;
                renderedGuidePages = [...renderedGuidePages, ...(chartRender.guidePages ?? [])];
                renderedChartJson = chartRender.chartJson ?? [];
              }
            } catch {
              // No chart this time; the reviews were read and stand.
            }
          }
        }
      }

      if (reviews.length === 0) {
        const sizeChart = sizeChartFromPages([targetHtml, renderedChartHtml, renderedFinalHtml, ...renderedChartJson], renderedGuidePages, { name: meta.name, url: sourceUrl });
        // A chart with no parent SKU never shows up and never reaches Supabase.
        // Store an empty fit report so the chart has a row to hang on.
        if (commitToDb && sizeChart.length > 0) {
          const emptyReport = aggregateProductFitReport(meta, []);
          // The reviews may have failed to load this time. Keep the ones an earlier scrape stored,
          // and show that stored report rather than an empty one.
          const keptStoredReviews = hasStoredReviews(emptyReport.sku);
          if (!keptStoredReviews) upsertReportTransaction(emptyReport);
          saveSizeChart(emptyReport.sku, sizeChart);
          const supabase = await pushFitReports([emptyReport], { [emptyReport.sku]: sizeChart }, { chartOnly: true });
          res.json({
            report: (keptStoredReviews && loadStoredReport(emptyReport.sku)) || emptyReport,
            keptStoredReviews,
            sizeChart,
            committedToDb: true,
            supabase,
            dbState: getDatabaseSummary(),
          });
          return;
        }
        const chartNote =
          sizeChart.length > 0
            ? ` A size chart with ${sizeChart.length} sizes was read and not stored.`
            : '';
        res.status(422).json({
          error: `${
            isRemoteUrl || looksLikeFullHtmlDocument(targetHtml)
              ? `No reviews found on the page.${headlessNote ? ` ${headlessNote}` : ''}${PASTE_HINT}`
              : 'No recognizable clothing reviews were found in the pasted content.'
          }${chartNote}`,
          sizeChart,
        });
        return;
      }

      const report = aggregateProductFitReport(meta, reviews);
      const sizeChart = sizeChartFromPages([targetHtml, renderedChartHtml, renderedFinalHtml, ...renderedChartJson], renderedGuidePages, { name: meta.name, url: sourceUrl });

      let supabase: SupabaseSync | null = null;
      if (commitToDb) {
        upsertReportTransaction(report);
        saveSizeChart(report.sku, sizeChart);
        supabase = await pushFitReports([report], { [report.sku]: sizeChart });
      }

      res.json({
        report,
        sizeChart,
        committedToDb: commitToDb,
        supabase,
        dbState: getDatabaseSummary(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected scraper error';
      res.status(500).json({ error: message });
    }
  });
}
