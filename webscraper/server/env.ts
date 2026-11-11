/** Where the scraper finds its own folder, and the env files it reads at start. */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

export function serverDir(): string {
  // The Vercel bundle is CommonJS, where import.meta.url is empty. Skip it there.
  if (process.env.VERCEL) return path.join(process.cwd(), 'api', 'scraper');
  // This file lives in server/; the scraper's own folder is the one above it.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function loadEnvFiles() {
  const dirs = [serverDir(), path.join(process.cwd(), 'webscraper'), path.join(process.cwd(), 'api', 'scraper')];
  for (const name of ['.env.local', '.env', '.env.example']) {
    for (const dir of dirs) {
      dotenv.config({ path: path.join(dir, name) });
    }
  }
}
loadEnvFiles();
