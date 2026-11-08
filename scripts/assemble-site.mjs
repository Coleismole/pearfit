import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });

await cp(path.join(root, 'website'), site, {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    return base !== 'README.md' && base !== 'placeholder.txt';
  },
});

const scraperBuild = spawnSync('npm', ['run', 'build'], {
  cwd: path.join(root, 'webscraper'),
  env: { ...process.env, SCRAPER_BASE: '/scraper/' },
  stdio: 'inherit',
});
if (scraperBuild.status !== 0) process.exit(scraperBuild.status ?? 1);

await cp(path.join(root, 'webscraper', 'dist'), path.join(site, 'scraper'), { recursive: true });

const require = createRequire(path.join(root, 'webscraper', 'package.json'));
const esbuild = require('esbuild');
const outfile = path.join(root, 'api', 'scraper', '[[...path]].js');
await mkdir(path.dirname(outfile), { recursive: true });
await cp(path.join(root, 'webscraper', '.env.example'), path.join(path.dirname(outfile), '.env.example'));
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
