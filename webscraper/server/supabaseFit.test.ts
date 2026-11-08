import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretFitStoreProbe, readSupabaseEnv, remoteSkusFromCatalog } from './supabaseFit.ts';

test('readSupabaseEnv requires a url and prefers the secret key', () => {
  assert.equal(readSupabaseEnv({}), null);
  assert.equal(
    readSupabaseEnv({ SUPABASE_URL: 'https://example.supabase.co' }),
    null,
  );
  assert.deepEqual(
    readSupabaseEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'pub',
    }),
    { url: 'https://example.supabase.co', key: 'pub' },
  );
  assert.equal(
    readSupabaseEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'pub',
      SUPABASE_SECRET_KEY: 'sec',
    })?.key,
    'sec',
  );
});

test('remote catalog rows keep fit fields and drop rows without a sku', () => {
  assert.deepEqual(
    remoteSkusFromCatalog([
      {
        sku: 'HM-1',
        productId: 'hm-1',
        brand: 'H&M',
        name: 'Tee',
        overallVerdict: 'True to Size',
        totalReviews: 4,
        committedAt: '2026-11-08T00:00:00Z',
        sizes: [{ size: 'M' }, { size: 'L' }],
        reviews: [{ body: 'secret review' }],
      },
      { name: 'missing sku' },
    ]),
    [
      {
        sku: 'HM-1',
        productId: 'hm-1',
        brand: 'H&M',
        name: 'Tee',
        overallVerdict: 'True to Size',
        totalReviews: 4,
        sizeCount: 2,
        committedAt: '2026-11-08T00:00:00Z',
      },
    ],
  );
  assert.deepEqual(remoteSkusFromCatalog(null), []);
});

test('a rejected empty sku means the fit store is reachable', () => {
  assert.deepEqual(interpretFitStoreProbe(null), { ok: true });
  assert.deepEqual(interpretFitStoreProbe('sku is required'), { ok: true });
  assert.deepEqual(interpretFitStoreProbe('permission denied for function commit_fit_report'), {
    ok: false,
    error: 'permission denied for function commit_fit_report',
  });
});
