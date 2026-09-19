import 'server-only';

import { randomBytes } from 'node:crypto';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { parseLeadRules, type LeadRules } from '../leads/rules';
import { parseBrand, type FunnelBrand } from './brand';

/**
 * White-label funnels: a customer's own lead-capture link.
 *
 * Every write here goes through the service role. `funnels` is RLS-on with a
 * select-own policy and nothing user-writable, so a member reads their own
 * rows directly but a token — the credential in the public URL — can only be
 * minted server-side.
 */

export type ReportDepth = 'standard' | 'enhanced';
export type UnqualifiedPolicy = 'crm_flagged' | 'hold';

export interface Funnel {
  id: string;
  userId: string;
  publicToken: string;
  name: string;
  brand: FunnelBrand;
  leadRules: LeadRules;
  reportDepth: ReportDepth;
  unqualifiedPolicy: UnqualifiedPolicy;
  active: boolean;
  dailyCap: number;
  dailySpendCapPence: number;
  rotatedAt: string | null;
  createdAt: string;
}

/** What a prospect's page needs. Never carries the owner's id. */
export type PublicFunnel = Pick<Funnel, 'id' | 'name' | 'brand' | 'reportDepth'>;

const COLUMNS =
  'id, user_id, public_token, name, brand, lead_rules, report_depth, unqualified_policy, active, daily_cap, daily_spend_cap_pence, rotated_at, created_at';

/** Same shape as the other public tokens in this codebase (picks, deal shares). */
export function mintFunnelToken(): string {
  return randomBytes(24).toString('base64url');
}

export function isFunnelToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{24,64}$/.test(token);
}

function toFunnel(r: Record<string, unknown>): Funnel {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    publicToken: String(r.public_token),
    name: typeof r.name === 'string' ? r.name : 'My funnel',
    brand: parseBrand(r.brand),
    leadRules: parseLeadRules(r.lead_rules),
    reportDepth: r.report_depth === 'enhanced' ? 'enhanced' : 'standard',
    unqualifiedPolicy: r.unqualified_policy === 'hold' ? 'hold' : 'crm_flagged',
    active: r.active !== false,
    dailyCap: Number(r.daily_cap) || 0,
    dailySpendCapPence: Number(r.daily_spend_cap_pence) || 0,
    rotatedAt: typeof r.rotated_at === 'string' ? r.rotated_at : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
  };
}

export async function listFunnels(userId: string): Promise<Funnel[]> {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient()
    .from('funnels')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[funnels] list failed:', error.message);
    return [];
  }
  return (data ?? []).map((r) => toFunnel(r as Record<string, unknown>));
}

/** Scoped by user id as well as funnel id, so an id from elsewhere reads nothing. */
export async function getFunnel(userId: string, id: string): Promise<Funnel | null> {
  if (!hasServiceRole() || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await createAdminClient()
    .from('funnels')
    .select(COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[funnels] get failed:', error.message);
    return null;
  }
  return data ? toFunnel(data as Record<string, unknown>) : null;
}

/**
 * A new funnel starts PAUSED, overriding the column default. Going live is
 * gated on the customer supplying a privacy policy (see activationBlockers),
 * and a funnel that was live from the moment it was created would collect a
 * prospect's details before that gate had ever been applied.
 */
export async function createFunnel(userId: string, name: string): Promise<Funnel | null> {
  if (!hasServiceRole()) return null;
  const { data, error } = await createAdminClient()
    .from('funnels')
    .insert({ user_id: userId, public_token: mintFunnelToken(), name: name.slice(0, 80) || 'My funnel', active: false })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    console.error('[funnels] create failed:', error?.message);
    return null;
  }
  return toFunnel(data as Record<string, unknown>);
}

export interface FunnelPatch {
  name?: string;
  brand?: FunnelBrand;
  leadRules?: LeadRules;
  reportDepth?: ReportDepth;
  unqualifiedPolicy?: UnqualifiedPolicy;
  active?: boolean;
  dailyCap?: number;
  dailySpendCapPence?: number;
}

export async function updateFunnel(userId: string, id: string, patch: FunnelPatch): Promise<boolean> {
  if (!hasServiceRole() || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name.slice(0, 80) || 'My funnel';
  if (patch.brand !== undefined) row.brand = patch.brand;
  if (patch.leadRules !== undefined) row.lead_rules = patch.leadRules;
  if (patch.reportDepth !== undefined) row.report_depth = patch.reportDepth;
  if (patch.unqualifiedPolicy !== undefined) row.unqualified_policy = patch.unqualifiedPolicy;
  if (patch.active !== undefined) row.active = patch.active;
  // Both caps are money guards, so they are clamped rather than trusted: a
  // funnel with no ceiling is how a bug becomes an unbounded bill.
  if (patch.dailyCap !== undefined) row.daily_cap = clamp(patch.dailyCap, 1, 10_000);
  if (patch.dailySpendCapPence !== undefined) row.daily_spend_cap_pence = clamp(patch.dailySpendCapPence, 100, 1_000_000);

  const { error } = await createAdminClient().from('funnels').update(row).eq('id', id).eq('user_id', userId);
  if (error) console.error('[funnels] update failed:', error.message);
  return !error;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Replaces the public token. Lead history stays attached to the funnel, so a
 * leaked or abused link can be retired without losing anything.
 */
export async function rotateFunnelToken(userId: string, id: string): Promise<string | null> {
  if (!hasServiceRole() || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const token = mintFunnelToken();
  const { error } = await createAdminClient()
    .from('funnels')
    .update({ public_token: token, rotated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    console.error('[funnels] rotate failed:', error.message);
    return null;
  }
  return token;
}

/**
 * Public read for the funnel page, which has no session. Returns only what a
 * prospect's browser needs — never the owner's id, their rules or their caps.
 * An inactive funnel reads as missing, so deactivating is an instant off.
 */
export async function funnelByToken(token: string): Promise<PublicFunnel | null> {
  if (!isFunnelToken(token) || !hasServiceRole()) return null;
  const { data, error } = await createAdminClient()
    .from('funnels')
    .select('id, name, brand, report_depth, active')
    .eq('public_token', token)
    .maybeSingle();
  if (error) {
    console.error('[funnels] token lookup failed:', error.message);
    return null;
  }
  if (!data || data.active === false) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    name: typeof r.name === 'string' ? r.name : 'Property income analysis',
    brand: parseBrand(r.brand),
    reportDepth: r.report_depth === 'enhanced' ? 'enhanced' : 'standard',
  };
}

/**
 * The full row behind a token, for the analyse route: it needs the owner to
 * bill, the rules to qualify against and the caps to enforce.
 */
export async function ownedFunnelByToken(token: string): Promise<Funnel | null> {
  if (!isFunnelToken(token) || !hasServiceRole()) return null;
  const { data, error } = await createAdminClient().from('funnels').select(COLUMNS).eq('public_token', token).maybeSingle();
  if (error) {
    console.error('[funnels] owned token lookup failed:', error.message);
    return null;
  }
  if (!data) return null;
  const funnel = toFunnel(data as Record<string, unknown>);
  return funnel.active ? funnel : null;
}
