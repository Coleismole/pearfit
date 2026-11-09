import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedFetchTarget, createRequestHostGuard, isBlockedHostname } from './publicUrl.ts';

test('private, loopback, and metadata hosts are not fetch targets', () => {
  assert.equal(isBlockedHostname('127.0.0.1'), true);
  assert.equal(isBlockedHostname('10.1.2.3'), true);
  assert.equal(isBlockedHostname('192.168.0.5'), true);
  assert.equal(isBlockedHostname('172.16.0.1'), true);
  assert.equal(isBlockedHostname('169.254.169.254'), true);
  assert.equal(isBlockedHostname('localhost'), true);
  assert.equal(isBlockedHostname('metadata.google.internal'), true);
  assert.equal(isBlockedHostname('::1'), true);
  assert.equal(isBlockedHostname('8.8.8.8'), false);
  assert.equal(isBlockedHostname('www.uniqlo.com'), false);

  assert.match(blockedFetchTarget('http://127.0.0.1:9/missing') ?? '', /not a public address/);
  assert.match(blockedFetchTarget('http://169.254.169.254/latest/meta-data') ?? '', /not a public address/);
  assert.match(blockedFetchTarget('file:///etc/passwd') ?? '', /http and https/);
  assert.equal(blockedFetchTarget('https://www.uniqlo.com/ca/en/products/E487396-000'), null);
});

test('IPv6 forms that embed a private IPv4 address are not fetch targets', () => {
  // The URL parser rewrites [::ffff:127.0.0.1] to [::ffff:7f00:1]; both must be refused.
  assert.equal(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  assert.match(blockedFetchTarget('http://[::ffff:127.0.0.1]/') ?? '', /not a public address/);
  // a9fe:a9fe is 169.254.169.254, the cloud metadata address.
  assert.match(blockedFetchTarget('http://[::ffff:a9fe:a9fe]/latest/meta-data/') ?? '', /not a public address/);
  assert.match(blockedFetchTarget('http://[::127.0.0.1]/') ?? '', /not a public address/);
  assert.match(blockedFetchTarget('http://[64:ff9b::7f00:1]/') ?? '', /not a public address/);
  assert.equal(isBlockedHostname('::ffff:0a00:0001'), true); // 10.0.0.1
  // 0808:0808 is 8.8.8.8, a public address.
  assert.equal(isBlockedHostname('::ffff:808:808'), false);
  assert.equal(isBlockedHostname('::ffff:8.8.8.8'), false);
});

test('the headless request guard refuses public names that resolve to private addresses', async () => {
  const answers: Record<string, string> = {
    'shop.example.com': '93.184.216.34',
    'rebind.example.com': '10.0.0.7',
  };
  let lookups = 0;
  const guard = createRequestHostGuard(async (hostname) => {
    lookups++;
    const address = answers[hostname];
    if (!address) throw new Error('ENOTFOUND');
    return [{ address }];
  });
  assert.equal(await guard('https://shop.example.com/p/1'), false);
  assert.equal(await guard('https://rebind.example.com/admin'), true);
  assert.equal(await guard('http://127.0.0.1/'), true);
  assert.equal(await guard('http://[::ffff:7f00:1]/'), true);
  assert.equal(await guard('https://unknown.example.com/'), false);
  // The second request to the same host uses the cached answer.
  assert.equal(await guard('https://shop.example.com/p/2'), false);
  assert.equal(lookups, 3);
});
