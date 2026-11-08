import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedFetchTarget, isBlockedHostname } from './publicUrl.ts';

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
