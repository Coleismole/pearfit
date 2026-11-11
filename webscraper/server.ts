/**
 * The scraper's entry point. createApp() wires the routes; the code behind them is in server/:
 *   env.ts          the scraper's folder and the env files it reads
 *   db.ts           the local SQLite store (opened when the module loads)
 *   mockStore.ts    the sample store pages
 *   scrapeHtml.ts   one page of HTML -> product and reviews (domReviews.ts reads the review cards,
 *                   reviewMerge.ts merges the sources)
 *   staticFetch.ts  plain HTTP fetch of product and size-guide pages
 *   routes.ts       the mock-store, PostHog and database endpoints
 *   scrapeRoute.ts  POST /api/scrape
 * vercelHandler.ts and the tests import createApp from here.
 */
import './server/instrument.ts';
import * as Sentry from '@sentry/node';
import express from 'express';
import path from 'path';
import { closeHeadlessBrowser } from './headlessFetch.ts';
import { checkFitStore } from './supabaseFit.ts';
import { serverDir } from './server/env.ts';
import { registerMockStoreRoutes, registerPosthogConfigRoute, registerDbRoutes } from './server/routes.ts';
import { registerScrapeRoute } from './server/scrapeRoute.ts';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  registerMockStoreRoutes(app);
  registerPosthogConfigRoute(app);
  registerDbRoutes(app);
  registerScrapeRoute(app);

  // After the routes: reports any error they pass on, before Express's own default handler answers.
  Sentry.setupExpressErrorHandler(app);

  return app;
}

async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(serverDir(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      closeHeadlessBrowser().finally(() => process.exit(0));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pearfit Scraper listening on http://127.0.0.1:${PORT}`);
    checkFitStore().then((sync) => {
      if (sync.ok) {
        console.log('Supabase fit store is ready. Scrapes will push fit numbers.');
        return;
      }
      if ('skipped' in sync) {
        console.log(`Supabase fit store skipped: ${sync.reason}`);
        return;
      }
      console.log(`Supabase fit store is not writable yet: ${sync.error}`);
      console.log('One person runs webscraper/fit_store.sql once in the Supabase SQL editor. After that, every clone can push.');
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`Supabase fit store check failed: ${message}`);
    });
  });
}

if (!process.env.VERCEL) {
  startServer();
}
