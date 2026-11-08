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

export async function deleteRemoteFitSku(sku: string): Promise<SupabaseSync> {
  const env = readSupabaseEnv();
  if (!env) {
    return { ok: false, skipped: true, reason: 'SUPABASE_URL or a Supabase key is not set' };
  }
  const { error } = await getClient(env).rpc('delete_fit_sku', { target_sku: sku });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
