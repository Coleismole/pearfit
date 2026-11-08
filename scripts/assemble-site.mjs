import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const website = path.join(root, 'website');

const scraperBuild = spawnSync('npm', ['run', 'build'], {
  cwd: path.join(root, 'webscraper'),
  env: { ...process.env, SCRAPER_BASE: '/scraper/' },
  stdio: 'inherit',
});
if (scraperBuild.status !== 0) process.exit(scraperBuild.status ?? 1);

const require = createRequire(path.join(root, 'webscraper', 'package.json'));
const esbuild = require('esbuild');
const outfile = path.join(root, 'api', 'scraper', '[[...path]].js');
await mkdir(path.dirname(outfile), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'webscraper', 'vercelHandler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile,
  external: ['better-sqlite3', 'playwright', 'vite'],
  logLevel: 'info',
});
await cp(path.join(root, 'webscraper', '.env.example'), path.join(path.dirname(outfile), '.env.example'));

// www.pearfit.app is the Vercel project rooted at website/. Ship the scraper there.
const websiteScraper = path.join(website, 'scraper');
const websiteApi = path.join(website, 'api', 'scraper');
await rm(websiteScraper, { recursive: true, force: true });
await cp(path.join(root, 'webscraper', 'dist'), websiteScraper, { recursive: true });
await rm(websiteApi, { recursive: true, force: true });
await mkdir(websiteApi, { recursive: true });
await cp(outfile, path.join(websiteApi, '[[...path]].js'));
await cp(path.join(root, 'webscraper', '.env.example'), path.join(websiteApi, '.env.example'));

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
await cp(website, site, {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    return !['README.md', 'placeholder.txt', 'package.json', 'package-lock.json', 'vercel.json', 'node_modules', 'api'].includes(base);
  },
});
