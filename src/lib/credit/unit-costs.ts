import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { UNIT_COST_SEED, seedTable, unitKey, type UnitCost, type UnitCostTable, DEFAULT_MARKUP } from './costs';
import { DEFAULT_SPEND_RATES, type SpendRates } from './pricing';

/**
 * Live unit costs and billing settings, read from Supabase with a short
 * in-memory cache so the meter never adds a round trip per provider call.
 * Without a service role (local dev, tests) the code seed is used.
 */

const CACHE_MS = 60_000;

let tableCache: { at: number; table: UnitCostTable } | null = null;
let settingsCache: { at: number; settings: BillingSettings } | null = null;

export interface BillingSettings {
  welcomeGrantPence: number;
  lowBalanceRatio: number;
  baseMarkup: number;
  spendRates: SpendRates;
  topupPresetsPence: number[];
  referralPence: number;
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  welcomeGrantPence: 2000,
  lowBalanceRatio: 0.8,
  baseMarkup: DEFAULT_MARKUP,
  spendRates: DEFAULT_SPEND_RATES,
  topupPresetsPence: [1000, 2500, 5000],
  referralPence: 1000,
};

export function invalidateCreditCaches(): void {
  tableCache = null;
  settingsCache = null;
}

export async function getUnitCostTable(): Promise<UnitCostTable> {
  if (tableCache && Date.now() - tableCache.at < CACHE_MS) return tableCache.table;
  if (!hasServiceRole()) return seedTable();
  try {
    const { data, error } = await createAdminClient().from('unit_costs').select('provider, unit, label, unit_cost_pence, markup, notes');
    if (error) throw new Error(error.message);
    const table: UnitCostTable = seedTable();
    for (const r of data ?? []) {
      const row: UnitCost = { provider: String(r.provider), unit: String(r.unit), label: String(r.label), unitCostPence: Number(r.unit_cost_pence) || 0, markup: Number(r.markup) || DEFAULT_MARKUP, notes: (r.notes as string | null) ?? null };
      table.set(unitKey(row.provider, row.unit), row);
    }
    tableCache = { at: Date.now(), table };
    return table;
  } catch (err) {
    console.error('[credit] unit_costs read failed, using seed:', err);
    return seedTable();
  }
}

export async function getBillingSettings(): Promise<BillingSettings> {
  if (settingsCache && Date.now() - settingsCache.at < CACHE_MS) return settingsCache.settings;
  if (!hasServiceRole()) return DEFAULT_BILLING_SETTINGS;
  try {
    const { data, error } = await createAdminClient().from('billing_settings').select('key, value');
    if (error) throw new Error(error.message);
    const kv = new Map<string, unknown>((data ?? []).map((r) => [String(r.key), r.value]));
    const num = (k: string, d: number) => {
      const v = Number(kv.get(k));
      return Number.isFinite(v) ? v : d;
    };
    const rates = (kv.get('spend_rates') ?? {}) as Partial<Record<keyof SpendRates, number>>;
    const presets = kv.get('topup_presets_pence');
    const settings: BillingSettings = {
      welcomeGrantPence: num('welcome_grant_pence', 2000),
      lowBalanceRatio: num('low_balance_ratio', 0.8),
      baseMarkup: num('base_markup', DEFAULT_MARKUP),
      spendRates: {
        plan: Number(rates.plan) || 1,
        welcome: Number(rates.welcome) || 1,
        topup: Number(rates.topup) || 1.5,
        adjustment: Number(rates.adjustment) || 1.5,
      },
      topupPresetsPence: Array.isArray(presets) && presets.length ? presets.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [1000, 2500, 5000],
      referralPence: num('referral_pence', 1000),
    };
    settingsCache = { at: Date.now(), settings };
    return settings;
  } catch (err) {
    console.error('[credit] billing_settings read failed, using defaults:', err);
    return DEFAULT_BILLING_SETTINGS;
  }
}

/** Inserts any seed rows missing from unit_costs. Never overwrites an edit. */
export async function syncUnitCosts(): Promise<number> {
  if (!hasServiceRole()) return 0;
  const admin = createAdminClient();
  const { data } = await admin.from('unit_costs').select('provider, unit');
  const have = new Set((data ?? []).map((r) => unitKey(String(r.provider), String(r.unit))));
  const missing = UNIT_COST_SEED.filter((s) => !have.has(unitKey(s.provider, s.unit)));
  if (missing.length === 0) return 0;
  const { error } = await admin.from('unit_costs').upsert(
    missing.map((s) => ({ provider: s.provider, unit: s.unit, label: s.label, unit_cost_pence: s.unitCostPence, markup: s.markup ?? DEFAULT_MARKUP, notes: s.notes ?? null, updated_by: 'seed' })),
    { onConflict: 'provider,unit', ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  invalidateCreditCaches();
  return missing.length;
}

export async function updateUnitCost(provider: string, unit: string, patch: { unitCostPence?: number; markup?: number; notes?: string | null }, updatedBy: string): Promise<void> {
  const admin = createAdminClient();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: updatedBy };
  if (patch.unitCostPence !== undefined) row.unit_cost_pence = patch.unitCostPence;
  if (patch.markup !== undefined) row.markup = patch.markup;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { error } = await admin.from('unit_costs').update(row).eq('provider', provider).eq('unit', unit);
  if (error) throw new Error(error.message);
  invalidateCreditCaches();
}

export async function updateBillingSetting(key: string, value: unknown): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('billing_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  invalidateCreditCaches();
}
