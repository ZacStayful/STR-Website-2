/**
 * The demand-led searches' business numbers. Each is a billing_settings row
 * with a default and bounds here, so a missing or bad row falls back to the
 * decided value rather than switching the job off or letting it run wild.
 * Edited on /admin/demand; seeded by the "Batch 15" section of
 * supabase/schema.sql.
 *
 * Pure: no network, no database, no server-only.
 */

export interface DemandSettings {
  /** Members whose running profiles must want an area × kind before it is searched. */
  minMembers: number;
  /** Provider spend on demand-led searches per UK calendar month, raw pence. */
  capPence: number;
  /** How much a paying member counts in the search order. The threshold counts members, paying or not. */
  payingWeight: number;
  /** A "near me" radius adds the home area plus up to this many nearest areas inside it. */
  radiusAreas: number;
  /** A member counts only if seen in the app within this many days. */
  activeDays: number;
  /** The most areas one profile adds. */
  maxAreasPerProfile: number;
}

export const DEMAND_SETTING_KEYS: Record<keyof DemandSettings, string> = {
  minMembers: 'demand_min_members',
  capPence: 'demand_monthly_cap_pence',
  payingWeight: 'demand_paying_weight',
  radiusAreas: 'demand_radius_areas',
  activeDays: 'demand_active_days',
  maxAreasPerProfile: 'demand_max_areas_per_profile',
};

export const DEFAULT_DEMAND_SETTINGS: DemandSettings = {
  minMembers: 2,
  capPence: 10_000,
  payingWeight: 2,
  radiusAreas: 5,
  activeDays: 30,
  maxAreasPerProfile: 10,
};

interface Bound {
  min: number;
  max: number;
  whole: boolean;
}

export const DEMAND_SETTING_BOUNDS: Record<keyof DemandSettings, Bound> = {
  minMembers: { min: 1, max: 100, whole: true },
  capPence: { min: 0, max: 1_000_000, whole: true },
  payingWeight: { min: 1, max: 10, whole: false },
  radiusAreas: { min: 0, max: 20, whole: true },
  activeDays: { min: 1, max: 365, whole: true },
  maxAreasPerProfile: { min: 1, max: 50, whole: true },
};

const FIELDS = Object.keys(DEFAULT_DEMAND_SETTINGS) as (keyof DemandSettings)[];

function inBounds(raw: unknown, b: Bound): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  if (b.whole && !Number.isInteger(n)) return null;
  return n >= b.min && n <= b.max ? n : null;
}

/** The settings from billing_settings rows (key → value); anything missing or out of bounds takes its default. */
export function parseDemandSettings(rows: ReadonlyMap<string, unknown>): DemandSettings {
  const out = { ...DEFAULT_DEMAND_SETTINGS };
  for (const field of FIELDS) {
    const v = inBounds(rows.get(DEMAND_SETTING_KEYS[field]), DEMAND_SETTING_BOUNDS[field]);
    if (v !== null) out[field] = v;
  }
  return out;
}

export type SettingsFormResult = { ok: true; settings: DemandSettings } | { ok: false; error: string };

/** "£100", "100.50", "1,000" → pence; null when it is not an amount. */
export function poundsToPence(raw: string | null): number | null {
  if (raw === null) return null;
  const s = raw.replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/**
 * The /admin/demand settings form. The cap is typed in pounds; everything
 * else as a plain number. Every field is required, so a half-filled form can
 * never silently reset a setting.
 */
export function validateSettingsForm(get: (name: string) => string | null): SettingsFormResult {
  const whole = (name: string, label: string, b: Bound): number | string => {
    const v = inBounds(get(name), b);
    return v === null ? `${label} must be a whole number from ${b.min} to ${b.max}.` : v;
  };
  const minMembers = whole('minMembers', 'Members needed', DEMAND_SETTING_BOUNDS.minMembers);
  if (typeof minMembers === 'string') return { ok: false, error: minMembers };
  const capPence = poundsToPence(get('capPounds'));
  const capB = DEMAND_SETTING_BOUNDS.capPence;
  if (capPence === null || capPence < capB.min || capPence > capB.max) return { ok: false, error: `The monthly cap must be an amount in pounds from £${capB.min / 100} to £${(capB.max / 100).toLocaleString('en-GB')}.` };
  const weightB = DEMAND_SETTING_BOUNDS.payingWeight;
  const payingWeight = inBounds(get('payingWeight'), weightB);
  if (payingWeight === null) return { ok: false, error: `Paying weight must be a number from ${weightB.min} to ${weightB.max}.` };
  const radiusAreas = whole('radiusAreas', 'Areas near home', DEMAND_SETTING_BOUNDS.radiusAreas);
  if (typeof radiusAreas === 'string') return { ok: false, error: radiusAreas };
  const activeDays = whole('activeDays', 'Active days', DEMAND_SETTING_BOUNDS.activeDays);
  if (typeof activeDays === 'string') return { ok: false, error: activeDays };
  const maxAreasPerProfile = whole('maxAreasPerProfile', 'Areas per profile', DEMAND_SETTING_BOUNDS.maxAreasPerProfile);
  if (typeof maxAreasPerProfile === 'string') return { ok: false, error: maxAreasPerProfile };
  return { ok: true, settings: { minMembers, capPence, payingWeight, radiusAreas, activeDays, maxAreasPerProfile } };
}
