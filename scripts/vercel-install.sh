#!/bin/sh
# Install from each package directory. `npm install --prefix` exits 254 (ENOENT)
# on the npm that Vercel runs, before any packages are downloaded.
set -eu
cd "$(dirname "$0")/.."
echo "Installing Pearfit from $(pwd)"
if [ ! -f webscraper/package.json ]; then
  echo "webscraper/package.json is not here. Set the Vercel project root to the repository root." >&2
  ls -la >&2
  exit 1
fi
# Playwright has no browser on Vercel. Skip the download if a future release adds one.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
( cd webscraper && npm ci )
npm ci
