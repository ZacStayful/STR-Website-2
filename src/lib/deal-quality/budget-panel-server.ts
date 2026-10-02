import 'server-only';

/**
 * Reads the budget-bracket panel's inputs (Batch 22c, Part F; the rules are
 * in budget-panel.ts): the weekly-active facts for this week and last (the
 * same RPC and the same definition as /admin/activity), the members' budget
 * answers, the live purchases' prices, and the cheap deals that went live in
 * the last fortnight. Read-only. Null when the facts cannot be read (the
 * schema not run, or no service role), so the page says so instead of
 * showing zeros.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { adminEmails } from '../admin';
import { COUNTED_KINDS, QUALIFYING_KINDS } from '../activity/kinds';
import { computeWeeklyActive, type WeeklyFacts } from '../activity/metrics';
import { parseMarketGoals } from '../market/goals';
import { budgetPanel, bracketOf, cheapCounts, type CheapCounts, type PanelMember, type PanelRow } from './budget-panel';

const PAGE = 1000;
const ID_CHUNK = 200;

export interface BudgetPanelData {
  rows: PanelRow[];
  cheap: CheapCounts;
  thisWeek: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export async function loadBudgetPanel(cheapMaxPrice: number, now = new Date()): Promise<BudgetPanelData | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const { data: factsData, error: factsError } = await admin.rpc('activity_weekly_facts', { p: { weeks: 2, now: now.toISOString(), qualifying: QUALIFYING_KINDS, counted: COUNTED_KINDS } });
  if (factsError || !factsData) {
    if (factsError) console.error('[budget-panel] weekly facts failed:', factsError.message);
    return null;
  }
  const facts = factsData as WeeklyFacts;
  const report = computeWeeklyActive(facts, { adminEmails: adminEmails(), drillWeeks: 2 });

  // The included members' budget answers.
  const goalsById = new Map<string, unknown>();
  const ids = report.members.map((m) => m.id);
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('profiles').select('id, market_goals').in('id', ids.slice(i, i + ID_CHUNK));
    if (error) {
      console.error('[budget-panel] profiles unreadable:', error.message);
      return null;
    }
    for (const r of (data ?? []) as { id: string; market_goals: unknown }[]) goalsById.set(r.id, r.market_goals);
  }
  const members: PanelMember[] = report.members.map((m) => ({
    id: m.id,
    joined: m.joined,
    bracket: bracketOf(parseMarketGoals(goalsById.get(m.id))),
    active: new Map(m.weeks.map((w) => [w.week, w.active])),
  }));

  // Live purchases' prices (the deal's own price; an auction lot at its auction price), and the last fortnight's arrivals.
  const prices: number[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('marketplace_deals').select('price_amount, deal_price:deal->>askingPrice').eq('status', 'live').eq('kind', 'sale').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      console.error('[budget-panel] live deals unreadable:', error.message);
      return null;
    }
    const rows = (data ?? []) as { price_amount: unknown; deal_price: unknown }[];
    for (const r of rows) {
      const p = num(r.deal_price) ?? num(r.price_amount);
      if (p !== null && p > 0) prices.push(p);
    }
    if (rows.length < PAGE) break;
  }
  const fortnight = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await admin.from('marketplace_deals').select('status, live_since, price_amount, deal_price:deal->>askingPrice').eq('kind', 'sale').gte('live_since', fortnight).limit(20000);
  if (recentError) console.error('[budget-panel] recent deals unreadable:', recentError.message);
  const cheap = cheapCounts(
    [
      ...((recent ?? []) as { status: string; live_since: string | null; price_amount: unknown; deal_price: unknown }[]).map((r) => ({ status: r.status, price: num(r.deal_price) ?? num(r.price_amount), liveSince: r.live_since })),
    ],
    cheapMaxPrice,
    now,
  );
  // "Live now" counts every live cheap deal, not only the fortnight's arrivals.
  cheap.liveNow = prices.filter((p) => p <= cheapMaxPrice).length;

  return { rows: budgetPanel({ members, today: facts.today, prices, thisWeek: facts.this_week }), cheap, thisWeek: facts.this_week };
}
