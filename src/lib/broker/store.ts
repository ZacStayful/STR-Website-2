import 'server-only';

import { createAdminClient } from '../supabase/admin';
import type { BrokerLedger, BrokerStore, CachedAnswer, CallRecord, ProviderName } from './types';
import { memoryLedger, memoryStore } from './resolve';

/**
 * Supabase-backed cache and ledger (service role; tables have RLS with no
 * policies). When the service key is missing — local dev, tests — the broker
 * silently uses in-memory adapters so the site still works, just without
 * cross-request caching or spend tracking.
 */

function hasServiceRole(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const fallbackStore = memoryStore();
const fallbackLedger = memoryLedger();

export function brokerStore(): BrokerStore {
  if (!hasServiceRole()) return fallbackStore;
  const admin = createAdminClient();
  return {
    async get<T>(question: string, key: string): Promise<CachedAnswer<T> | null> {
      const { data, error } = await admin
        .from('broker_cache')
        .select('value, provider, level, fetched_at, expires_at')
        .eq('question', question)
        .eq('key', key)
        .maybeSingle();
      if (error || !data) return null;
      return { value: data.value as T, provider: data.provider as ProviderName, level: data.level as number, fetchedAt: data.fetched_at as string, expiresAt: data.expires_at as string };
    },
    async set<T>(question: string, key: string, a: CachedAnswer<T>): Promise<void> {
      const { error } = await admin
        .from('broker_cache')
        .upsert({ question, key, value: a.value, provider: a.provider, level: a.level, fetched_at: a.fetchedAt, expires_at: a.expiresAt }, { onConflict: 'question,key' });
      if (error) throw new Error(error.message);
    },
  };
}

export function brokerLedger(): BrokerLedger {
  if (!hasServiceRole()) return fallbackLedger;
  const admin = createAdminClient();
  return {
    async record(c: CallRecord): Promise<void> {
      const { error } = await admin.from('provider_calls').insert({
        provider: c.provider,
        question: c.question,
        key: c.key,
        cost_pence: c.costPence,
        cache_hit: c.cacheHit,
        user_id: c.userId,
        ok: c.ok,
        ms: c.ms,
      });
      if (error) throw new Error(error.message);
    },
    async spentToday(provider: ProviderName, userId?: string | null): Promise<number> {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      let q = admin.from('provider_calls').select('cost_pence').eq('provider', provider).eq('ok', true).gte('at', start.toISOString());
      if (userId) q = q.eq('user_id', userId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).reduce((s, r) => s + (Number(r.cost_pence) || 0), 0);
    },
  };
}

/** Today's spend per provider, for the admin panel. */
export async function spendSummary(days = 7): Promise<{ day: string; provider: string; calls: number; cacheHits: number; pence: number }[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await admin.from('provider_calls').select('at, provider, cost_pence, cache_hit').gte('at', since.toISOString());
  if (error || !data) return [];
  const agg = new Map<string, { day: string; provider: string; calls: number; cacheHits: number; pence: number }>();
  for (const r of data) {
    const day = String(r.at).slice(0, 10);
    const k = `${day}|${r.provider}`;
    const e = agg.get(k) ?? { day, provider: String(r.provider), calls: 0, cacheHits: 0, pence: 0 };
    e.calls++;
    if (r.cache_hit) e.cacheHits++;
    e.pence += Number(r.cost_pence) || 0;
    agg.set(k, e);
  }
  return [...agg.values()].sort((a, b) => (a.day === b.day ? a.provider.localeCompare(b.provider) : b.day.localeCompare(a.day)));
}
