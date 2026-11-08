import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProductFitReport } from '../src/utils/fitAnalyzer.ts';
import { fitPayloadFromReport } from './fitPayload.ts';

export type SupabaseSync =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

interface SupabaseEnv {
  url: string;
  key: string;
}

/** Secret key wins when both are set. A publishable key uses the anon role. */
export function readSupabaseEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseEnv | null {
  const url = env.SUPABASE_URL?.trim() ?? '';
  const key = (env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY)?.trim() ?? '';
  if (!url || !key) return null;
  return { url, key };
}

let client: SupabaseClient | null = null;
let clientKey = '';

function getClient(env: SupabaseEnv): SupabaseClient {
  if (!client || clientKey !== `${env.url}\n${env.key}`) {
    client = createClient(env.url, env.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientKey = `${env.url}\n${env.key}`;
  }
  return client;
}

/** Empty payload should be rejected inside the function. That rejection means the key can call it. */
export function interpretFitStoreProbe(message: string | null): SupabaseSync {
  if (message === null || /sku is required/i.test(message)) return { ok: true };
  return { ok: false, error: message };
}

export async function checkFitStore(): Promise<SupabaseSync> {
  const env = readSupabaseEnv();
  if (!env) {
    return { ok: false, skipped: true, reason: 'SUPABASE_URL or a Supabase key is not set' };
  }
  const { error } = await getClient(env).rpc('commit_fit_report', { payload: {} });
  return interpretFitStoreProbe(error?.message ?? null);
}

export async function pushFitReports(reports: ProductFitReport[]): Promise<SupabaseSync> {
  const env = readSupabaseEnv();
  if (!env) {
    return { ok: false, skipped: true, reason: 'SUPABASE_URL or a Supabase key is not set' };
  }
  const db = getClient(env);
  for (const report of reports) {
    const { error } = await db.rpc('commit_fit_report', {
      payload: fitPayloadFromReport(report),
    });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

export interface RemoteFitSku {
  sku: string;
  productId: string;
  brand: string;
  name: string;
  overallVerdict: string;
  totalReviews: number;
  sizeCount: number;
  committedAt: string | null;
}

export type RemoteFitList =
  | { ok: true; skus: RemoteFitSku[] }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

function textField(row: Record<string, unknown>, key: string, fallback = ''): string {
  const value = row[key];
  return typeof value === 'string' ? value : fallback;
}

/** Maps the list_fit_catalog jsonb array. Rows without a sku are dropped. */
export function remoteSkusFromCatalog(rows: unknown): RemoteFitSku[] {
  if (!Array.isArray(rows)) return [];
  const skus: RemoteFitSku[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const sku = textField(record, 'sku');
    if (!sku) continue;
    const sizes = Array.isArray(record.sizes) ? record.sizes : [];
    skus.push({
      sku,
      productId: textField(record, 'productId', sku),
      brand: textField(record, 'brand'),
      name: textField(record, 'name', sku),
      overallVerdict: textField(record, 'overallVerdict'),
      totalReviews: typeof record.totalReviews === 'number' ? record.totalReviews : 0,
      sizeCount: sizes.length,
      committedAt: typeof record.committedAt === 'string' ? record.committedAt : null,
    });
  }
  return skus;
}

export async function listRemoteFitSkus(): Promise<RemoteFitList> {
  const env = readSupabaseEnv();
  if (!env) {
    return { ok: false, skipped: true, reason: 'SUPABASE_URL or a Supabase key is not set' };
  }
  const { data, error } = await getClient(env).rpc('list_fit_catalog');
  if (error) {
    const message = /could not find the function|schema cache/i.test(error.message)
      ? 'The shared fit store has no list_fit_catalog function yet. Run webscraper/supabase/fit_store.sql once in the Supabase SQL editor.'
      : error.message;
    return { ok: false, error: message };
  }
  return { ok: true, skus: remoteSkusFromCatalog(data) };
}

export async function deleteRemoteFitSku(sku: string): Promise<SupabaseSync> {
  const env = readSupabaseEnv();
  if (!env) {
    return { ok: false, skipped: true, reason: 'SUPABASE_URL or a Supabase key is not set' };
  }
  const { error } = await getClient(env).rpc('delete_fit_sku', { target_sku: sku });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
