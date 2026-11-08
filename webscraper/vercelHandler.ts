import type { IncomingMessage, ServerResponse } from 'node:http';
import { rewriteScraperApiUrl } from './apiPaths.ts';
import { createApp } from './server.ts';

const app = createApp();

export const config = { maxDuration: 60 };

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url) req.url = rewriteScraperApiUrl(req.url);
  app(req, res);
}
