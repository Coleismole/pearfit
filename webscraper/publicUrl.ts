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
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a >= 224) return true;
  return false;
}

/** The IPv4 address in the last 32 bits of an IPv6 address written in hex, e.g. "7f00:1" is 127.0.0.1. */
function embeddedIPv4(high: string, low: string): string {
  const hi = parseInt(high, 16);
  const lo = parseInt(low, 16);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

function isBlockedIPv6(host: string): boolean {
  const bare = host.split('%')[0];
  if (bare === '::' || bare === '::1') return true;
  if (/^fe[89abcdef]/.test(bare) || bare.startsWith('fc') || bare.startsWith('fd')) return true;
  if (/^ff[0-9a-f]{0,2}:/.test(bare)) return true; // multicast ff00::/8
  // Teredo (2001:0::/32) tunnels to an IPv4 server, so it is not a plain public address.
  if (/^2001:0{0,3}:/.test(bare)) return true;
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses
  // reach the embedded IPv4 host. The URL parser rewrites the dotted form to hex, so check both.
  const sixToFour = bare.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour) return isBlockedIPv4(embeddedIPv4(sixToFour[1], sixToFour[2]));
  const embedded = bare.match(/^(?:::(?:ffff:)?|64:ff9b::)(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (embedded) return isBlockedIPv4(embedded[1] ?? embeddedIPv4(embedded[2], embedded[3]));
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

/**
 * A per-render check for every request a headless page makes. The hostname alone is not enough:
 * a public name can point at a private address, so each new host is resolved once and cached.
 * A name that does not resolve is let through; the browser request fails on its own.
 */
export function createRequestHostGuard(
  resolve: (hostname: string) => Promise<{ address: string }[]> = (hostname) => lookup(hostname, { all: true }),
): (rawUrl: string) => Promise<boolean> {
  const cache = new Map<string, Promise<boolean>>();
  return (rawUrl: string) => {
    let hostname: string;
    try {
      hostname = new URL(rawUrl).hostname;
    } catch {
      return Promise.resolve(false);
    }
    // data:, blob: and about: requests never leave the browser, and they have no hostname to check.
    if (/^(?:data|blob|about):/i.test(rawUrl)) return Promise.resolve(false);
    let verdict = cache.get(hostname);
    if (!verdict) {
      verdict = (async () => {
        if (isBlockedHostname(hostname)) return true;
        const bare = hostname.replace(/^\[|\]$/g, '');
        if (isIP(bare)) return false;
        try {
          const records = await resolve(hostname);
          return records.some((record) => isBlockedHostname(record.address));
        } catch {
          return false;
        }
      })();
      cache.set(hostname, verdict);
    }
    return verdict;
  };
}
