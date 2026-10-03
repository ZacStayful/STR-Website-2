import 'server-only';

/**
 * Batch 23b: the reads behind a member's fact sheet (./facts.ts).
 *
 * Shared once per run (RunContext): yesterday's listing_scan_days rows (and
 * last week's on a Monday), and the deals that went live over the last eight
 * UK days. Per member: their scan scope (Home's own, memberScanScope), their
 * tracked deals (loadTrackedDeals, own scope: the early-access window and the
 * opened-address rule already applied), their stage moves, and the live deals
 * that fit them now (Today's "N match", the same filters).
 *
 * Nothing here reads a listing title, description or agent text into the
 * sheet; addresses are read only to be FORBIDDEN in what the writer returns.
 */
import type { createAdminClient } from '../supabase/admin';
import { addDays, ukDay, ukWeekStart } from '../activity/week';
import { inScope, type ScanDayRow, type ScanKind, type ScanScope } from '../home/scan-days';
import { memberScanScope } from '../home/server';
import { loadTrackedDeals } from '../listing/tracked-server';
import { profilesFor } from '../profiles/server';
import { isRunning } from '../profiles/rules';
import { parseMarketGoals } from '../market/goals';
import { tailoringForMember } from '../tailoring/server';
import { typesShown } from '../profile/deal-types';
import { filtersForType } from '../today/type-filters';
import { dealVisibilityFor } from '../marketplace/tier';
import { countDealsAcross } from '../marketplace/queries';
import { PASS_WINDOW_DAYS, type SheetInputs } from './facts';
import { overdueDeals } from './nudges';
import { keptDropsFrom, passesByTypeFrom, pipelineOf, stageEntriesFrom, type CardLite, type StageMove, type TrackedLite } from './tracked-facts';
import type { OverdueDeal } from './facts';

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunContext {
  admin: Admin;
  now: Date;
  ukDay: string;
  yesterday: string;
  /** listing_scan_days for yesterday, and for last week on a Monday. */
  scanRows: ScanDayRow[];
  /** Deals that went live, by UK day, area and kind (the last eight days). */
  wentLive: { day: string; area: string; kind: string }[];
  /** The first UK day marketplace deals were recorded: days before it are unknown, not zero. */
  dealsFrom: string | null;
  /** Monday: last week's Monday and Sunday. */
  lastWeek: { from: string; to: string } | null;
}

async function paged<T>(label: string, fetch: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetch(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadRunContext(admin: Admin, now: Date): Promise<RunContext> {
  const today = ukDay(now);
  const yesterday = addDays(today, -1);
  const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  const weekStart = ukWeekStart(now);
  const lastWeek = monday ? { from: addDays(weekStart, -7), to: addDays(weekStart, -1) } : null;
  const scanFrom = lastWeek ? lastWeek.from : yesterday;
  const liveFrom = addDays(yesterday, -7);
  const [scan, live, first] = await Promise.all([
    paged<{ day: string; postcode_area: string; kind: ScanKind; new_listings: number }>('scan days', (from, to) =>
      admin.from('listing_scan_days').select('day, postcode_area, kind, new_listings').gte('day', scanFrom).lte('day', yesterday).order('day').order('postcode_area').order('kind').range(from, to),
    ),
    paged<{ live_since: string; postcode_area: string | null; kind: string }>('went live', (from, to) =>
      admin
        .from('marketplace_deals')
        .select('live_since, postcode_area, kind')
        .gte('live_since', new Date(Date.parse(`${liveFrom}T00:00:00Z`) - DAY_MS).toISOString())
        .order('live_since')
        .order('id')
        .range(from, to),
    ),
    admin.from('marketplace_deals').select('created_at').order('created_at', { ascending: true }).limit(1),
  ]);
  const firstAt = ((first.data ?? []) as { created_at: string }[])[0]?.created_at;
  return {
    admin,
    now,
    ukDay: today,
    yesterday,
    scanRows: scan.map((r) => ({ day: r.day, area: String(r.postcode_area).toUpperCase(), kind: r.kind, newListings: Number(r.new_listings) || 0 })),
    wentLive: live
      .filter((r) => r.postcode_area && r.live_since)
      .map((r) => ({ day: ukDay(new Date(r.live_since)), area: String(r.postcode_area).toUpperCase(), kind: r.kind }))
      .filter((r) => r.day >= liveFrom && r.day <= yesterday),
    dealsFrom: firstAt ? ukDay(new Date(firstAt)) : null,
    lastWeek,
  };
}

/** The day's pool counts for briefing_day_counts: named for what they are. */
export async function dayCounts(ctx: RunContext): Promise<{ screenedYesterday: number; livePool: number; wentLiveYesterday: number }> {
  const { count } = await ctx.admin.from('marketplace_deals').select('id', { count: 'exact', head: true }).eq('status', 'live');
  return {
    screenedYesterday: ctx.scanRows.filter((r) => r.day === ctx.yesterday).reduce((n, r) => n + r.newListings, 0),
    livePool: count ?? 0,
    wentLiveYesterday: ctx.wentLive.filter((r) => r.day === ctx.yesterday).length,
  };
}

export interface MemberLite {
  userId: string;
  joinedAt: string;
  adminUser: boolean;
}

export interface LoadedSheet {
  inputs: SheetInputs;
  overdue: OverdueDeal[];
  /** Every address of the member's tracked deals: the writer may never say one. */
  forbidden: string[];
}

/** Live deals that fit the member now: Today's "N match", the same filters (src/app/today/page.tsx). */
async function fitLiveFor(ctx: RunContext, m: MemberLite): Promise<number | null> {
  const [saved, profileRes, savedRes, visibility] = await Promise.all([
    profilesFor(m.userId),
    ctx.admin.from('profiles').select('market_goals').eq('id', m.userId).maybeSingle(),
    ctx.admin.from('saved_areas').select('postcode_area').eq('user_id', m.userId),
    dealVisibilityFor(m.userId, m.adminUser, ctx.now),
  ]);
  const active = saved.readable ? saved.active : null;
  if (active !== null && !isRunning(active)) return null;
  const goals = parseMarketGoals((profileRes.data as { market_goals: unknown } | null)?.market_goals ?? null);
  const savedAreas = ((savedRes.data ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area);
  const tailoring = await tailoringForMember(m.userId, active, goals, savedAreas, ctx.now);
  const filters = typesShown({ goals, about: tailoring?.about ?? null }).map((type) => filtersForType(goals, savedAreas, type));
  return countDealsAcross(filters, visibility, { userId: m.userId });
}

async function stageMovesFor(ctx: RunContext, userId: string): Promise<StageMove[]> {
  const { data, error } = await ctx.admin.from('activity_events').select('deal_id, extras, occurred_at').eq('user_id', userId).eq('kind', 'stage_move').order('occurred_at', { ascending: false }).limit(500);
  if (error) {
    console.warn('[briefing] stage moves read failed:', error.message);
    return [];
  }
  const out: StageMove[] = [];
  for (const r of (data ?? []) as { deal_id: string | null; extras: Record<string, unknown> | null; occurred_at: string }[]) {
    const to = typeof r.extras?.to === 'string' ? r.extras.to : null;
    const item = typeof r.extras?.item === 'string' ? r.extras.item : r.deal_id ? `d-${r.deal_id}` : null;
    if (to && item) out.push({ key: item, to, at: r.occurred_at });
  }
  return out;
}

export async function loadSheet(ctx: RunContext, m: MemberLite): Promise<LoadedSheet> {
  const scopeRaw = await memberScanScope({ userId: m.userId, joinedAt: m.joinedAt }, ctx.now);
  const scope: ScanScope = { areas: scopeRaw.areas ? new Set(scopeRaw.areas.map((a) => a.toUpperCase())) : null, kinds: new Set(scopeRaw.kinds) };
  const [tracked, moves, fitLive, keptLastWeek] = await Promise.all([
    loadTrackedDeals(m.userId, { scope: 'own', adminUser: m.adminUser }),
    stageMovesFor(ctx, m.userId),
    fitLiveFor(ctx, m).catch((err) => {
      console.warn('[briefing] fit count failed:', (err as Error)?.message ?? err);
      return null;
    }),
    ctx.lastWeek
      ? ctx.admin
          .from('deal_reactions')
          .select('deal_id', { count: 'exact', head: true })
          .eq('user_id', m.userId)
          .eq('reaction', 'keep')
          .gte('created_at', `${ctx.lastWeek.from}T00:00:00Z`)
          .lt('created_at', `${addDays(ctx.lastWeek.to, 1)}T00:00:00Z`)
          .then((r) => r.count ?? 0)
      : Promise.resolve(0),
  ]);

  const items: TrackedLite[] = tracked.items.map((it) => ({ key: it.key, stage: it.stage, source: it.source, dealId: it.dealId, area: it.area, lastChangedAt: it.lastChangedAt, userId: it.userId }));
  const cards = new Map<string, CardLite>();
  for (const [id, c] of tracked.cards) cards.set(id, { town: c.town, raw_type: c.raw_type, price_history: c.price_history });

  const screened = (day: string) => ctx.scanRows.filter((r) => r.day === day && inScope(scope, r.area, r.kind)).reduce((n, r) => n + r.newListings, 0);
  const qualified = (day: string): number | null => (ctx.dealsFrom && day < ctx.dealsFrom ? null : ctx.wentLive.filter((r) => r.day === day && inScope(scope, r.area, r.kind)).length);
  const prior = Array.from({ length: 7 }, (_, i) => addDays(ctx.yesterday, i - 7)).map(qualified);

  const overdue = overdueDeals(stageEntriesFrom(items, cards, moves, m.userId), ctx.now);
  const inputs: SheetInputs = {
    ukDay: ctx.ukDay,
    everywhere: scope.areas === null,
    screenedYesterday: screened(ctx.yesterday),
    qualifiedYesterday: qualified(ctx.yesterday),
    qualifiedPrior: prior,
    fitLive,
    keptDrops: keptDropsFrom(items, cards, m.userId, new Date(ctx.now.getTime() - DAY_MS), ctx.now),
    passesByType: passesByTypeFrom(items, cards, m.userId, new Date(ctx.now.getTime() - PASS_WINDOW_DAYS * DAY_MS)),
    pipelineCount: pipelineOf(items, m.userId).length,
    overdue,
    week: ctx.lastWeek
      ? {
          screened: ctx.scanRows.filter((r) => r.day >= ctx.lastWeek!.from && r.day <= ctx.lastWeek!.to && inScope(scope, r.area, r.kind)).reduce((n, r) => n + r.newListings, 0),
          kept: keptLastWeek,
        }
      : null,
  };
  const forbidden = [...tracked.addresses.values(), ...tracked.items.map((it) => it.listing?.address ?? null)].filter((a): a is string => Boolean(a && a.trim()));
  return { inputs, overdue, forbidden };
}
