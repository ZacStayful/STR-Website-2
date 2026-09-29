import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { BrokerLedger, BrokerStore, CachedAnswer, CallRecord, ProviderName } from './types';
import { memoryLedger, memoryStore } from './resolve';

/**
 * Supabase-backed cache and ledger (service role; tables have RLS with no
 * policies). When the service key is missing — local dev, tests — the broker
 * silently uses in-memory adapters so the site still works, just without
 * cross-request caching or spend tracking.
 */


const fallbackStore = memoryStore();
const fallbackLedger = memoryLedger();

/** PostgREST's cap on the rows one query returns. */
const PAGE = 1000;

/**
 * Every row a query would return, a page at a time: the fallback when the
 * Batch 16 spend functions are not in the database yet (a bare select stops
 * at 1,000 rows, which is how the September loop hid).
 */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

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
      // Paid, successful rungs are written (and charged) by meter() inside the
      // provider client; writing them here too would double-count spend. The
      // broker still records cache hits and failures.
      if (c.ok && !c.cacheHit && c.costPence > 0) return;
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
      // Only calls the broker itself made (tagged with a question name, see
      // tag.ts): report and fallback spend has its own reservation and must
      // not use up the lookups' daily budget. Summed in the database, so a
      // busy day cannot hide past the 1,000th row.
      const { data, error } = await admin.rpc('provider_spend_since', { p_provider: provider, p_since: start.toISOString(), p_user: userId ?? null });
      if (!error) return Number(data) || 0;
      const rows = await allRows<{ cost_pence: number | null; raw_pence?: number | null }>((from, to) => {
        let q = admin.from('provider_calls').select('cost_pence').eq('provider', provider).eq('ok', true).gte('at', start.toISOString()).not('question', 'like', `${provider}.%`);
        if (userId) q = q.eq('user_id', userId);
        return q.order('id', { ascending: true }).range(from, to);
      });
      return rows.reduce((s, r) => s + (Number(r.cost_pence) || 0), 0);
    },
  };
}

/** Today's spend per provider, for the admin panel. */
export async function spendSummary(days = 7): Promise<{ day: string; provider: string; calls: number; cacheHits: number; pence: number }[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  since.setUTCHours(0, 0, 0, 0);
  const order = (a: { day: string; provider: string }, b: { day: string; provider: string }) => (a.day === b.day ? a.provider.localeCompare(b.provider) : b.day.localeCompare(a.day));
  const { data: summed, error: rpcError } = await admin.rpc('provider_spend_daily', { p_since: since.toISOString() });
  if (!rpcError && Array.isArray(summed)) {
    return (summed as { day: string; provider: string; calls: number; cache_hits: number; pence: number }[])
      .map((r) => ({ day: String(r.day), provider: String(r.provider), calls: Number(r.calls) || 0, cacheHits: Number(r.cache_hits) || 0, pence: Number(r.pence) || 0 }))
      .sort(order);
  }
  let data: { at: string; provider: string; cost_pence: number | null; cache_hit: boolean }[];
  try {
    data = await allRows((from, to) => admin.from('provider_calls').select('at, provider, cost_pence, cache_hit').gte('at', since.toISOString()).order('id', { ascending: true }).range(from, to));
  } catch {
    return [];
  }
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
  return [...agg.values()].sort(order);
}

export interface UnitSpend {
  provider: string;
  unit: string;
  /** Paid, successful, uncached calls. */
  calls: number;
  rawPence: number;
  chargedPence: number;
  /** The part nobody was charged for. */
  housePence: number;
}

/**
 * Paid calls per provider × unit since `sinceIso`, for /admin/billing:
 * summed in the database (provider_spend_by_unit), or, before that function
 * exists, over every row a page at a time. Throws when neither can be read.
 */
export async function providerSpendByUnit(admin: ReturnType<typeof createAdminClient>, sinceIso: string): Promise<UnitSpend[]> {
  const { data, error } = await admin.rpc('provider_spend_by_unit', { p_since: sinceIso });
  if (!error && Array.isArray(data)) {
    return (data as { provider: string; unit: string; calls: number; raw_pence: number; charged_pence: number; house_pence: number }[]).map((r) => ({
      provider: String(r.provider),
      unit: String(r.unit ?? ''),
      calls: Number(r.calls) || 0,
      rawPence: Number(r.raw_pence) || 0,
      chargedPence: Number(r.charged_pence) || 0,
      housePence: Number(r.house_pence) || 0,
    }));
  }
  const rows = await allRows<{ provider: string; unit: string | null; cost_pence: number | null; charged_pence: number | null }>((from, to) =>
    admin.from('provider_calls').select('provider, unit, cost_pence, charged_pence').gte('at', sinceIso).eq('ok', true).eq('cache_hit', false).order('id', { ascending: true }).range(from, to),
  );
  const out = new Map<string, UnitSpend>();
  for (const r of rows) {
    const key = `${r.provider}:${r.unit ?? ''}`;
    const s = out.get(key) ?? { provider: String(r.provider), unit: String(r.unit ?? ''), calls: 0, rawPence: 0, chargedPence: 0, housePence: 0 };
    const cost = Number(r.cost_pence) || 0;
    const charged = Number(r.charged_pence) || 0;
    s.calls += 1;
    s.rawPence += cost;
    s.chargedPence += charged;
    if (!(charged > 0)) s.housePence += cost;
    out.set(key, s);
  }
  return [...out.values()];
}
