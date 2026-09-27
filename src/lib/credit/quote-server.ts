import 'server-only';

import { cache } from 'react';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBalance } from './ledger';
import { getBillingSettings } from './unit-costs';
import { allocate, priceLabel, type DealPricing, type GrantLite, type PriceLabel, type Quote } from './deal-pricing';

/**
 * Prices as one member will pay them. Reads the payer's live grants once per
 * request (React `cache`), then every price on the page — the card buttons,
 * the deal sheet, the stage reminder, the Usage page — is walked against the
 * same grants, in the same order and at the same frozen rates as the ledger
 * takes them (`allocate`, src/lib/credit/deal-pricing.ts).
 *
 * `payerId` is the account that pays: a team member's owner.
 */
export interface Quoter {
  admin: boolean;
  pricing: DealPricing;
  /** Base pence the balance covers after open reservations. */
  spendableBasePence: number;
  grants: GrantLite[];
  quote(basePence: number): Quote;
  label(basePence: number): PriceLabel;
}

async function readGrants(payerId: string): Promise<GrantLite[]> {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient()
    .from('credit_grants')
    .select('id, kind, priority, remaining_pence, spend_rate, expires_at, created_at')
    .eq('user_id', payerId)
    .gt('remaining_pence', 0)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) {
    console.error('[credit] grants read for a quote failed:', error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    priority: Number(r.priority) || 3,
    remainingPence: Number(r.remaining_pence) || 0,
    spendRate: Number(r.spend_rate) || 1,
    expiresAt: (r.expires_at as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  }));
}

export const quoterFor = cache(async (payerId: string, admin: boolean): Promise<Quoter> => {
  const [settings, grants, balance] = await Promise.all([
    getBillingSettings(),
    admin ? Promise.resolve([] as GrantLite[]) : readGrants(payerId),
    admin ? Promise.resolve(null) : getBalance(payerId).catch(() => null),
  ]);
  const spendable = balance?.spendableBasePence ?? 0;
  return {
    admin,
    pricing: settings.dealPricing,
    spendableBasePence: spendable,
    grants,
    quote: (basePence: number) => allocate(grants, basePence),
    label: (basePence: number) => priceLabel(allocate(grants, basePence), { admin, spendableBasePence: spendable }),
  };
});
