/** The mock-store, PostHog config and database endpoints. */
import type { Express } from 'express';
import { generateSqlInsertDump, type DumpSizeChartRow, type ProductFitReport } from '../fitAnalyzer.ts';
import type { SizeChartRow } from '../sizeChart.ts';
import { deleteRemoteFitSku, listRemoteFitSkus, pushFitReports } from '../supabaseFit.ts';
import { db, upsertReportTransaction, chartsBySku, saveSizeChart, getDatabaseSummary } from './db.ts';
import { mockStoreProduct, renderMockStoreHtml } from './mockStore.ts';

function chartRowsFromClient(value: unknown): SizeChartRow[] {
  if (!Array.isArray(value)) return [];
  const rows: SizeChartRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.size !== 'string' || !row.size.trim()) continue;
    const measurement = (field: unknown) => (typeof field === 'number' && Number.isFinite(field) ? field : null);
    rows.push({
      size: row.size.trim(),
      sortOrder: typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) ? row.sortOrder : rows.length,
      chest_cm: measurement(row.chest_cm),
      length_cm: measurement(row.length_cm),
      sleeve_cm: measurement(row.sleeve_cm),
    });
  }
  return rows;
}

export function registerMockStoreRoutes(app: Express) {
  // Serve realistic mock e-commerce store pages for live scraping
  app.get('/api/mock-store/:slug', (req, res) => {
    const product = mockStoreProduct(req.params.slug);
    if (!product) {
      res.status(404).send('Product not found');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderMockStoreHtml(product));
  });

  app.get('/api/mock-store/:slug/raw', (req, res) => {
    const product = mockStoreProduct(req.params.slug);
    if (!product) {
      res.status(404).json({ error: 'Preset store page not found' });
      return;
    }
    res.json({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      sku: product.sku,
      category: product.category,
      html: renderMockStoreHtml(product),
    });
  });
}

export function registerPosthogConfigRoute(app: Express) {
  // Public PostHog settings for the browser (the project token is meant to be public). The page loads
  // them at start so the build holds no analytics keys. Empty when PostHog is not configured.
  app.get('/api/posthog-config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      projectToken: process.env.POSTHOG_PROJECT_TOKEN || '',
      host: process.env.POSTHOG_HOST || '',
    });
  });
}

export function registerDbRoutes(app: Express) {
  // Commercial SQLite Database Query & Inspection Endpoints
  app.get('/api/db/remote', async (_req, res) => {
    try {
      res.json(await listRemoteFitSkus());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Could not list the shared fit store' });
    }
  });

  app.get('/api/db/records', (_req, res) => {
    res.json(getDatabaseSummary());
  });

  app.post('/api/db/commit', async (req, res) => {
    try {
      const { report, reports, charts: incomingCharts } = req.body as {
        report?: ProductFitReport;
        reports?: ProductFitReport[];
        charts?: Record<string, unknown>;
      };

      const list = reports || (report ? [report] : []);
      if (!Array.isArray(list) || list.some((r) => !r || typeof r !== 'object' || typeof r.sku !== 'string' || !r.sku)) {
        res.status(400).json({ error: 'Each report must be an object with a string sku.' });
        return;
      }
      if (list.length === 0) {
        res.status(400).json({ error: 'No scraped SKU report provided to dump into database.' });
        return;
      }

      for (const item of list) {
        upsertReportTransaction(item);
        const rows = chartRowsFromClient(incomingCharts?.[item.sku]);
        if (rows.length > 0) saveSizeChart(item.sku, rows);
      }

      const supabase = await pushFitReports(list, chartsBySku(list));
      res.json({
        committedCount: list.length,
        supabase,
        ...getDatabaseSummary(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Database commit failed',
      });
    }
  });

  const deleteSkuTransaction = db.transaction((sku: string) => {
    db.prepare(`DELETE FROM commercial_skus WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM sku_size_metrics WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM sku_reviews WHERE sku = ?`).run(sku);
    db.prepare(`DELETE FROM size_chart WHERE sku = ?`).run(sku);
    db.prepare(`
      INSERT INTO ingestion_log (sku, product_name, action, rows_affected, committed_at)
      VALUES (?, ?, 'DELETE_SKU', 1, ?)
    `).run(sku, sku, new Date().toISOString());
  });

  app.delete('/api/db/sku/:sku', async (req, res) => {
    try {
      const sku = req.params.sku;
      deleteSkuTransaction(sku);

      const supabase = await deleteRemoteFitSku(sku);
      res.json({ supabase, ...getDatabaseSummary() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  app.get('/api/db/dump.sql', (_req, res) => {
    const { reports, charts } = getDatabaseSummary();
    const chartRows: DumpSizeChartRow[] = Object.entries(charts).flatMap(([sku, rows]) =>
      rows.map((row) => ({ sku, ...row })),
    );
    const sql = generateSqlInsertDump(reports, chartRows);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="pearfit_scraper_commercial_db_dump.sql"'
    );
    res.send(sql);
  });

  app.get('/api/db/dump.json', (_req, res) => {
    const skus = db.prepare(`SELECT sku, product_id, brand, product_name, category, retail_price, fabric_composition, total_reviews, overall_fit_index, overall_verdict, grading_delta, runs_small_pct, true_to_size_pct, runs_large_pct, shrinkage_mention_pct, fabric_opacity_pct, sentiment_score, avg_rating, source_url, scraped_at, committed_at FROM commercial_skus`).all();
    const sizeMetrics = db.prepare(`SELECT * FROM sku_size_metrics`).all();
    const reviews = db.prepare(`SELECT * FROM sku_reviews`).all();
    const sizeChart = db.prepare(`SELECT * FROM size_chart ORDER BY sku, sort_order`).all();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="pearfit_scraper_commercial_db_dump.json"'
    );
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          engine: 'Pearfit Scraper Commercial Apparel Fit Database (SQLite3 + Deterministic NLP)',
          tables: {
            commercial_skus: skus,
            sku_size_metrics: sizeMetrics,
            sku_reviews: reviews,
            size_chart: sizeChart,
          },
        },
        null,
        2
      )
    );
  });
}
