import { withBase } from './apiPaths.ts';

/** API path for this build. `/api/...` locally, `/scraper/api/...` on pearfit.app. */
export function apiPath(path: string): string {
  return withBase(import.meta.env.BASE_URL || '/', path);
}
