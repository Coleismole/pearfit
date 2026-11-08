import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretFitStoreProbe, readSupabaseEnv } from './supabaseFit.ts';

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

test('a rejected empty sku means the fit store is reachable', () => {
  assert.deepEqual(interpretFitStoreProbe(null), { ok: true });
  assert.deepEqual(interpretFitStoreProbe('sku is required'), { ok: true });
  assert.deepEqual(interpretFitStoreProbe('permission denied for function commit_fit_report'), {
    ok: false,
    error: 'permission denied for function commit_fit_report',
  });
});
