// Fails when the generated files committed under website/ are older than the sources they come from.
//
// The Vercel project is rooted at website/, so these outputs are committed instead of built on deploy:
//   website/api/recommend.js, website/api/candidates.js   <- `npm run build:api` in engine/
//   website/scraper/ and website/api/scraper/             <- `node scripts/assemble-site.mjs` at the repo root
//
// This script runs both generators and then checks the git tree. A rebuild that changes nothing means the
// committed files are current. Run it from the repo root after `npm ci` in webscraper/ (esbuild and vite are
// installed there; neither generator needs the engine's or the repo root's node_modules):
//
//   node scripts/check-bundles.mjs
//
// The comparison is against HEAD, so locally commit or stash edits to the generated paths first.
//
// Why a plain diff is safe here: the Vite filenames (website/scraper/assets/index-<hash>.js) are content
// hashes, not random ones. With the lockfile installed (`npm ci`) the same sources give the same bytes and the
// same names on any machine. That was checked by rebuilding an old commit on a different machine than the one
// that committed it and getting an identical tree. A different result therefore means the committed output is
// stale, or webscraper/package-lock.json drifted from what was built with.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only what the generators own. website/api/posthog-config.js is hand-written and stays out.
const GENERATED = ['website/api/recommend.js', 'website/api/candidates.js', 'website/api/scraper', 'website/scraper'];

function run(command, args, cwd = root, capture = false) {
  if (!capture) console.log(`\n$ ${[command, ...args].join(' ')}${cwd === root ? '' : `   (in ${path.relative(root, cwd)}/)`}`);
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error) throw result.error;
  return result;
}

function git(args) {
  const result = run('git', args, root, true);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}

const inCi = process.env.GITHUB_ACTIONS === 'true';

if (!inCi && git(['status', '--porcelain', '--untracked-files=all', '--', ...GENERATED]).trim()) {
  console.error('The generated files already have uncommitted changes, so a rebuild cannot be compared to HEAD.');
  console.error('Commit or stash them, then run this again.');
  process.exit(2);
}

for (const [command, args, cwd] of [
  ['npm', ['run', 'build:api'], path.join(root, 'engine')],
  ['node', ['scripts/assemble-site.mjs'], root],
]) {
  const built = run(command, args, cwd);
  if (built.status !== 0) {
    console.error(`\nThe build command failed (exit ${built.status}). Fix it first; the staleness check did not run.`);
    process.exit(built.status ?? 1);
  }
}

// `git status` also lists new untracked files (a new hashed asset) and deleted ones; `git diff` alone would miss the first.
const changed = git(['status', '--short', '--untracked-files=all', '--', ...GENERATED]).trimEnd();
if (!changed) {
  console.log('\nGenerated bundles are up to date: rebuilding changed nothing.');
  process.exit(0);
}

const stat = git(['diff', '--stat', '--', ...GENERATED]).trimEnd();
const fix = [
  '(cd webscraper && npm ci)',
  '(cd engine && npm run build:api)',
  'node scripts/assemble-site.mjs',
  'git add website/api website/scraper',
].join('\n');

console.error('\n=== Generated bundles are stale ===');
console.error('Rebuilding from the sources in this commit changes these committed files:\n');
console.error(changed);
console.error(`\n${stat}`);
console.error(`\nRebuild and commit them (from the repo root):\n\n${fix}\n`);
if (inCi) console.error('::error title=Generated bundles are stale::website/api and website/scraper do not match a rebuild of this commit. The job log and run summary list the files and the commands to refresh them.');

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Generated bundles are stale',
      '',
      'Rebuilding from the sources in this commit changes committed files under `website/`.',
      '',
      '```',
      changed,
      '',
      stat,
      '```',
      '',
      'Refresh them from the repo root and commit the result:',
      '',
      '```sh',
      fix,
      '```',
      '',
    ].join('\n'),
  );
}
process.exit(1);
