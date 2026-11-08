/** Join a Vite base with an app path. Base `/` stays a root path; `/scraper/` becomes `/scraper/...`. */
export function withBase(base: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const root = base.endsWith('/') ? base.slice(0, -1) : base;
  if (root === '' || root === '/') return suffix;
  return `${root}${suffix}`;
}

/**
 * Map the URL Vercel hands the scraper function onto the Express routes,
 * which are mounted at `/api/*` for local dev and for this function.
 */
export function rewriteScraperApiUrl(url: string): string {
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const search = queryAt === -1 ? '' : url.slice(queryAt);
  let next = path;
  if (next.startsWith('/api/scraper/')) next = `/api/${next.slice('/api/scraper/'.length)}`;
  else if (next === '/api/scraper') next = '/api';
  else if (next.startsWith('/scraper/api/')) next = `/api/${next.slice('/scraper/api/'.length)}`;
  else if (next === '/scraper/api') next = '/api';
  else if (next !== '/api' && !next.startsWith('/api/')) {
    next = next.startsWith('/') ? `/api${next}` : `/api/${next}`;
  }
  return next + search;
}
