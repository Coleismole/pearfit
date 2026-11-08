import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build command for a Vercel project whose root directory is not the repo root.
 * The repo-root command looks for `scripts/assemble-site.mjs` and otherwise
 * copies styles.css and app.js, which this directory does not have.
 */
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(appRoot, 'site');

async function publishStatic() {
  await rm(site, { recursive: true, force: true });
  await mkdir(site, { recursive: true });
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(appRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'site' || entry.name === 'scripts' || entry.name === 'node_modules') continue;
    await cp(path.join(appRoot, entry.name), path.join(site, entry.name), { recursive: true });
  }
}

if (!existsSync(path.join(appRoot, 'package.json'))) {
  await publishStatic();
} else {
  const install = spawnSync('npm', ['ci'], {
    cwd: appRoot,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    stdio: 'inherit',
  });
  if (install.status !== 0) process.exit(install.status ?? 1);

  const built = spawnSync('npm', ['run', 'build'], {
    cwd: appRoot,
    env: { ...process.env, SCRAPER_BASE: '/' },
    stdio: 'inherit',
  });
  if (built.status !== 0) process.exit(built.status ?? 1);

  await rm(site, { recursive: true, force: true });
  await cp(path.join(appRoot, 'dist'), site, { recursive: true });

  const require = createRequire(path.join(appRoot, 'package.json'));
  const esbuild = require('esbuild');
  const outfile = path.join(appRoot, 'api', '[[...path]].js');
  await mkdir(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(appRoot, 'vercelHandler.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile,
    external: ['better-sqlite3', 'playwright', 'vite', 'puppeteer-core', '@sparticuz/chromium-min'],
    logLevel: 'info',
  });
  const exampleText = readFileSync(path.join(appRoot, '.env.example'), 'utf8');
  const publicValue = (name) => {
    const line = exampleText.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : '';
  };
  const prelude = `if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = ${JSON.stringify(publicValue('SUPABASE_URL'))};\nif (!process.env.SUPABASE_PUBLISHABLE_KEY) process.env.SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(publicValue('SUPABASE_PUBLISHABLE_KEY'))};\n`;
  writeFileSync(outfile, prelude + readFileSync(outfile, 'utf8'));
}
