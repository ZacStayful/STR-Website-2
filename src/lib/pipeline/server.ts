import 'server-only';

/**
 * The server side of the next-step slot: who is looking, their name, email,
 * targets and checklist ticks, and the offer range's inputs. Each read runs
 * once per request (React `cache`), however many deals My deals shows, so
 * filling the slot costs a handful of queries per page, not per deal.
 *
 * Nothing here runs for a deal the member may not see the whole of: the
 * slot checks `opened` and `mine` before calling nextStepFor.
 */
import { cache } from 'react';
import { createSupabaseServerClient } from '../supabase/server';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { isAdminEmail } from '../admin';
import { payerFor } from '../team';
import { getAreaCards } from '../market/cached';
import { parseMarketGoals } from '../market/goals';
import { DEFAULT_FINANCE, type FinanceDefaults } from '../listing/deal';
import { areaRevenueFor } from '../listing/sourcing';
import type { PipelineStatus } from '../listing/pipeline';
import { askingAmount, reductionCount, stepKindOf, timeOnMarket, type DealFacts } from './facts';
import { computeOfferRange, targetCeiling, type OfferRange } from './offer-range';
import { getOfferRules } from './rules-server';
import { buildNextStepView, type NextStepView } from './view';
import type { StepKind } from './types';

export const TICKS_TABLE = 'pipeline_checklist_ticks';

const ITEM_KEY = /^[dl]-[0-9a-f-]{36}$/i;

export function isItemKey(v: unknown): v is string {
  return typeof v === 'string' && ITEM_KEY.test(v);
}

/** The signed-in person, once per request. */
export const currentMember = cache(async (): Promise<{ id: string; email: string | null; adminUser: boolean } | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null, adminUser: isAdminEmail(user.email) } : null;
});

interface MemberContext {
  name: string | null;
  email: string | null;
  finance: FinanceDefaults;
  /** item key → ticked checklist item ids */
  ticks: Map<string, Set<string>>;
}

/** Name, targets and every checklist tick for one member, once per request. */
const memberContext = cache(async (userId: string, email: string | null): Promise<MemberContext> => {
  const supabase = await createSupabaseServerClient();
  const { data: profile, error } = await supabase.from('profiles').select('full_name, market_goals').eq('id', userId).maybeSingle();
  if (error) console.warn('[next-step] profile read failed:', error.message);
  const goals = parseMarketGoals((profile as { market_goals?: unknown } | null)?.market_goals);
  const ticks = new Map<string, Set<string>>();
  if (hasServiceRole()) {
    const { data, error: tickErr } = await createAdminClient().from(TICKS_TABLE).select('item_key, item_id').eq('user_id', userId).limit(5000);
    // A database the schema has not caught up with reads as no ticks.
    if (tickErr) console.warn('[next-step] ticks read failed:', tickErr.message);
    for (const r of (data ?? []) as { item_key: string; item_id: string }[]) {
      const set = ticks.get(r.item_key) ?? new Set<string>();
      set.add(r.item_id);
      ticks.set(r.item_key, set);
    }
  }
  return {
    name: (profile as { full_name?: string | null } | null)?.full_name ?? null,
    email,
    finance: { ...DEFAULT_FINANCE, ...(goals?.finance ?? {}) },
    ticks,
  };
});

const areaCards = cache(async () => getAreaCards().catch(() => []));

/** The offer range for one deal, from the same inputs the deal page's model uses. */
async function offerFor(facts: DealFacts, kind: StepKind, finance: FinanceDefaults, now: Date): Promise<OfferRange> {
  const asking = askingAmount(facts, kind);
  let target: number | null = null;
  let targetMissing: 'noRevenue' | 'studio' | null = null;
  if (facts.marketplace && asking !== null) {
    if (facts.bedrooms === 0) {
      // areaRevenueFor reads 0 bedrooms as unknown and would use the whole area's figure.
      targetMissing = 'studio';
    } else {
      const card = facts.postcodeArea ? (await areaCards()).find((c) => c.code === facts.postcodeArea) ?? null : null;
      const rev = card
        ? areaRevenueFor({ byBedrooms: card.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })), headline: { grossRevenue: card.headline.grossRevenue, adr: card.headline.adr } }, facts.bedrooms)
        : null;
      target = targetCeiling(kind, asking, rev, facts.bedrooms, finance);
      if (target === null) targetMissing = 'noRevenue';
    }
  }
  const age = timeOnMarket(facts, now);
  return computeOfferRange({
    kind,
    marketplace: facts.marketplace,
    asking,
    target,
    targetMissing,
    ageDays: age?.days ?? null,
    reductions: reductionCount(facts),
    rules: facts.marketplace ? await getOfferRules() : { purchase: null, rentToRent: null },
  });
}

/**
 * The next step for one of the signed-in member's own, opened deals. Null
 * when there is nothing to show (not signed in, a kind with no content).
 */
export async function nextStepFor(input: { itemKey: string; stage: PipelineStatus; facts: DealFacts }): Promise<NextStepView | null> {
  const kind = stepKindOf(input.facts.kind);
  if (!kind || !isItemKey(input.itemKey)) return null;
  const me = await currentMember();
  if (!me) return null;
  const ctx = await memberContext(me.id, me.email);
  const now = new Date();
  const offer = input.stage === 'offer' ? await offerFor(input.facts, kind, ctx.finance, now) : null;
  return buildNextStepView({
    itemKey: input.itemKey,
    stage: input.stage,
    facts: input.facts,
    memberName: ctx.name,
    memberEmail: ctx.email,
    ticks: ctx.ticks.get(input.itemKey) ?? new Set(),
    offer,
    finance: ctx.finance,
    now,
  });
}

/**
 * Whether a My deals item is this person's to act on: their own pipeline
 * row (`l-`), or a marketplace deal (`d-`) their team has opened or they
 * have a row for. Used before saving a tick.
 */
export async function ownsItem(userId: string, adminUser: boolean, key: string): Promise<boolean> {
  if (!isItemKey(key) || !hasServiceRole()) return false;
  const admin = createAdminClient();
  const id = key.slice(2);
  if (key.startsWith('l-')) {
    const { data } = await admin.from('checked_listings').select('id').eq('id', id).eq('user_id', userId).maybeSingle();
    return Boolean(data);
  }
  if (adminUser) return true;
  const { data: deal } = await admin.from('marketplace_deals').select('canonical_url').eq('id', id).maybeSingle();
  const url = (deal as { canonical_url?: string } | null)?.canonical_url;
  if (!url) return false;
  const { payerId } = await payerFor(userId);
  const [open, row] = await Promise.all([
    admin.from('deal_opens').select('id').eq('user_id', payerId).eq('canonical_url', url).eq('status', 'open').maybeSingle(),
    admin.from('checked_listings').select('id').eq('user_id', userId).eq('canonical_url', url).maybeSingle(),
  ]);
  return Boolean(open.data) || Boolean(row.data);
}
