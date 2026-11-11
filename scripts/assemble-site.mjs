import { readFileSync, writeFileSync } from 'node:fs';
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
  external: ['better-sqlite3', 'playwright', 'vite', 'puppeteer-core', '@sparticuz/chromium-min'],
  logLevel: 'info',
});
await cp(path.join(root, 'webscraper', '.env.example'), path.join(path.dirname(outfile), '.env.example'));
// Vercel does not load a committed .env file into the function, so the hosted
// scraper never saw the project URL and skipped the Supabase write.
const exampleText = readFileSync(path.join(root, 'webscraper', '.env.example'), 'utf8');
const publicValue = (name) => {
  const line = exampleText.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
};
const prelude = `if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = ${JSON.stringify(publicValue('SUPABASE_URL'))};\nif (!process.env.SUPABASE_PUBLISHABLE_KEY) process.env.SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(publicValue('SUPABASE_PUBLISHABLE_KEY'))};\n`;
writeFileSync(outfile, prelude + readFileSync(outfile, 'utf8'));

// www.pearfit.app is the Vercel project rooted at website/. Ship the scraper there.
const websiteScraper = path.join(website, 'scraper');
const websiteApi = path.join(website, 'api', 'scraper');
await rm(websiteScraper, { recursive: true, force: true });
await cp(path.join(root, 'webscraper', 'dist'), websiteScraper, { recursive: true });
// A project rooted at website/scraper still runs the repo build command, which
// looks for this script and otherwise copies styles.css and app.js.
await mkdir(path.join(websiteScraper, 'scripts'), { recursive: true });
await cp(
  path.join(root, 'scripts', 'vercel-directory-build.mjs'),
  path.join(websiteScraper, 'scripts', 'assemble-site.mjs'),
);
await rm(websiteApi, { recursive: true, force: true });
await mkdir(websiteApi, { recursive: true });
await cp(outfile, path.join(websiteApi, '[[...path]].js'));
await cp(path.join(root, 'webscraper', '.env.example'), path.join(websiteApi, '.env.example'));

// The shopper app is served at /app by the same project. APP_BASE gives its built files absolute /app/ asset paths,
// so the /app rewrites in vercel.json can answer any /app/<path> with index.html. It reaches site/ with the copy below.
const appBuild = spawnSync('npm', ['run', 'build'], {
  cwd: path.join(root, 'app'),
  env: { ...process.env, APP_BASE: '/app/' },
  stdio: 'inherit',
});
if (appBuild.status !== 0) process.exit(appBuild.status ?? 1);
const websiteApp = path.join(website, 'app');
await rm(websiteApp, { recursive: true, force: true });
await cp(path.join(root, 'app', 'dist'), websiteApp, { recursive: true });

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
await cp(website, site, {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    return !['README.md', 'placeholder.txt', 'package.json', 'package-lock.json', 'vercel.json', 'node_modules', 'api'].includes(base);
  },
});
