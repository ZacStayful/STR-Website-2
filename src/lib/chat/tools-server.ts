import 'server-only';

/**
 * Batch 26: the full view's look-ups. Every one is read-only and runs for
 * the member the route took from the session (ChatTools is built per
 * question from it); nothing the model passes can name another member.
 *
 * What a look-up may return:
 *   - only deals the member can see (their deal visibility: a free member
 *     never sees a deal inside the 48-hour delay, by list or by id; an
 *     unknown deal and a hidden one answer the same "not available")
 *   - card-level facts as the app shows them, and a report's figures only
 *     for a deal the member has opened or analysed
 *   - never an address, a full postcode or a listing link, opened or not
 *     (the deal page shows those; the "Open deal" button goes there)
 * Every figure is formatted here, the way the app writes it, so the answer
 * can quote it exactly (the figure guard checks it did).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { dealCardsByIds } from '../marketplace/queries';
import { cardStatesFor, cardViewsFor } from '../marketplace/card-state';
import type { CardView } from '../marketplace/card-view';
import { describeType, priceLine, type DealCard } from '../marketplace/grid';
import { cashBuyerOf } from '../marketplace/most-you-can-pay';
import { withTailoring } from '../tailoring/numbers';
import { usesTailoring } from '../tailoring/profile';
import { getAreaCardsWithin } from '../market/cached';
import { loadTrackedDeals } from '../listing/tracked-server';
import { PIPELINE_STATUSES } from '../listing/pipeline';
import { todayKey } from '../today/day';
import { todaysPick, checkedCountFor } from '../today/selection';
import { checkedLine } from '../today/checked';
import { whatIfViewFor } from '../intelligence/what-if-server';
import { deepQuoteFor, searchStatusFor } from '../sourcing-demand/member-search';
import { dealTypesFor, DEAL_TYPE_LABELS } from '../profile/deal-types';
import { BUDGET_LABELS } from '../market/filters';
import { reasonLabel, callStatusLabel } from '../standout/reasons';
import { ukDay } from '../activity/week';
import { formatPence } from '../credit/deal-pricing';
import { MAX_LIST_DEALS, MAX_TOOL_RESULT_CHARS } from './config';
import { balanceLabel } from './format';
import { buildButton, type ChatButton } from './actions';
import type { ChatContext } from './context-server';
import type { ChatMember } from './turns-server';
import { lookUpKnowledge } from './knowledge-server';
import type { ToolInput } from './tools';

const AREA_WAIT_MS = 1_500;

const gbp = (n: number | null | undefined): string | null => (typeof n === 'number' && Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : null);
const pct = (n: number | null | undefined, scale = 1): string | null => (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * scale)}%` : null);

/** What one answer's look-ups have shown, so its buttons can only point at those. */
export interface AnswerState {
  deals: Set<string>;
  whatIfs: Set<string>;
  showMe: Set<string>;
  deepSearchOffered: boolean | null;
  buttons: ChatButton[];
  factProposal: string | null;
  toolsUsed: string[];
  knowledgeSlug: string | null;
  /** Every tool result, for the figure guard: an answer may only quote these. */
  sources: string[];
}

export function newAnswerState(): AnswerState {
  return { deals: new Set(), whatIfs: new Set(), showMe: new Set(), deepSearchOffered: null, buttons: [], factProposal: null, toolsUsed: [], knowledgeSlug: null, sources: [] };
}

export interface ChatTools {
  run(input: ToolInput, state: AnswerState): Promise<string>;
}

/** One deal as the chat may describe it: the card's own words and figures, never where exactly. */
function dealFacts(card: DealCard, view: CardView | undefined): Record<string, unknown> {
  return {
    deal_id: card.id,
    type: card.kind === 'rent' ? 'rent-to-rent' : 'to buy',
    property: describeType(card),
    where: [card.town, card.outcode].filter(Boolean).join(' · ') || null,
    price: priceLine(card),
    profit: view?.range ? `${view.range.label} (${view.range.basis})` : null,
    profit_basis: view?.caption ?? null,
    cash_needed: view?.cash ?? null,
    vs_long_let: view?.uplift ?? null,
    works: view?.projectLine ?? null,
    match: view?.explanation?.match ?? null,
    why_on_list: view?.explanation?.why ?? null,
    numbers: view?.numbers?.map((n) => `${n.label}: ${n.value}`) ?? [],
    opened: view?.opened ?? false,
    analysed: view?.analysed ?? false,
    full_analysis_price: view?.fullAnalysis?.main || null,
  };
}

function capped(value: unknown): string {
  const s = JSON.stringify(value);
  return s.length <= MAX_TOOL_RESULT_CHARS ? s : `${s.slice(0, MAX_TOOL_RESULT_CHARS)}…(cut)`;
}

export function chatTools(member: ChatMember, ctx: ChatContext, supabase: SupabaseClient, now: Date): ChatTools {
  const admin = createAdminClient();
  const finance = ctx.member.goals?.finance ?? null;
  const cashBuyer = cashBuyerOf(ctx.member.goals);

  async function views(cards: DealCard[]): Promise<Map<string, CardView>> {
    if (cards.length === 0) return new Map();
    const [base, snapshot] = await Promise.all([cardViewsFor({ supabase: supabase as never, userId: member.userId, adminUser: member.admin, cards, finance, cashBuyer }), getAreaCardsWithin(AREA_WAIT_MS)]);
    return withTailoring(base, cards, ctx.member.tailoring ?? null, snapshot, now, { why: true });
  }

  async function cardsInOrder(ids: string[]): Promise<DealCard[]> {
    if (ids.length === 0) return [];
    const cards = await dealCardsByIds(ids, ctx.member.visibility);
    const by = new Map(cards.map((c) => [c.id, c]));
    return ids.map((id) => by.get(id)).filter((c): c is DealCard => Boolean(c));
  }

  const tools: Record<ToolInput['tool'], (input: never, state: AnswerState) => Promise<unknown>> = {
    async search_knowledge(input: { question: string }, state) {
      const k = await lookUpKnowledge(input.question, ctx.values, admin);
      if (k.answers.length === 0) return { found: false };
      state.knowledgeSlug ??= k.answers[0].slug;
      return { found: true, answers: k.answers.map((a) => ({ slug: a.slug, question: a.question, answer: a.answer })) };
    },

    async my_profile_summary() {
      const p = ctx.profile;
      if (!p) return { profile: null, note: 'They have no search profile yet.' };
      const goals = p.goals;
      const { data: others } = await admin.from('search_profiles').select('name, paused_at').eq('user_id', member.userId).is('deleted_at', null).neq('id', p.id).order('created_at');
      const types = dealTypesFor({ goals, about: null });
      return {
        name: p.name,
        paused: ctx.paused,
        deal_types: types.map((t) => DEAL_TYPE_LABELS[t] ?? t),
        budget: goals?.budget ? (BUDGET_LABELS[goals.budget] ?? goals.budget) : null,
        max_rent: gbp(goals?.maxRentPcm ?? null) ? `${gbp(goals?.maxRentPcm ?? null)} pcm` : null,
        areas: p.areas.length > 0 ? p.areas : null,
        where: goals?.where ?? null,
        bedrooms: goals?.bedrooms ?? null,
        minimum_profit: gbp(goals?.finance?.targetMarginPcm ?? null) ? `${gbp(goals?.finance?.targetMarginPcm ?? null)} a month` : null,
        other_profiles: ((others ?? []) as { name: string; paused_at: string | null }[]).map((o) => (o.paused_at ? `${o.name} (paused)` : o.name)),
      };
    },

    async todays_picks(_input: never, state) {
      const day = todayKey(now);
      const profileId = ctx.profile?.id ?? null;
      const list = profileId
        ? await admin.from('profile_today_lists').select('deal_ids').eq('profile_id', profileId).eq('day', day).maybeSingle()
        : await admin.from('today_selections').select('deal_ids').eq('user_id', member.userId).eq('day', day).maybeSingle();
      const pick = await todaysPick(member.userId, now, profileId);
      const stored = list.data ? (((list.data as { deal_ids: string[] | null }).deal_ids ?? []) as string[]) : null;
      if (stored === null && !pick) return { ready: false, note: "Today's list isn't chosen yet: it is when they open Today." };
      const ids = [...new Set([...(pick?.dealId ? [pick.dealId] : []), ...(stored ?? [])])].slice(0, MAX_LIST_DEALS);
      const cards = await cardsInOrder(ids);
      const v = await views(cards);
      for (const c of cards) state.deals.add(c.id);
      return { ready: true, deals: cards.map((c) => dealFacts(c, v.get(c.id))) };
    },

    async my_deals(input: { stage: string | null }, state) {
      const load = await loadTrackedDeals(member.userId, { scope: 'own', adminUser: member.admin });
      const rows = load.view.filter((d) => d.dealId && (input.stage ? d.stage === input.stage : d.stage !== 'passed')).slice(0, MAX_LIST_DEALS);
      const cards = rows.map((d) => load.cards.get(d.dealId!)).filter((c): c is NonNullable<typeof c> => Boolean(c));
      const v = await views(cards);
      for (const c of cards) state.deals.add(c.id);
      return {
        deals: rows.map((d) => {
          const card = load.cards.get(d.dealId!);
          return { stage: PIPELINE_STATUSES.find((x) => x.key === d.stage)?.label ?? d.stage, ...(card ? dealFacts(card, v.get(card.id)) : { deal_id: d.dealId, type: d.kind === 'rent' ? 'rent-to-rent' : 'to buy', where: d.area }) };
        }),
        total_in_my_deals: load.view.filter((d) => d.stage !== 'passed').length,
      };
    },

    async deal_facts(input: { dealId: string }, state) {
      const [card] = await cardsInOrder([input.dealId]);
      if (!card) return { available: false };
      state.deals.add(card.id);
      const v = (await views([card])).get(card.id);
      const facts = dealFacts(card, v);
      const states = await cardStatesFor(supabase as never, member.userId, member.payerId, [card.id]);
      const reportId = states.get(card.id)?.reportId ?? null;
      if (!reportId) return facts;
      // The report through the member's own session (row security): only one they may open.
      const { data } = await supabase.from('saved_searches').select('result').eq('id', reportId).maybeSingle();
      const r = (data?.result ?? null) as { shortLet?: { annualRevenue?: number; occupancyRate?: number; averageDailyRate?: number }; financials?: { shortLetNetAnnual?: number; longLetNetAnnual?: number; monthlyDifference?: number; breakEvenOccupancy?: number }; dataQuality?: { level?: string; comparablesFound?: number }; verdict?: { fit?: string; riskLevel?: string } } | null;
      if (!r) return facts;
      return {
        ...facts,
        full_analysis: {
          short_let_revenue_a_year: gbp(r.shortLet?.annualRevenue),
          occupancy: pct(r.shortLet?.occupancyRate, (r.shortLet?.occupancyRate ?? 0) <= 1 ? 100 : 1),
          average_nightly_rate: gbp(r.shortLet?.averageDailyRate),
          short_let_net_a_year: gbp(r.financials?.shortLetNetAnnual),
          long_let_net_a_year: gbp(r.financials?.longLetNetAnnual),
          more_than_a_long_let_a_month: gbp(r.financials?.monthlyDifference),
          break_even_occupancy: pct(r.financials?.breakEvenOccupancy, (r.financials?.breakEvenOccupancy ?? 0) <= 1 ? 100 : 1),
          data_quality: r.dataQuality?.level ?? null,
          comparables: r.dataQuality?.comparablesFound ?? null,
          fit: r.verdict?.fit ?? null,
          risk: r.verdict?.riskLevel ?? null,
        },
      };
    },

    async what_if_suggestions(_input: never, state) {
      const w = await whatIfViewFor(ctx.member, now);
      const items = w.items.map((it) => {
        const dealId = it.bestHref?.match(/\/deals\/([0-9a-f-]{36})/i)?.[1] ?? null;
        if (dealId) state.showMe.add(dealId);
        if (it.save === 'use') state.whatIfs.add(it.key);
        return { line: it.line, use_this_key: it.save === 'use' ? it.key : null, show_me_deal_id: dealId, must_have: it.mustHave };
      });
      return items.length > 0 ? { suggestions: items } : { suggestions: [], none: w.none };
    },

    async deals_checked_count() {
      const profileId = ctx.profile?.id;
      const choice = profileId ? await checkedCountFor(profileId, now) : null;
      if (!choice) return { checked: null, note: "Today's list isn't chosen yet." };
      const line = checkedLine({ checked: choice.checked, meeting: choice.meeting, capped: choice.capped, nearby: choice.nearby, finds: choice.finds }, { tailored: usesTailoring(ctx.member.tailoring ?? null), smallCount: ctx.settings.intelligence.revealSmallCount });
      return { line, checked: choice.checked, meeting: choice.meeting };
    },

    async credit_state() {
      const c = ctx.credit;
      const s = ctx.settings;
      const ladder = s.dealOpenLadder.map((b) => b.pence);
      return {
        balance: c ? balanceLabel(c.totalPence) : null,
        team_member: member.teamMember,
        plan: c?.cycle?.planName ?? (c?.noPlan ? 'pay as you go' : null),
        auto_top_up: member.teamMember ? 'set by the team owner' : c?.autoTopup?.amountPence ? `on: ${balanceLabel(c.autoTopup.amountPence)} when below ${balanceLabel(c.autoTopup.thresholdPence)}` : 'off',
        prices: {
          full_analysis: formatPence(s.dealPricing.fullAnalysisPence),
          second_opinion_add_on: formatPence(s.dealPricing.pmiAddonPence),
          opening_a_deal: ladder.length > 0 ? `${formatPence(Math.min(...ladder))} to ${formatPence(Math.max(...ladder))}` : null,
          top_up_amounts: s.topupPresetsPence.map((p) => balanceLabel(p)),
        },
      };
    },

    async why_called(input: { date: string | null }) {
      const day = input.date;
      let decisions = admin.from('standout_decisions').select('uk_day, outcome, reason, notify, call_status, deal_type, created_at').eq('user_id', member.userId).order('created_at', { ascending: false }).limit(10);
      let calls = admin.from('si_calls_log').select('uk_day, call_type, status, blocked_reason, direction').eq('user_id', member.userId).order('queued_at', { ascending: false }).limit(10);
      if (day) {
        decisions = decisions.eq('uk_day', day);
        calls = calls.eq('uk_day', day);
      }
      const [d, k] = await Promise.all([decisions, calls]);
      const dRows = ((d.data ?? []) as { uk_day: string; outcome: string; reason: string; notify: string | null; call_status: string | null; deal_type: string | null }[]).filter((r) => !day || r.uk_day === day);
      const kRows = ((k.data ?? []) as { uk_day: string | null; call_type: string; status: string; blocked_reason: string | null; direction: string }[]).filter((r) => !day || r.uk_day === day);
      if (dRows.length === 0 && kRows.length === 0) return { found: false, day: day ?? null, today: ukDay(now) };
      return {
        found: true,
        day: day ?? null,
        standout_decisions: dRows.map((r) => ({ day: r.uk_day, outcome: r.outcome, why: reasonLabel(r.reason), told_by: r.notify, call: r.call_status ? callStatusLabel(r.call_status) : null })),
        calls: kRows.map((r) => ({ day: r.uk_day, direction: r.direction, about: CALL_TYPE_WORDS[r.call_type] ?? r.call_type, status: r.status, not_placed_because: r.blocked_reason })),
      };
    },

    async offer_action(input: { kind: string; target: string | null }, state) {
      if (input.kind === 'deep_search' && state.deepSearchOffered === null) {
        const [quote, status] = await Promise.all([deepQuoteFor(member.userId, now), searchStatusFor(member.userId)]);
        state.deepSearchOffered = Boolean(quote) && !status.running;
      }
      const b = buildButton(input.kind, input.target, { surface: 'full', teamMember: member.teamMember, allowedDeals: state.deals, allowedWhatIfs: state.whatIfs, allowedShowMe: state.showMe, deepSearchOffered: Boolean(state.deepSearchOffered) });
      if (!b) return { ok: false, note: 'That button is not available here.' };
      if (!state.buttons.some((x) => x.kind === b.kind && x.href === b.href && x.whatIfKey === b.whatIfKey) && state.buttons.length < 3) state.buttons.push(b);
      return { ok: true, button: b.label };
    },

    async propose_fact(input: { fact: string }, state) {
      if (state.factProposal) return { ok: false, note: 'Only one per answer.' };
      state.factProposal = input.fact;
      return { ok: true, note: 'The page will ask them "Want me to remember that?" under your answer.' };
    },
  };

  return {
    async run(input, state) {
      state.toolsUsed.push(input.tool);
      try {
        const out = await tools[input.tool](input as never, state);
        const text = capped(out);
        state.sources.push(text);
        return text;
      } catch (err) {
        console.error(`[chat] tool ${input.tool} failed:`, (err as Error)?.message ?? err);
        return JSON.stringify({ error: 'That look-up failed just now.' });
      }
    },
  };
}

const CALL_TYPE_WORDS: Record<string, string> = {
  intro: 'the welcome call after signing up',
  low_credit: 'their credit running low',
  callback: 'a call back they asked for',
  deal: 'a standout deal',
};
