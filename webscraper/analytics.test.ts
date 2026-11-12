import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsConsented, CONSENT_KEY } from './analytics.ts';

const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === CONSENT_KEY ? value : null) });

test('analytics start only for a visitor who accepted them', () => {
  assert.equal(analyticsConsented(storageWith('granted')), true);
  assert.equal(analyticsConsented(storageWith('denied')), false);
  assert.equal(analyticsConsented(storageWith(null)), false); // no answer is no
  assert.equal(analyticsConsented(storageWith('yes')), false); // only the exact word counts
});

test('storage that is missing or cannot be read means no consent', () => {
  assert.equal(analyticsConsented(null), false);
  assert.equal(analyticsConsented(undefined), false);
  assert.equal(
    analyticsConsented({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    false,
  );
});

test('the key is the one the marketing site writes', () => {
  assert.equal(CONSENT_KEY, 'pearfit.consent.v1');
});
