import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteScraperApiUrl, withBase } from './apiPaths.ts';

test('withBase keeps local root paths and prefixes the hosted scraper', () => {
  assert.equal(withBase('/', '/api/scrape'), '/api/scrape');
  assert.equal(withBase('/scraper/', '/api/db/records'), '/scraper/api/db/records');
  assert.equal(withBase('/scraper', 'api/db/remote'), '/scraper/api/db/remote');
});

test('rewriteScraperApiUrl maps Vercel function paths onto /api routes', () => {
  assert.equal(rewriteScraperApiUrl('/api/scraper/db/records'), '/api/db/records');
  assert.equal(rewriteScraperApiUrl('/scraper/api/scrape?x=1'), '/api/scrape?x=1');
  assert.equal(rewriteScraperApiUrl('/api/db/remote'), '/api/db/remote');
  assert.equal(rewriteScraperApiUrl('/db/records'), '/api/db/records');
});
