/**
 * Batch 24, tests only: the global snapshot a fresh database would give, read
 * from supabase/schema.sql's seeds (billing_settings, billing_plans) and the
 * code's unit-cost seed. So a test that renders "against the defaults" is
 * really rendering against what `schema.sql` puts in the database, and a
 * placeholder whose setting was renamed or never seeded fails a test.
 *
 * Not imported by the app.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_MARKUP, UNIT_COST_SEED } from '../credit/costs.ts';
import type { GlobalSnapshot, PlanRow, UnitRow } from './placeholders.ts';

let cached: GlobalSnapshot | null = null;

export function schemaSnapshot(overrides: { settings?: Record<string, unknown>; drop?: string[]; callsLive?: boolean } = {}): GlobalSnapshot {
  if (!cached) {
    const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
    const settings = new Map<string, unknown>();
    // Every ('key', 'json') pair in a billing_settings insert; the first seed wins, as `on conflict do nothing` does.
    for (const block of sql.split(/insert into public\.billing_settings/i).slice(1)) {
      const body = block.split(/on conflict/i)[0];
      for (const m of body.matchAll(/\('([a-z0-9_]+)',\s*'((?:[^']|'')*)'(?:::jsonb)?\)/g)) {
        if (settings.has(m[1])) continue;
        try {
          settings.set(m[1], JSON.parse(m[2].replace(/''/g, "'")));
        } catch {
          settings.set(m[1], m[2]);
        }
      }
    }
    const plans: PlanRow[] = [];
    const planBlock = sql.split(/insert into public\.billing_plans/i)[1]?.split(/on conflict/i)[0] ?? '';
    for (const m of planBlock.matchAll(/\('([a-z_]+)',\s*'[^']*',\s*(\d+),\s*'(month|year)'/g)) plans.push({ code: m[1], pricePence: Number(m[2]), interval: m[3], active: true });
    const units = new Map<string, UnitRow>();
    for (const r of UNIT_COST_SEED) units.set(`${r.provider}:${r.unit}`, { unitCostPence: r.unitCostPence, markup: r.markup ?? DEFAULT_MARKUP });
    cached = { settings, plans, units, callsLive: false };
  }
  const settings = new Map(cached.settings);
  for (const [k, v] of Object.entries(overrides.settings ?? {})) settings.set(k, v);
  for (const k of overrides.drop ?? []) settings.delete(k);
  return { settings, plans: cached.plans, units: cached.units, callsLive: overrides.callsLive ?? cached.callsLive };
}
