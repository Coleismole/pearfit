import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Hosts the scraper must not fetch. The endpoint is public, so a product URL
 * that points at localhost, a private network, or the cloud metadata address
 * would let a caller reach those from the server.
 */
export function isBlockedHostname(hostname: string): boolean {
  let host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (host.includes(':')) return isBlockedIPv6(host);
  // A single integer is a decimal form of an IPv4 address (2130706433 = 127.0.0.1).
  if (/^\d+$/.test(host)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isBlockedIPv4(host);
  return false;
}

function isBlockedIPv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const bare = host.split('%')[0];
  if (bare === '::' || bare === '::1') return true;
  if (/^fe[89ab]/.test(bare) || bare.startsWith('fc') || bare.startsWith('fd')) return true;
  return false;
}

/** A message when this string is not a public http(s) URL, otherwise null. */
export function blockedFetchTarget(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'That is not a valid http(s) URL.';
  }
  if (url.username || url.password) {
    return 'The scraper does not fetch URLs that embed credentials.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http and https product URLs can be scraped.';
  }
  if (isBlockedHostname(url.hostname)) {
    return `${url.hostname} is not a public address. The scraper only fetches public product pages.`;
  }
  return null;
}

/** Same check after DNS, so a public name that points at a private address is refused. */
export async function blockedFetchTargetResolved(raw: string): Promise<string | null> {
  const literal = blockedFetchTarget(raw);
  if (literal) return literal;
  const hostname = new URL(raw).hostname;
  if (isIP(hostname)) return null;
  try {
    const records = await lookup(hostname, { all: true });
    for (const record of records) {
      if (isBlockedHostname(record.address)) {
        return `${hostname} resolves to a non-public address. The scraper only fetches public product pages.`;
      }
    }
  } catch {
    // The fetch reports a name that does not resolve.
  }
  return null;
}
